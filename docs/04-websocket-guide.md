# WebSocket 가이드

## 개요

Socket.IO 기반 WebSocket 게이트웨이. 실시간 메시지 전송, 방 참가, 접속 상태 관리를 담당한다.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `apps/chat-gateway/src/gateway/chat.gateway.ts` | WebSocket 게이트웨이 (연결/메시지/하트비트) |
| `apps/chat-gateway/src/gateway/broadcast.controller.ts` | Kafka → WebSocket 브로드캐스트 |
| `apps/chat-gateway/src/gateway/gateway.module.ts` | 의존성 구성 |
| `apps/chat-gateway/src/presence/presence.service.ts` | Redis 기반 접속 상태 |

## 연결 인증

```
Client                          Gateway
  │                                │
  │── io(URL, { auth: { token } }) ──>│
  │                                │── JWT 검증 (JwtService.verify)
  │                                │── client.user = { userId, email }
  │                                │── presenceService.setOnline()
  │<── connect ────────────────────│
```

**인증 방식**: 연결 시점에 한 번만 JWT 검증. 이후 모든 메시지는 `client.user`를 신뢰.

**토큰 전달**: `client.handshake.auth.token` (우선) 또는 `Authorization` 헤더.

**실패 시**: `client.disconnect()` 호출로 즉시 연결 해제.

```typescript
// chat.gateway.ts:52-75
handleConnection(client: AuthenticatedSocket) {
  const token = client.handshake.auth?.token
    || client.handshake.headers?.authorization?.replace('Bearer ', '');

  const payload = this.jwtService.verify(token, { secret });
  client.user = { userId: payload.sub, email: payload.email };
  this.presenceService.setOnline(client.user.userId, this.serverId, client.id);
}
```

## 이벤트 목록

### Client → Server (emit)

| 이벤트 | 페이로드 | 응답 (ACK) | 설명 |
|--------|----------|------------|------|
| `joinRoom` | `{ roomId: UUID }` | `{ success: boolean, error?: string }` | 방 참가 (Socket.IO room join) |
| `sendMessage` | `{ roomId, clientMsgId, type, content }` | `{ clientMsgId, status: 'ACCEPTED'\|'FAILED' }` | 메시지 전송 |
| `heartbeat` | `{}` | `{ success: true }` | 접속 상태 갱신 (20초 간격) |

### Server → Client (emit)

| 이벤트 | 페이로드 | 조건 |
|--------|----------|------|
| `newMessage` | `{ messageId, roomId, senderId, clientMsgId, type, content, createdAt }` | 같은 방에 있는 모든 클라이언트 |

## 방 참가 플로우

```typescript
// chat.gateway.ts:84-100
@SubscribeMessage('joinRoom')
handleJoinRoom(client, { roomId }) {
  // 1. DB에서 멤버십 확인
  const isMember = await this.roomsService.isMember(roomId, client.user.userId);

  // 2. Socket.IO room에 join
  client.join(roomId);

  // 3. ACK 반환
  return { success: true };
}
```

**주의**: HTTP `POST /rooms/:roomId/join`으로 먼저 방에 가입한 후, WebSocket `joinRoom`으로 실시간 수신을 시작해야 함.

## 메시지 전송 플로우

```typescript
// chat.gateway.ts:102-141
@SubscribeMessage('sendMessage')
handleSendMessage(client, data) {
  // 1. Zod 스키마 검증
  const parsed = SendMessageSchema.safeParse(data);

  // 2. 멤버십 확인
  const isMember = await this.roomsService.isMember(dto.roomId, client.user.userId);

  // 3. Kafka 이벤트 발행 (DB 저장은 Worker가 담당)
  await this.kafkaProducer.publish(KAFKA_TOPICS.MESSAGES_V1, dto.roomId, event);

  // 4. 즉시 ACK 반환 (DB 저장 전)
  return { clientMsgId: dto.clientMsgId, status: 'ACCEPTED' };
}
```

**핵심**: Gateway는 메시지를 DB에 저장하지 않음. Kafka에 발행하고 바로 ACK. 실제 저장은 Worker가 비동기로 처리.

## 접속 상태 (Presence)

### Redis 구조

```
Key:   presence:user:{userId}
Type:  Hash
Field: {socketId}
Value: JSON({ serverId, connectedAt })
TTL:   60초
```

### 동작 방식

| 이벤트 | 동작 | Redis 명령 |
|--------|------|------------|
| 연결 | 온라인 등록 | `HSET` + `EXPIRE 60s` |
| 연결 해제 | 오프라인 처리 | `HDEL` (남은 소켓 없으면 키 삭제) |
| 하트비트 (20초) | TTL 갱신 + hash entry 업데이트 | `HEXISTS` + `HSET` + `EXPIRE 60s` |

### 멀티 디바이스 지원

Hash 타입을 사용해 한 사용자가 여러 소켓(디바이스)으로 접속 가능. 모든 소켓이 연결 해제되어야 오프라인.

### 장애 대응

클라이언트가 비정상 종료(크래시)해도 60초 후 TTL 만료로 자동 오프라인 처리.

## 브로드캐스트 패턴

```typescript
// broadcast.controller.ts:12-34
@MessagePattern(KAFKA_TOPICS.MESSAGES_PERSISTED_V1)
handlePersistedMessage(@Payload() message) {
  const event = MessagePersistedEventSchema.safeParse(data);

  this.chatGateway.server.to(event.roomId).emit('newMessage', {
    messageId, roomId, senderId, clientMsgId, type, content, createdAt
  });
}
```

`BroadcastController`는 `ChatGateway`를 주입받아 `server.to(roomId).emit()`으로 특정 방에만 브로드캐스트.

## NestJS WebSocket 패턴 정리

| 패턴 | 사용처 | 설명 |
|------|--------|------|
| `@WebSocketGateway()` | ChatGateway | Socket.IO 서버 생성 |
| `@WebSocketServer()` | `server: Server` | Socket.IO 서버 인스턴스 접근 |
| `@SubscribeMessage()` | joinRoom, sendMessage, heartbeat | 이벤트 핸들러 등록 |
| `@ConnectedSocket()` | 모든 핸들러 | 소켓 인스턴스 주입 |
| `@MessageBody()` | 모든 핸들러 | 이벤트 페이로드 주입 |
| `OnGatewayConnection` | handleConnection | 연결 시 인증 처리 |
| `OnGatewayDisconnect` | handleDisconnect | 연결 해제 시 정리 |
| `client.join(roomId)` | joinRoom | Socket.IO 룸 참가 |
| `server.to(roomId).emit()` | broadcast | 특정 룸에 이벤트 전송 |
