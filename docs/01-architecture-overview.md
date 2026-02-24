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

## Path Aliases

| 별칭 | 실제 경로 |
|------|-----------|
| `@app/common` | `libs/common/src` |
| `@app/db` | `libs/db/src` |
| `@app/redis` | `libs/redis/src` |
