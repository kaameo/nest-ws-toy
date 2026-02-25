# PRD (Product Requirements Document)

## 0. 토이 프로젝트 목표 정의

### 핵심 요구사항 (MVP)

1. 로그인 (JWT)
2. 방(그룹 채팅) 생성/참여
3. WebSocket 실시간 메시지 송수신
4. Kafka에 기록 성공 후 ACK (at-least-once 기반)
5. PostgreSQL에 메시지 로그 저장 (중복 저장 방지)
6. Redis presence: 온라인 여부 / 접속 서버 / 최근 heartbeat
7. REST로 히스토리/미수신 동기화 (cursor)

### "실무형" 품질 기준

- 메시지 중복 전송/중복 저장을 정상 시나리오로 처리
- 재접속 시 누락 메시지 복구 (REST after-cursor)
- Consumer 재처리에도 데이터 정합성 유지 (DB unique)

---

## 1. 리포지토리/구성 방식

단일 레포(모노레포)로 2개 앱을 분리:

- `apps/chat-gateway` — WebSocket Gateway + Kafka Producer + Redis presence
- `apps/chat-worker` — Kafka Consumer(저장) + DB 저장 + (옵션) fanout

처음에는 "fanout도 gateway가 직접" 처리해도 되지만, 확장 감각을 위해 worker 분리 권장.

### 공용 라이브러리

- `libs/common` — DTO, 이벤트 스키마, 공용 유틸 (ULID/UUID, validation)
- `libs/db` — TypeORM 설정
- `libs/redis` — Redis client wrapper

---

## 2. 로컬 개발 인프라 (docker-compose)

`docker-compose.yml`로 다음을 띄운다:

- Postgres
- Redis
- Kafka (+Zookeeper 또는 KRaft 모드)
- (옵션) Kafka UI

컨테이너 구성에 성공하면, 토이는 이미 절반 끝.

### 체크포인트

- [ ] Postgres 접속 OK
- [ ] Redis ping OK
- [ ] Kafka produce/consume 테스트 OK

---

## 3. 데이터 모델 (PostgreSQL 스키마)

### users

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID | PK |
| `email` | VARCHAR | |
| `password_hash` | VARCHAR | |
| `created_at` | TIMESTAMP | |

### rooms

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID | PK |
| `name` | VARCHAR | |
| `created_at` | TIMESTAMP | |
| `last_message_id` | VARCHAR | nullable |
| `last_message_at` | TIMESTAMP | nullable |

### room_members

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `room_id` | UUID | FK → rooms, PK |
| `user_id` | UUID | FK → users, PK |
| `joined_at` | TIMESTAMP | |
| `last_read_message_id` | VARCHAR | nullable, 읽음 커서 |

### messages

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | ULID | PK (시간순 정렬 가능) |
| `room_id` | UUID | FK → rooms, INDEX |
| `sender_id` | UUID | FK → users, INDEX |
| `client_msg_id` | UUID | 멱등성 키 |
| `type` | ENUM | TEXT / IMAGE / SYSTEM |
| `content` | TEXT | |
| `created_at` | TIMESTAMP | |

### 제약조건

- **중복 저장 방지**: `UNIQUE(room_id, sender_id, client_msg_id)`
- **페이지네이션 인덱스**: `INDEX(room_id, id DESC)`

---

## 4. Redis Presence 설계

Redis는 "상태 저장소"가 아니라 "휘발성 presence"에 최적.

### 키 설계

| 키 | 타입 | TTL | 설명 |
|----|------|-----|------|
| `presence:user:{userId}` | Hash | 60초 | status, serverId, lastSeenAt |
| `room:online:{roomId}` | Set | - | 온라인 userIds (옵션, 토이에선 생략 가능) |

### 업데이트 타이밍

| 이벤트 | 동작 |
|--------|------|
| WS connect 성공 | `HSET` + `EXPIRE 60s` |
| heartbeat (20초마다) | TTL 연장 |
| disconnect | 바로 offline 처리 (가능하면), 또는 TTL 만료에 맡김 (더 안전) |

> `disconnect` 이벤트는 항상 오지 않으므로 TTL 기반이 실무에서 더 안정적.

---

## 5. Kafka 토픽/이벤트 설계 (at-least-once 핵심)

### 토픽

| 토픽 | Key | 용도 |
|------|-----|------|
| `chat.messages.v1` | roomId | 룸 단위 ordering |
| `chat.messages.persisted.v1` | roomId | 저장 완료 이벤트 |

### 이벤트 페이로드 (`MessageCreatedEvent`)

```typescript
{
  eventId: string       // UUID
  roomId: string
  senderId: string
  clientMsgId: string
  messageType: string
  content: string
  producedAt: string
  traceId?: string      // 옵션
}
```

> **중요**: WS Gateway는 Kafka `acks=all`로 publish 성공을 확인한 뒤에만 클라이언트에 ACK.

### 컨슈머 그룹

| 그룹 | 역할 |
|------|------|
| `chat-persistor` | DB 저장 담당 |
| `chat-broadcast` | 브로드캐스트 담당 |

---

## 6. 메시지 플로우

### (1) 클라이언트 → WS Gateway

`SEND_MESSAGE` 이벤트 전송 (`clientMsgId` 포함)

### (2) Gateway 처리

1. JWT 검증 + 룸 권한 체크
2. Kafka publish (`key=roomId`)
3. publish 성공 시 클라이언트에게 ACK: `{ clientMsgId, status: "ACCEPTED" }`

### (3) chat-worker (persistor) 처리

1. 이벤트 consume
2. DB insert messages (unique로 dedup)
3. `rooms.last_message` 갱신
4. commit offset

### (4) 실시간 브로드캐스트

토이에서 추천하는 **2단계 방식**:

1. `chat.messages.v1` consume → DB 저장
2. 저장 성공 시 `chat.messages.persisted.v1` 발행
3. Gateway는 persisted 토픽을 구독해서 브로드캐스트

이렇게 하면:

- 브로드캐스트도 at-least-once가 됨
- DB에 없는 메시지가 화면에 뜨는 상황 방지

---

## 7. API 설계 (REST는 정합성 담당)

### 인증

| Method | Path | 설명 |
|--------|------|------|
| POST | `/auth/register` | 회원가입 |
| POST | `/auth/login` | 로그인 → JWT |

### 방/멤버

| Method | Path | 설명 |
|--------|------|------|
| POST | `/rooms` | 방 생성 |
| POST | `/rooms/:roomId/join` | 방 참여 |
| GET | `/rooms` | 내 방 목록 |
| GET | `/rooms/:roomId/members` | 멤버 목록 |

### 메시지 히스토리 (커서 기반)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/rooms/:roomId/messages?before={messageId}&limit=50` | 과거 탐색 |
| GET | `/rooms/:roomId/messages?after={messageId}&limit=50` | 재접속 동기화 |

### 읽음 커서

| Method | Path | 설명 |
|--------|------|------|
| POST | `/rooms/:roomId/read` | `{ lastReadMessageId }` |

---

## 8. NestJS 구현 순서

### Phase 1: 인프라 + 기본 뼈대

1. NestJS 프로젝트 생성 (모노레포)
2. docker-compose로 Postgres/Redis/Kafka 올리기
3. TypeORM 스키마 작성 + migrate
4. Auth 모듈 (JWT) 완성
5. Room/Member CRUD 완성 (REST)

> **완료 기준**: 회원가입/로그인/방 생성/참여가 REST로 정상

### Phase 2: WebSocket Gateway + Presence

1. WS 연결 시 JWT 인증 (Handshake 또는 첫 메시지)
2. join room 기능 구현
3. Redis presence set + TTL
4. heartbeat 메시지로 TTL 연장
5. 온라인 상태 조회 API (옵션)

> **완료 기준**: 방에 들어가서 WS 연결 유지, presence가 Redis에 찍힘

### Phase 3: Kafka publish + at-least-once ACK

1. `SEND_MESSAGE` 수신 시 Kafka publish
2. publish 성공 후 ACK 반환
3. DB 저장을 gateway가 직접 하지 말고 worker로 넘길 것

> **완료 기준**: 메시지를 보내면 "accepted" ACK는 오고, Kafka 토픽에 쌓임

### Phase 4: Worker (consumer)로 DB 저장 + dedup

1. chat-worker에서 토픽 consume
2. DB insert + unique dedup
3. `rooms.last_message` 업데이트
4. REST로 messages 조회 시 저장된 로그가 보임

> **완료 기준**: WS로 보낸 메시지가 DB에 남고, 중복 전송해도 1번만 저장됨

### Phase 5: Persisted 이벤트 기반 브로드캐스트 (완성형)

1. Worker가 저장 성공 시 persisted 토픽 발행
2. Gateway가 persisted 토픽을 subscribe
3. 해당 room에 브로드캐스트 (온라인 사용자에게)
4. 클라이언트는 `messageId`로 중복 렌더링 방지

> **완료 기준**: 저장된 메시지만 실시간으로 브로드캐스트됨. Gateway/Worker 재시작에도 유실 없이 복구 가능 (REST).

---

## 9. 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|---------|-----------|
| 1 | 네트워크 끊김: 보낸 메시지 ACK 못 받았을 때 재전송 | DB 중복 저장 없음 |
| 2 | Consumer 재시작: 메시지 처리 중 죽여서 재처리 | 결과는 1건 저장 |
| 3 | Gateway 다중 인스턴스 (선택): 두 개 띄우고도 브로드캐스트 | 정상 동작 |
| 4 | 재접속 동기화: WS 끊고 다시 연결 | REST after-cursor로 누락 복구 |

---

## 10. 산출물 (포트폴리오 관점)

README에 꼭 남길 것:

- at-least-once 설계 이유
- 중복 제거 전략 (DB unique + clientMsgId)
- 재접속 동기화 (cursor pagination)
- Redis presence TTL 설계
- Kafka 토픽 설계 (key=roomId로 ordering)

---

## 부록: 추가 확장 옵션

필요 시 다음을 템플릿 형태로 확장 가능:

- 폴더 구조 (모노레포) 구체 트리
- TypeORM schema.sql / migration 초안
- Kafka 이벤트 DTO / 버전관리 방식
- NestJS Gateway 샘플 코드 (인증 + publish + ACK)
- Worker consumer 샘플 코드 (consume + DB insert + dedup)
