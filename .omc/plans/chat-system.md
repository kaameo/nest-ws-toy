# NestJS 실시간 채팅 시스템 구현 계획

**생성일**: 2026-02-23
**PRD**: `/Users/jshong/Desktop/work-space/nest-ws-toy/PRD.md`
**복잡도**: HIGH (5 Phase, 2 apps, 3 libs, 외부 인프라 4종)

---

## Context

NestJS 모노레포 기반 실시간 채팅 시스템. WebSocket Gateway + Kafka + PostgreSQL + Redis로 at-least-once 전달, 중복 제거, 재접속 동기화를 구현한다. 토이 프로젝트이지만 운영 가능한 품질을 목표로 한다.

---

## 최종 디렉토리 구조

```
nest-ws-toy/
├── docker-compose.yml
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── .env.example
├── apps/
│   ├── chat-gateway/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   ├── ws-jwt.guard.ts
│   │   │   │   └── auth.controller.spec.ts
│   │   │   ├── rooms/
│   │   │   │   ├── rooms.module.ts
│   │   │   │   ├── rooms.controller.ts
│   │   │   │   ├── rooms.service.ts
│   │   │   │   └── rooms.controller.spec.ts
│   │   │   ├── messages/
│   │   │   │   ├── messages.module.ts
│   │   │   │   ├── messages.controller.ts        # REST 히스토리/읽음커서
│   │   │   │   ├── messages.service.ts
│   │   │   │   └── messages.controller.spec.ts
│   │   │   ├── gateway/
│   │   │   │   ├── chat.gateway.ts               # WebSocket Gateway
│   │   │   │   ├── chat.gateway.spec.ts
│   │   │   │   └── gateway.module.ts
│   │   │   └── presence/
│   │   │       ├── presence.module.ts
│   │   │       ├── presence.service.ts
│   │   │       └── presence.service.spec.ts
│   │   └── test/
│   │       └── app.e2e-spec.ts
│   └── chat-worker/
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── persistor/
│       │   │   ├── persistor.module.ts
│       │   │   ├── persistor.service.ts          # Kafka consumer → DB insert
│       │   │   └── persistor.service.spec.ts
│       │   └── fanout/
│       │       ├── fanout.module.ts
│       │       ├── fanout.service.ts             # persisted 이벤트 발행
│       │       └── fanout.service.spec.ts
│       └── test/
│           └── app.e2e-spec.ts
├── libs/
│   ├── common/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── dto/
│   │       │   ├── auth.dto.ts
│   │       │   ├── room.dto.ts
│   │       │   ├── message.dto.ts
│   │       │   └── ws-events.dto.ts
│   │       ├── events/
│   │       │   ├── message-created.event.ts
│   │       │   └── message-persisted.event.ts
│   │       └── utils/
│   │           ├── ulid.ts
│   │           └── pagination.ts
│   ├── db/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── db.module.ts
│   │       ├── entities/
│   │       │   ├── user.entity.ts
│   │       │   ├── room.entity.ts
│   │       │   ├── room-member.entity.ts
│   │       │   └── message.entity.ts
│   │       └── migrations/
│   └── redis/
│       └── src/
│           ├── index.ts
│           ├── redis.module.ts
│           └── redis.service.ts
└── test/
    └── jest-e2e.json
```

---

## Guardrails

### 필수 (MVP) — PRD 직접 요구
- at-least-once 전달 (Kafka publish 성공 후 ACK)
- Kafka producer acks=all
- DB unique constraint (room_id, sender_id, client_msg_id) 중복 방지
- Redis presence TTL 60s + heartbeat 20s
- cursor 기반 메시지 히스토리 (ULID 정렬)
- Zod 입력 검증
- Immutable 패턴 (coding style 규칙 준수)

### 권장 (운영성 강화) — 확장 품질
- TDD 접근, 80%+ 커버리지
- `@nestjs/config` + Zod 환경변수 검증 (앱 기동 시 필수값 누락 즉시 실패)
- `@nestjs/terminus` health check (`/health` 엔드포인트: DB, Redis, Kafka)
- `enableShutdownHooks()` graceful shutdown (WS 연결 정리)
- NestJS Logger (console.log 금지)
- Kafka 설정은 `libs/common/src/events/`에 상수로 관리

### Must NOT Have
- 직접 DB mutation 없이 항상 새 객체 반환
- console.log 사용 금지 (NestJS Logger 사용)
- 하드코딩된 시크릿 (모두 .env)
- gateway에서 직접 DB 저장 (반드시 worker 경유)

---

## Phase 1: 인프라 + 기본 뼈대

**의존성**: 없음 (첫 Phase)
**예상 파일**: ~25개

### Task 1.1: NestJS 모노레포 스캐폴딩

**작업 내용**:
- `nest new nest-ws-toy --strict` 후 모노레포 구조로 전환
- `nest-cli.json`에 `chat-gateway`, `chat-worker` 앱 등록
- `libs/common`, `libs/db`, `libs/redis` 라이브러리 생성
- `tsconfig.json` paths 설정
- 공통 의존성 설치: `@nestjs/typeorm`, `typeorm`, `pg`, `ioredis`, `@nestjs/microservices`, `kafkajs`, `ulid`, `zod`, `class-validator`, `class-transformer`, `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`

**수용 기준**:
- [ ] `nest build chat-gateway` 성공
- [ ] `nest build chat-worker` 성공
- [ ] `libs/common`에서 export한 타입을 두 앱에서 import 가능

### Task 1.2: Docker Compose 인프라

**작업 내용**:
- `docker-compose.yml` 작성: PostgreSQL 15, Redis 7, Kafka (KRaft 모드), Kafka UI (옵션)
- `.env.example` 작성 (DB_HOST, REDIS_HOST, KAFKA_BROKERS, JWT_SECRET 등)

**수용 기준**:
- [ ] `docker-compose up -d` 후 PostgreSQL 접속 OK
- [ ] Redis `PING` → `PONG`
- [ ] Kafka topic 생성/produce/consume 테스트 OK

### Task 1.3: TypeORM 엔티티 + 마이그레이션

**작업 내용**:
- `libs/db/src/entities/`: `user.entity.ts`, `room.entity.ts`, `room-member.entity.ts`, `message.entity.ts`
- `message.entity.ts`: ULID PK, `@Unique(['roomId', 'senderId', 'clientMsgId'])`, `@Index(['roomId', 'id'])`
- `room-member.entity.ts`: 복합 PK `(roomId, userId)`, `lastReadMessageId` nullable
- `libs/db/src/db.module.ts`: TypeOrmModule.forRootAsync 설정
- 초기 마이그레이션 생성

**수용 기준**:
- [ ] 마이그레이션 실행 후 4개 테이블 생성 확인
- [ ] messages 테이블에 unique constraint 존재 확인
- [ ] 엔티티 단위 테스트 (유효성 검증)

### Task 1.4: Auth 모듈 (JWT)

**작업 내용**:
- `apps/chat-gateway/src/auth/`: register, login 엔드포인트
- bcrypt 해싱, JWT 발급/검증
- `JwtStrategy`, `JwtAuthGuard`
- `libs/common/src/dto/auth.dto.ts`: Zod 스키마로 입력 검증

**수용 기준**:
- [ ] `POST /auth/register` → 201 (유저 생성)
- [ ] `POST /auth/login` → JWT 토큰 반환
- [ ] 잘못된 입력 → 400 (Zod 검증)
- [ ] 단위 테스트 통과

### Task 1.5: Room/Member CRUD (REST)

**작업 내용**:
- `apps/chat-gateway/src/rooms/`: 방 생성, 참여, 목록, 멤버 조회
- JWT 인증 필수
- `libs/common/src/dto/room.dto.ts`: Zod 스키마

**수용 기준**:
- [ ] `POST /rooms` → 방 생성 (인증 필요)
- [ ] `POST /rooms/:roomId/join` → 방 참여
- [ ] `GET /rooms` → 내 방 목록
- [ ] `GET /rooms/:roomId/members` → 멤버 목록
- [ ] 비인증 요청 → 401
- [ ] 단위/통합 테스트 통과

### Task 1.6: 운영 기반 설정

**작업 내용**:
- `@nestjs/config` + Zod로 환경변수 스키마 검증 (앱 기동 시 필수값 누락 즉시 실패)
- `@nestjs/terminus` health check: `/health` 엔드포인트 (DB, Redis, Kafka 연결 상태 확인)
- 각 앱 `main.ts`에 `app.enableShutdownHooks()` 추가 (graceful shutdown 시 WS 연결 정리)
- NestJS Logger 전역 설정, `console.log` 사용 금지 강화

**수용 기준**:
- [ ] 필수 환경변수 누락 시 앱 기동 실패 + 명확한 에러 메시지
- [ ] `GET /health` → 200 OK (DB, Redis, Kafka 모두 정상 시)
- [ ] graceful shutdown 시 WS 연결 정리 확인 (SIGTERM 시 열린 소켓 close)
- [ ] 단위 테스트 통과

---

## Phase 2: WebSocket Gateway + Redis Presence

**의존성**: Phase 1 완료
**예상 파일**: ~10개 추가

### Task 2.1: WebSocket Gateway + JWT 인증

**작업 내용**:
- `apps/chat-gateway/src/gateway/chat.gateway.ts`: `@WebSocketGateway()` 구현
- Handshake 시 `Authorization` 헤더에서 JWT 검증 (`ws-jwt.guard.ts`)
- `handleConnection`: 인증 실패 시 disconnect
- `@SubscribeMessage('joinRoom')`: room_members 확인 후 Socket.IO room join

**수용 기준**:
- [ ] 유효한 JWT로 WS 연결 성공
- [ ] 잘못된/없는 JWT로 연결 시 즉시 disconnect
- [ ] `joinRoom` 이벤트로 방 참여 가능 (멤버 아닌 경우 에러)
- [ ] 단위 테스트 통과

### Task 2.2: Redis Presence 서비스

**작업 내용**:
- `libs/redis/src/redis.module.ts`: ioredis 기반 동적 모듈
- `apps/chat-gateway/src/presence/presence.service.ts`:
  - `setOnline(userId, serverId, socketId)`: `presence:user:{userId}` hash SET + TTL 60s (socketId 필드 포함)
  - `refreshTTL(userId)`: TTL 갱신
  - `setOffline(userId, socketId)`: 해당 socketId만 제거, 모든 socketId 소멸 시 offline (복수 디바이스/탭 대응)
  - `isOnline(userId)`: 존재 여부 확인
- `handleConnection` 시 `setOnline` 호출
- `handleDisconnect` 시 `setOffline(userId, socket.id)` 호출 → 해당 socketId만 제거
- `@SubscribeMessage('heartbeat')`: `refreshTTL` 호출

**수용 기준**:
- [ ] WS 연결 시 Redis에 presence 키 생성 (TTL 60s)
- [ ] heartbeat 수신 시 TTL 갱신
- [ ] disconnect 시 키 삭제
- [ ] 60초 무응답 시 TTL 만료로 자동 offline
- [ ] 단위 테스트 통과 (Redis mock)

---

## Phase 3: Kafka Publish + At-Least-Once ACK

**의존성**: Phase 2 완료
**예상 파일**: ~8개 추가

### Task 3.1: Kafka 프로듀서 설정

**작업 내용**:
- `apps/chat-gateway/src/app.module.ts`에 `ClientsModule.register` (Kafka transport)
- Kafka producer 설정에 `acks: -1` (all) 적용, `idempotent: true`, `retries: 3` 옵션 설정
- `libs/common/src/events/message-created.event.ts`: 이벤트 스키마 정의
- `libs/common/src/utils/ulid.ts`: ULID 생성 유틸

**수용 기준**:
- [ ] Kafka client 연결 성공
- [ ] producer 설정에서 acks=-1(all) 확인
- [ ] 이벤트 스키마 Zod 검증 통과
- [ ] ULID 유틸 단위 테스트 통과

### Task 3.2: SEND_MESSAGE → Kafka → ACK 플로우

**작업 내용**:
- `chat.gateway.ts`에 `@SubscribeMessage('sendMessage')` 추가:
  1. JWT에서 userId 추출
  2. room_members 권한 확인
  3. `MessageCreatedEvent` 생성 (clientMsgId 포함)
  4. Kafka `chat.messages.v1` 토픽에 publish (key=roomId)
  5. publish 성공 시 클라이언트에 `{ clientMsgId, status: 'ACCEPTED' }` ACK 전송
  6. publish 실패 시 `{ clientMsgId, status: 'FAILED' }` 에러 전송
- `libs/common/src/dto/ws-events.dto.ts`: WS 이벤트 DTO 정의

**수용 기준**:
- [ ] 메시지 전송 → Kafka 토픽에 이벤트 적재 확인
- [ ] 클라이언트에 ACCEPTED ACK 수신
- [ ] clientMsgId가 요청-응답 간 일치
- [ ] 비멤버 전송 시 에러 응답
- [ ] 통합 테스트 통과

---

## Phase 4: Worker Consumer + DB 저장 + Dedup

**의존성**: Phase 3 완료
**예상 파일**: ~6개 추가

### Task 4.1: Chat Worker Consumer

**작업 내용**:
- `apps/chat-worker/src/persistor/persistor.service.ts`:
  1. `chat.messages.v1` 토픽 consume (consumer group: `chat-persistor`)
  2. 이벤트에서 Message 엔티티 생성 (ULID ID)
  3. INSERT + `rooms.lastMessage` 갱신을 **하나의 TypeORM 트랜잭션**으로 래핑
  4. 중복 처리는 `ON CONFLICT DO NOTHING` (`queryBuilder.orIgnore()`) 사용. try-catch 방식 사용 금지
  5. `rooms.lastMessageId`, `rooms.lastMessageAt` 업데이트
  6. offset commit

**수용 기준**:
- [ ] Kafka 메시지 consume → DB에 메시지 저장
- [ ] 동일 clientMsgId 중복 전송 시 1건만 저장
- [ ] rooms.lastMessageId 정상 갱신
- [ ] consumer 재시작 후 미처리 메시지 재처리 → 중복 없이 저장
- [ ] 단위/통합 테스트 통과

### Task 4.2: REST 메시지 히스토리 + 읽음 커서

**작업 내용**:
- `apps/chat-gateway/src/messages/messages.controller.ts`:
  - `GET /rooms/:roomId/messages?before={id}&limit=50`: cursor 기반 이전 메시지
  - `GET /rooms/:roomId/messages?after={id}&limit=50`: cursor 기반 이후 메시지 (재접속 동기화)
  - `POST /rooms/:roomId/read`: `lastReadMessageId` 업데이트
- `libs/common/src/utils/pagination.ts`: cursor 페이지네이션 유틸
- `libs/common/src/dto/message.dto.ts`: 응답 DTO

**수용 기준**:
- [ ] before cursor로 과거 메시지 50건씩 조회
- [ ] after cursor로 미수신 메시지 조회 (재접속 동기화)
- [ ] 읽음 커서 업데이트 정상
- [ ] 비멤버 조회 시 403
- [ ] 단위/통합 테스트 통과

---

## Phase 5: Persisted 이벤트 브로드캐스트

**의존성**: Phase 4 완료
**예상 파일**: ~4개 추가

### Task 5.1: Worker → Persisted 이벤트 발행

**작업 내용**:
- `apps/chat-worker/src/fanout/fanout.service.ts`:
  - DB 저장 성공 후 `chat.messages.persisted.v1` 토픽에 발행
  - payload: 저장된 메시지의 전체 정보 (DB ID 포함)
- `libs/common/src/events/message-persisted.event.ts`: 이벤트 스키마

**수용 기준**:
- [ ] DB 저장 성공 시 persisted 토픽에 이벤트 발행
- [ ] 중복 저장 시 (이미 존재) persisted 이벤트 미발행
- [ ] 단위 테스트 통과

### Task 5.2: Gateway → Persisted 구독 + Room 브로드캐스트

**작업 내용**:
- `apps/chat-gateway/src/gateway/chat.gateway.ts`에 Kafka consumer 추가:
  - `chat.messages.persisted.v1` 토픽 구독 (consumer group: `chat-broadcast`)
  - 이벤트의 roomId로 Socket.IO room에 `newMessage` 이벤트 emit
  - 발신자 본인에게도 전송 (클라이언트가 clientMsgId로 중복 렌더링 방지)

**수용 기준**:
- [ ] DB 저장된 메시지만 실시간 브로드캐스트됨
- [ ] 같은 room의 모든 온라인 멤버에게 전달
- [ ] gateway 재시작 후에도 consumer group offset부터 재개
- [ ] E2E 테스트: 2명 유저가 방에서 메시지 송수신 성공
- [ ] E2E: 첫 전송 후 ACK 수신 전 연결 종료 시뮬레이션 → 동일 clientMsgId로 재전송 → DB에 1건만 저장 검증
- [ ] 전체 테스트 커버리지 80%+

---

## Phase 6: 문서화 + 산출물

**의존성**: Phase 5 완료

### Task 6.1: README 아키텍처 문서화

**작업 내용**:
- README.md에 다음 항목 문서화:
  - at-least-once 설계 이유 및 메시지 보장 모델
  - 중복 제거 전략 (DB unique + clientMsgId)
  - 재접속 동기화 흐름 (cursor pagination)
  - Redis presence TTL 설계
  - Kafka 토픽 설계 (key=roomId ordering)
  - 메시지 플로우 시퀀스 다이어그램 (Mermaid)

**수용 기준**:
- [ ] README에 시퀀스 다이어그램 또는 단계별 흐름 설명 포함
- [ ] 설계 의사결정 이유가 명확히 기술됨
- [ ] 로컬 실행 가이드 (docker-compose up → 앱 실행) 포함

---

## 테스트 전략

| Phase | 테스트 유형 | 대상 |
|-------|------------|------|
| 1 | Unit + Integration | Auth, Room CRUD, Entity 유효성 |
| 2 | Unit + Integration | WS 연결/인증, Presence (Redis mock) |
| 3 | Unit + Integration | Kafka publish, ACK 플로우 (Kafka mock) |
| 4 | Unit + Integration | Consumer dedup, 커서 페이지네이션 |
| 5 | Unit + E2E | 전체 플로우 (docker-compose 기반) |

**TDD 접근**: 각 Task에서 테스트를 먼저 작성 (RED) → 구현 (GREEN) → 리팩토링 (IMPROVE)

---

## 리스크 및 완화

| 리스크 | 영향 | 완화 |
|--------|------|------|
| Kafka KRaft 모드 설정 복잡 | Phase 1 지연 | Confluent docker 이미지 사용, 안되면 Zookeeper 모드 폴백 |
| TypeORM unique constraint ON CONFLICT 처리 | Phase 4 dedup 실패 | `queryBuilder.orIgnore()` 또는 raw query 사용 |
| Socket.IO + Kafka consumer 동시 실행 | Phase 5 안정성 | NestJS hybrid application 패턴 사용 |
| Redis 연결 끊김 시 presence 불일치 | Phase 2 장애 | TTL 기반 자동 복구, reconnect 로직 |
| 모노레포 빌드 경로 꼬임 | 전 Phase | nest-cli.json paths 초기에 정확히 설정 |
| 다중 Gateway 인스턴스 시 consumer group 파티션 분배 | Phase 5 브로드캐스트 누락 | 토이에서는 단일 인스턴스. 확장 시 인스턴스별 고유 consumer group 또는 Redis Pub/Sub fanout 필요 |

---

## Success Criteria

1. 2명 유저가 방에서 실시간 메시지 송수신 가능
2. 동일 메시지 중복 전송 시 DB에 1건만 저장
3. 재접속 후 REST cursor로 미수신 메시지 조회 가능
4. gateway/worker 재시작에도 메시지 유실 없음
5. 전체 테스트 커버리지 80% 이상
