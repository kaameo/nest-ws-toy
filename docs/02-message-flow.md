# Message Flow (메시지 흐름)

## 전체 시퀀스

```
Client              Gateway                 Kafka                  Worker                Gateway(broadcast)
  │                    │                      │                      │                      │
  │── sendMessage ────>│                      │                      │                      │
  │                    │── Zod 검증            │                      │                      │
  │                    │── 멤버십 확인          │                      │                      │
  │                    │── publish ───────────>│ chat.messages.v1     │                      │
  │<── ACCEPTED ───────│                      │                      │                      │
  │                    │                      │── consume ──────────>│                      │
  │                    │                      │                      │── Zod 검증            │
  │                    │                      │                      │── INSERT (멱등)       │
  │                    │                      │                      │── UPDATE room 메타    │
  │                    │                      │<── publish ──────────│                      │
  │                    │                      │ chat.messages.persisted.v1                  │
  │                    │                      │                      │────── consume ──────>│
  │                    │                      │                      │                      │── Zod 검증
  │<── newMessage ─────│<───────────── server.to(roomId).emit ─────────────────────────────│
```

## 단계별 상세

### 1단계: 클라이언트 → Gateway (WebSocket)

**파일**: `apps/chat-gateway/src/gateway/chat.gateway.ts:102-141`

1. 클라이언트가 `sendMessage` 이벤트를 Socket.IO로 전송
2. `SendMessageSchema`로 Zod 검증 (roomId, clientMsgId, type, content)
3. `roomsService.isMember()`로 방 멤버십 확인
4. `MessageCreatedEvent` 구성:
   ```typescript
   {
     eventId: randomUUID(),     // 이벤트 고유 ID
     roomId: dto.roomId,
     senderId: client.user.userId,
     clientMsgId: dto.clientMsgId,  // 클라이언트가 생성한 중복 제거용 ID
     messageType: dto.type,
     content: dto.content,
     producedAt: new Date().toISOString(),
   }
   ```
5. Kafka `chat.messages.v1` 토픽에 발행 (key = roomId)
6. 클라이언트에 `{ clientMsgId, status: 'ACCEPTED' }` ACK 반환

### 2단계: Kafka → Worker (DB 저장)

**파일**: `apps/chat-worker/src/persistor/persistor.service.ts:24-57`

1. `PersistorController`가 `chat.messages.v1` 토픽에서 메시지 수신
2. `MessageCreatedEventSchema`로 Zod 검증
3. 트랜잭션 내에서:
   - ULID 생성: `const messageId = generateUlid()`
   - `INSERT ... ON CONFLICT DO NOTHING` — `(roomId, senderId, clientMsgId)` 유니크 제약으로 중복 방지
   - 중복이 아닌 경우 `rooms` 테이블의 `lastMessageId`, `lastMessageAt` 업데이트
4. 저장 성공 시 `MessagePersistedEvent`를 `chat.messages.persisted.v1` 토픽에 발행

### 3단계: Kafka → Gateway (브로드캐스트)

**파일**: `apps/chat-gateway/src/gateway/broadcast.controller.ts:12-34`

1. `BroadcastController`가 `chat.messages.persisted.v1` 토픽에서 이벤트 수신
2. `MessagePersistedEventSchema`로 Zod 검증
3. Socket.IO 룸에 브로드캐스트:
   ```typescript
   this.chatGateway.server.to(event.roomId).emit('newMessage', {
     messageId, roomId, senderId, clientMsgId, type, content, createdAt
   });
   ```

## Kafka 토픽 설계

| 토픽 | 파티션 | Key | Producer | Consumer | 용도 |
|------|--------|-----|----------|----------|------|
| `chat.messages.v1` | 3 | roomId | Gateway | Worker (chat-persistor) | DB 저장 |
| `chat.messages.persisted.v1` | 3 | roomId | Worker | Gateway (chat-broadcast) | WS 브로드캐스트 |

**Key = roomId인 이유**: 같은 방의 메시지가 항상 같은 파티션에 들어가므로, 방 내 메시지 순서가 보장됩니다.

## 신뢰성 보장

### At-Least-Once Delivery
- Gateway Producer: `idempotent: true` → `acks=all` 자동 적용
- Worker에서 에러 발생 시 `throw error`로 offset commit 방지 → 재시도

### 멱등 저장 (Deduplication)
- DB 유니크 제약: `UNIQUE(room_id, sender_id, client_msg_id)`
- `INSERT ... ON CONFLICT DO NOTHING`으로 중복 무시
- 중복 감지 시 fanout 스킵

### 클라이언트 중복 제거
- 클라이언트가 `clientMsgId`를 생성 (UUID)
- `seenClientMsgIds` Set으로 동일 메시지의 중복 렌더링 방지
