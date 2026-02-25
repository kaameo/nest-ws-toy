# Phase 5: WebSocket — Socket.IO, 실시간 통신, Presence

## 학습 목표

- NestJS WebSocket Gateway의 생명주기 메서드를 이해한다
- WebSocket 연결 시 JWT를 수동으로 검증하는 방법을 익힌다
- `@SubscribeMessage()`로 소켓 이벤트를 처리하는 방법을 배운다
- Redis Hash를 활용해 다중 디바이스 접속 상태를 추적하는 방법을 안다
- TTL 기반 Presence 시스템의 설계를 이해한다

## 읽을 파일 목록

21. `libs/common/src/dto/ws-events.dto.ts`
22. `apps/chat-gateway/src/gateway/chat.gateway.ts`
23. `apps/chat-gateway/src/presence/presence.service.ts`

---

## 21. `libs/common/src/dto/ws-events.dto.ts` — WS 이벤트 스키마

### 핵심 코드

```typescript
export const SendMessageSchema = z.object({
  roomId: z.uuid(),
  clientMsgId: z.uuid(),
  type: z.enum(['TEXT', 'IMAGE']).default('TEXT'),
  content: z.string().min(1).max(5000),
});

export type SendMessageDto = z.infer<typeof SendMessageSchema>;

export interface MessageAck {
  clientMsgId: string;
  status: 'ACCEPTED' | 'FAILED';
  error?: string;
}
```

### NestJS 개념: WebSocket DTO 설계

HTTP와 달리 WebSocket은 NestJS의 `ValidationPipe`가 자동으로 적용되지 않습니다. 따라서 Gateway 핸들러 내부에서 직접 검증해야 합니다.

**`clientMsgId`의 역할:**
- 클라이언트가 메시지 전송 전 UUID를 생성해서 포함합니다
- ACK 응답에서 `clientMsgId`를 돌려보내면 클라이언트가 어떤 메시지의 응답인지 매핑할 수 있습니다
- 동시에 이것이 DB 레벨의 멱등성 키가 됩니다 (재전송해도 중복 저장되지 않음)

**`MessageAck` — 단방향 확인 응답:**
```typescript
// 클라이언트 → 서버
socket.emit('sendMessage', { roomId, clientMsgId, content })

// 서버 → 클라이언트 (ACK)
// { clientMsgId: "...", status: "ACCEPTED" }
// { clientMsgId: "...", status: "FAILED", error: "..." }
```

---

## 22. `apps/chat-gateway/src/gateway/chat.gateway.ts` — WebSocket 생명주기

### 핵심 코드: 게이트웨이 설정

```typescript
interface AuthenticatedSocket extends Socket {
  user: { userId: string; email: string };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',        // 기본 네임스페이스
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;        // Socket.IO Server 인스턴스 — 브로드캐스트에 사용
}
```

### NestJS 개념: WebSocket 게이트웨이 인터페이스

```typescript
interface OnGatewayConnection {
  handleConnection(client: Socket, ...args: any[]): any;
}

interface OnGatewayDisconnect {
  handleDisconnect(client: Socket): any;
}
```

**Fastify와의 호환성:**

이 프로젝트는 HTTP 어댑터로 Fastify(`@nestjs/platform-fastify`)를 사용하지만, Socket.IO(`@nestjs/platform-socket.io`)는 **변경 없이 동작**합니다. NestJS WebSocket 레이어는 HTTP 어댑터와 독립적으로 동작하기 때문입니다. `@WebSocketGateway()`, `@SubscribeMessage()` 등 모든 WebSocket 데코레이터는 Express/Fastify 전환에 영향을 받지 않습니다.

### 핵심 코드: 연결 시 JWT 수동 검증

```typescript
async handleConnection(client: AuthenticatedSocket): Promise<void> {
  try {
    // 1단계: 핸드셰이크에서 토큰 추출 (두 가지 방법 지원)
    const token =
      client.handshake.auth?.token ??                                    // socket.io auth
      client.handshake.headers.authorization?.replace('Bearer ', '');    // HTTP 헤더

    if (!token) {
      client.disconnect();
      return;
    }

    // 2단계: JWT 수동 검증 (PassportStrategy 없이)
    const payload = this.jwtService.verify<JwtPayload>(token, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
    });

    // 3단계: 인증 정보를 소켓 객체에 저장
    client.user = { userId: payload.sub, email: payload.email };
    await this.presenceService.setOnline(payload.sub, this.serverId, client.id);

  } catch {
    client.disconnect();  // 토큰 검증 실패 → 즉시 연결 종료
  }
}
```

**왜 WebSocket에서 Passport Guard를 사용하지 않는가?**

HTTP 요청은 매번 `AuthGuard`가 실행되지만, WebSocket은 **연결 시 1회만 인증**합니다. 이후 모든 메시지는 같은 연결을 재사용하므로, 연결 시점(`handleConnection`)에 토큰을 검증하고 `client.user`에 저장하는 것이 효율적입니다.

**클라이언트에서 토큰 전달 방법:**
```javascript
// 방법 1: socket.io auth (권장)
const socket = io('http://localhost:3000', {
  auth: { token: 'eyJ...' }
});

// 방법 2: HTTP 헤더
const socket = io('http://localhost:3000', {
  extraHeaders: { Authorization: 'Bearer eyJ...' }
});
```

### 핵심 코드: 방 참가 및 메시지 전송

```typescript
@SubscribeMessage('joinRoom')
async handleJoinRoom(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() data: { roomId: string },
): Promise<{ success: boolean; error?: string }> {
  if (!client.user) {
    return { success: false, error: 'Not authenticated' };
  }

  const isMember = await this.roomsService.isMember(data.roomId, client.user.userId);
  if (!isMember) {
    return { success: false, error: 'Not a member of this room' };
  }

  await client.join(data.roomId);   // Socket.IO Room에 참가 (브로드캐스트 수신용)
  return { success: true };
}

@SubscribeMessage('sendMessage')
async handleSendMessage(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() data: unknown,
): Promise<MessageAck> {
  if (!client.user) {
    return { clientMsgId: '', status: 'FAILED', error: 'Not authenticated' };
  }

  // WebSocket은 ValidationPipe 자동 적용 안 됨 → 수동 검증
  const parsed = SendMessageSchema.safeParse(data);
  if (!parsed.success) {
    return { clientMsgId: '', status: 'FAILED', error: 'Invalid message format' };
  }

  const dto: SendMessageDto = parsed.data;
  const userId = client.user.userId;

  const isMember = await this.roomsService.isMember(dto.roomId, userId);
  if (!isMember) {
    return { clientMsgId: dto.clientMsgId, status: 'FAILED', error: 'Not a member of this room' };
  }

  const event: MessageCreatedEvent = {
    eventId: randomUUID(),
    roomId: dto.roomId,
    senderId: userId,
    clientMsgId: dto.clientMsgId,
    messageType: dto.type,
    content: dto.content,
    producedAt: new Date().toISOString(),
  };

  try {
    await this.kafkaProducer.publish(KAFKA_TOPICS.MESSAGES_V1, dto.roomId, event);
    return { clientMsgId: dto.clientMsgId, status: 'ACCEPTED' };
  } catch (error) {
    return { clientMsgId: dto.clientMsgId, status: 'FAILED', error: 'Message delivery failed' };
  }
}

@SubscribeMessage('heartbeat')
async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
  if (client.user) {
    await this.presenceService.refreshTTL(client.user.userId, client.id);
  }
  return { success: true };
}
```

### NestJS 개념: WebSocket 데코레이터

| 데코레이터 | 역할 |
|-----------|------|
| `@WebSocketServer()` | Socket.IO Server 인스턴스 주입 |
| `@SubscribeMessage('event')` | 특정 이벤트 이름에 핸들러 등록 |
| `@ConnectedSocket()` | 해당 소켓 클라이언트 객체 주입 |
| `@MessageBody()` | 이벤트 페이로드 데이터 주입 |

**Socket.IO Room vs NestJS Room:**
```typescript
await client.join(roomId);  // Socket.IO의 room 기능
// roomId와 같은 room에 join된 모든 소켓에 브로드캐스트 가능:
this.server.to(roomId).emit('newMessage', data);
```

**`@SubscribeMessage` 핸들러의 반환값:**
- 반환값이 있으면 자동으로 ACK(acknowledgement)로 클라이언트에 전달됩니다
- 클라이언트에서: `socket.emit('sendMessage', data, (ack) => { console.log(ack) })`

**heartbeat 패턴:**
- 클라이언트가 20초마다 `heartbeat` 이벤트를 전송합니다
- 서버는 Redis의 Presence TTL을 60초로 갱신합니다
- 클라이언트가 20초 이상 응답 없으면 TTL 60초가 만료되어 자동으로 오프라인 처리됩니다

---

## 23. `apps/chat-gateway/src/presence/presence.service.ts` — Redis Hash + TTL

### 핵심 코드

```typescript
const PRESENCE_TTL = 60; // seconds
const PRESENCE_KEY_PREFIX = 'presence:user:';

@Injectable()
export class PresenceService {
  // 온라인 상태 등록 (소켓 연결 시)
  async setOnline(userId: string, serverId: string, socketId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    // Hash: field=socketId, value=JSON{ serverId, connectedAt }
    await this.redis.hset(key, socketId, JSON.stringify({ serverId, connectedAt: new Date().toISOString() }));
    await this.redis.expire(key, PRESENCE_TTL);
  }

  // 오프라인 처리 (소켓 연결 해제 시)
  async setOffline(userId: string, socketId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    await this.redis.hdel(key, socketId);             // 해당 소켓만 제거
    const remaining = await this.redis.hlen(key);     // 남은 소켓 수 확인
    if (remaining === 0) {
      await this.redis.del(key);                       // 소켓이 없으면 키 전체 삭제
    }
  }

  // TTL 갱신 (heartbeat 시)
  async refreshTTL(userId: string, socketId?: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    if (socketId) {
      const exists = await this.redis.hexists(key, socketId);
      if (exists) {
        await this.redis.hset(key, socketId, JSON.stringify({ refreshedAt: new Date().toISOString() }));
      }
    }
    await this.redis.expire(key, PRESENCE_TTL);
  }

  // 온라인 여부 확인
  async isOnline(userId: string): Promise<boolean> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
}
```

### NestJS 개념: Redis Hash를 활용한 다중 디바이스 Presence

**데이터 구조:**
```
Redis Hash: presence:user:{userId}
  field: socketId1  →  {"serverId": "gateway-1234", "connectedAt": "2024-..."}
  field: socketId2  →  {"serverId": "gateway-5678", "connectedAt": "2024-..."}
  TTL: 60초
```

**일반 String vs Hash를 사용하는 이유:**

String을 쓰면 다중 디바이스를 지원하기 어렵습니다:
```
# String 방식 (다중 디바이스 불가)
presence:user:123 → "online"
# 폰과 PC 동시 접속 중 PC가 끊기면 → "offline" 으로 덮어씀
# 폰은 여전히 연결 중인데 오프라인 처리되는 버그!
```

Hash를 쓰면 소켓별로 독립 관리됩니다:
```
# Hash 방식 (다중 디바이스 지원)
presence:user:123
  socket-abc → {...}   # 폰
  socket-xyz → {...}   # PC
# PC가 끊기면 socket-xyz만 hdel
# socket-abc가 남아있으면 여전히 온라인
```

**TTL과 heartbeat의 관계:**
```
t=0초:  소켓 연결 → EXPIRE 60초 설정
t=20초: heartbeat → EXPIRE 60초 재설정
t=40초: heartbeat → EXPIRE 60초 재설정
t=60초: heartbeat → EXPIRE 60초 재설정
...정상 연결 유지...

t=0초:  소켓 연결 → EXPIRE 60초 설정
t=60초: (heartbeat 없음) → TTL 만료 → 자동 오프라인 처리
```

**학습 포인트:**
- `HSET`, `HDEL`, `HLEN`, `HEXISTS`는 Redis Hash 명령어입니다
- `EXPIRE`는 키 전체에 TTL을 설정합니다 (특정 field에는 불가)
- 서버 장애 시에도 TTL 덕분에 Presence 데이터가 자동 정리됩니다

---

## WebSocket 전체 흐름 요약

```
1. 클라이언트 연결
   socket.connect() + auth.token
     → handleConnection() → JWT 검증 → client.user 저장
     → presenceService.setOnline()
     → Redis: presence:user:{id} = { socketId: {...} }

2. 방 참가
   socket.emit('joinRoom', { roomId })
     → handleJoinRoom() → isMember 확인 (Redis 캐시)
     → client.join(roomId)  ← Socket.IO Room 참가

3. 메시지 전송
   socket.emit('sendMessage', { roomId, clientMsgId, content })
     → handleSendMessage() → Zod 검증 → isMember 확인
     → kafkaProducer.publish(chat.messages.v1, event)
     → ACK 반환: { clientMsgId, status: 'ACCEPTED' }

4. 메시지 수신 (Kafka → WebSocket)
   BroadcastController (Phase 6에서 설명)
     → server.to(roomId).emit('newMessage', data)
     → joinRoom한 모든 소켓이 수신

5. Heartbeat
   socket.emit('heartbeat') (20초마다)
     → presenceService.refreshTTL()
     → Redis TTL 갱신

6. 연결 해제
   handleDisconnect()
     → presenceService.setOffline()
     → Redis: hdel socketId, 마지막이면 del 키
```

## 다음 단계

[Phase 6: Kafka 메시징 →](./06-kafka-messaging.md)

Kafka 프로듀서/컨슈머, 마이크로서비스 패턴, 트랜잭션 기반 멱등성을 학습합니다.
