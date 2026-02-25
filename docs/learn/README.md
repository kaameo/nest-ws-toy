# NestJS 실전 학습 가이드

이 가이드는 `nest-ws-toy` 프로젝트의 실제 코드를 기반으로 NestJS의 핵심 개념을 단계적으로 학습할 수 있도록 구성되었습니다. 각 Phase는 이전 Phase의 개념을 기반으로 쌓이므로 순서대로 읽는 것을 권장합니다.

## 프로젝트 개요

**실시간 채팅 시스템** — Gateway(HTTP + WebSocket)와 Worker(Kafka 컨슈머)로 구성된 NestJS 모노레포입니다.

```
클라이언트
   ↓ Socket.IO sendMessage
chat-gateway (포트 3000)
   ↓ Kafka: chat.messages.v1
chat-worker (포트 3001)
   ↓ PostgreSQL INSERT (멱등성)
   ↓ Kafka: chat.messages.persisted.v1
chat-gateway BroadcastController
   ↓ Socket.IO newMessage
클라이언트들
```

## 학습 Phase 목차

| Phase | 파일 | 핵심 개념 | 난이도 |
|-------|------|-----------|--------|
| 1 | [01-nestjs-fundamentals.md](./01-nestjs-fundamentals.md) | 모노레포, 부트스트랩, ConfigModule | ⭐ |
| 2 | [02-shared-libraries.md](./02-shared-libraries.md) | TypeORM, DynamicModule, 커스텀 Pipe | ⭐⭐ |
| 3 | [03-authentication.md](./03-authentication.md) | JWT, Passport, Guards | ⭐⭐ |
| 4 | [04-rest-api.md](./04-rest-api.md) | Controllers, Services, 캐싱 | ⭐⭐ |
| 5 | [05-websocket.md](./05-websocket.md) | Socket.IO, Presence, 실시간 통신 | ⭐⭐⭐ |
| 6 | [06-kafka-messaging.md](./06-kafka-messaging.md) | Kafka, 마이크로서비스, 이벤트 드리븐 | ⭐⭐⭐ |
| 7 | [07-operational.md](./07-operational.md) | Health Check, Docker, 인프라 | ⭐⭐ |
| 참조 | [08-architecture-decisions.md](./08-architecture-decisions.md) | 설계 결정 및 트레이드오프 | - |
| 참조 | [09-concept-index.md](./09-concept-index.md) | NestJS 개념 인덱스 | - |

## 읽는 순서 권장사항

### 처음 NestJS를 배우는 경우
Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 순서로 읽으세요.

### NestJS 기초는 알지만 실전 패턴이 궁금한 경우
- **인증 패턴**: Phase 3
- **Redis 캐시-어사이드**: Phase 4
- **WebSocket + JWT**: Phase 5
- **Kafka 이벤트 드리븐**: Phase 6

### 아키텍처 결정 이유가 궁금한 경우
[08-architecture-decisions.md](./08-architecture-decisions.md)를 먼저 읽으세요.

### 특정 NestJS 개념의 위치가 궁금한 경우
[09-concept-index.md](./09-concept-index.md)에서 개념별로 해당 파일을 찾을 수 있습니다.

## 프로젝트 구조 요약

```
nest-ws-toy/
├── apps/
│   ├── chat-gateway/src/      # HTTP API + WebSocket 서버
│   │   ├── auth/              # JWT 인증
│   │   ├── rooms/             # 채팅방 CRUD
│   │   ├── messages/          # 메시지 조회
│   │   ├── gateway/           # Socket.IO + Kafka 컨슈머
│   │   ├── presence/          # Redis 접속 상태 추적
│   │   ├── kafka/             # Kafka 프로듀서
│   │   └── health/            # 헬스체크
│   └── chat-worker/src/       # Kafka 컨슈머 워커
│       ├── persistor/         # DB 저장 (멱등성)
│       └── fanout/            # 두 번째 Kafka 발행
└── libs/
    ├── common/src/            # 공유 DTO, 이벤트 스키마, 유틸
    ├── db/src/                # TypeORM 엔티티 + DbModule
    └── redis/src/             # ioredis DynamicModule
```
