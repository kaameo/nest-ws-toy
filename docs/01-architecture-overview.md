# Architecture Overview

## 프로젝트 소개

NestJS 모노레포 기반 실시간 채팅 시스템. NestJS + WebSocket(Socket.IO) + Kafka를 활용한 **두 단계(Two-Tier) 메시지 처리** 아키텍처를 학습하기 위한 프로젝트.

## 시스템 구성도

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                         │
│                     public/index.html                           │
└──────────┬──────────────────────────────────┬───────────────────┘
           │ HTTP REST                        │ Socket.IO (WS)
           ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   chat-gateway (port 3000)                          │
│                                                                     │
│  ┌───────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────────────┐ │
│  │ AuthModule│ │RoomsModule│ │MessagesModule│ │  GatewayModule    │ │
│  │ (JWT)     │ │ (CRUD)    │ │ (조회/커서)    │ │ ChatGateway(WS)   │ │
│  └───────────┘ └───────────┘ └──────────────┘ │ BroadcastCtrl     │ │
│                                               │ KafkaProducer     │ │
│  ┌────────────┐ ┌──────────────┐              │ PresenceService   │ │
│  │HealthModule│ │PresenceModule│              └───────────────────┘ │
│  │ (DB+Redis) │ │ (Redis TTL)  │                                    │
│  └────────────┘ └──────────────┘                                    │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │ Kafka Produce                    │ Kafka Consume
           │ chat.messages.v1                 │ chat.messages.persisted.v1
           ▼                                  │
┌──────────────────────────┐                  │
│        Kafka (KRaft)     │◄─────────────────┘
│   3 partitions per topic │
└──────────┬───────────────┘
           │ Kafka Consume
           │ chat.messages.v1
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   chat-worker (port 3001)                       │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   PersistorModule                         │  │
│  │  PersistorController  → PersistorService → FanoutService  │  │
│  │  (Kafka consume)        (DB INSERT)        (Kafka produce)│  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐  ┌──────────────────┐
│  PostgreSQL 15       │  │    Valkey 8      │
│  users, rooms,       │  │  presence:user:* │
│  room_members,       │  │  (TTL 60s)       │
│  messages            │  │                  │
└──────────────────────┘  └──────────────────┘
```

## 모노레포 구조

```
nest-ws-toy/
├── apps/
│   ├── chat-gateway/          # REST API + WebSocket Gateway (port 3000)
│   │   └── src/
│   │       ├── auth/          # JWT 인증 (register, login, strategy, guard)
│   │       ├── gateway/       # WebSocket 게이트웨이 + Kafka broadcast 컨트롤러
│   │       ├── rooms/         # 방 CRUD, 멤버십 관리
│   │       ├── messages/      # 메시지 조회, 커서 기반 페이지네이션, 읽음 처리
│   │       ├── presence/      # Redis 기반 접속 상태 추적
│   │       ├── kafka/         # Kafka producer 모듈
│   │       └── health/        # DB + Redis 헬스체크
│   │
│   └── chat-worker/           # Kafka Consumer (port 3001)
│       └── src/
│           ├── persistor/     # Kafka → DB 저장 (중복 제거)
│           └── fanout/        # 저장 완료 이벤트 Kafka 발행
│
├── libs/
│   ├── common/                # 공유 DTO, Kafka 이벤트 스키마, 유틸리티
│   ├── db/                    # TypeORM 엔티티 + DB 모듈
│   └── redis/                 # ioredis 다이나믹 모듈
│
├── public/
│   └── index.html             # 채팅 테스트 클라이언트 (브라우저)
│
├── docker-compose.yml         # PostgreSQL, Valkey, Kafka, Kafka UI
└── .env                       # 환경변수
```

## 인프라 구성 (Docker Compose)

| 서비스 | 이미지 | 포트 | 역할 |
|--------|--------|------|------|
| postgres | postgres:15-alpine | 5432 | 메시지, 사용자, 방 저장 |
| redis | valkey/valkey:8-alpine | 6379 | 접속 상태(Presence) 관리 |
| kafka | apache/kafka:3.7.0 (KRaft) | 29092 | 메시지 이벤트 브로커 |
| kafka-init | apache/kafka:3.7.0 | - | 토픽 자동 생성 후 종료 |
| kafka-ui | provectuslabs/kafka-ui | 8080 | Kafka 모니터링 UI |

## Gateway vs Worker: 독립 프로세스 구조

Gateway와 Worker는 **별도 프로세스**로 실행되며, Kafka를 통해서만 통신한다.

### chat-gateway (port 3000)

| 항목 | 내용 |
|------|------|
| **역할** | 클라이언트 접점. REST API + WebSocket + Kafka 브로드캐스트 |
| **Kafka clientId** | `chat-service-gateway` |
| **Kafka groupId** | `chat-broadcast` |
| **구독 토픽** | `chat.messages.persisted.v1` (Worker가 저장 완료한 메시지 수신 → WebSocket 브로드캐스트) |
| **발행 토픽** | `chat.messages.v1` (클라이언트 메시지를 Worker에 전달) |
| **의존 인프라** | PostgreSQL (조회), Valkey (Presence, 멤버십 캐시), Kafka |

**하는 일:**

1. JWT 기반 인증 (회원가입, 로그인)
2. 방 CRUD 및 멤버십 관리
3. 메시지 조회 (커서 기반 페이지네이션)
4. WebSocket 연결 관리 (Socket.IO)
5. 클라이언트 메시지 수신 → Kafka 발행 → 즉시 ACK
6. Worker가 저장한 메시지를 Kafka에서 수신 → 해당 방에 WebSocket 브로드캐스트
7. Presence 관리 (온라인 상태, 하트비트)

### chat-worker (port 3001)

| 항목 | 내용 |
|------|------|
| **역할** | 백그라운드 처리. Kafka 소비 → DB 저장 → 완료 이벤트 발행 |
| **Kafka clientId** | `chat-service-worker` |
| **Kafka groupId** | `chat-persistor` |
| **구독 토픽** | `chat.messages.v1` (Gateway가 발행한 메시지 수신 → DB 저장) |
| **발행 토픽** | `chat.messages.persisted.v1` (저장 완료 이벤트 → Gateway에 전달) |
| **의존 인프라** | PostgreSQL (쓰기), Kafka |

**하는 일:**

1. Kafka에서 메시지 소비
2. Zod 스키마 검증
3. ULID 생성 후 PostgreSQL에 멱등 저장 (`ON CONFLICT DO NOTHING`)
4. 방 메타데이터 업데이트 (`lastMessageId`, `lastMessageAt`)
5. 저장 완료 이벤트를 Kafka에 발행

### 독립성과 장애 격리

```
Gateway 장애 시:
  - Worker는 정상 동작 (Kafka 메시지 계속 소비/저장)
  - 클라이언트 연결만 끊김, 재시작 후 자동 복구

Worker 장애 시:
  - Gateway는 정상 동작 (API, WebSocket 모두 정상)
  - 메시지 ACK는 반환되지만 DB 저장이 지연됨
  - Kafka에 메시지가 쌓이고, Worker 재시작 시 밀린 메시지 일괄 처리
  - 멱등 저장이므로 재처리해도 중복 없음
```

### 독립 스케일링

```
                    ┌─ gateway-1 (WS 연결 1000개)
Client ─── LB ─────┤
                    └─ gateway-2 (WS 연결 1000개)
                         │
                         ▼
                       Kafka
                         │
                    ┌─ worker-1 (파티션 0,1)
                    ┤
                    └─ worker-2 (파티션 2)
```

- **Gateway**: 수평 확장 시 각 인스턴스가 같은 `chat-broadcast` 그룹으로 Kafka 소비 → 파티션 분배
- **Worker**: 수평 확장 시 각 인스턴스가 같은 `chat-persistor` 그룹으로 파티션 분배 → 처리량 증가
- 토픽당 3개 파티션이므로 각 역할 최대 3개 인스턴스까지 파티션 1:1 배분 가능

## Path Aliases

| 별칭 | 실제 경로 |
|------|-----------|
| `@app/common` | `libs/common/src` |
| `@app/db` | `libs/db/src` |
| `@app/redis` | `libs/redis/src` |
