# Testing (테스트)

## 테스트 실행

```bash
pnpm test              # 전체 단위 테스트
pnpm test:watch        # 워치 모드
pnpm test:cov          # 커버리지 리포트
pnpm test:e2e          # E2E 테스트 (Docker 필요)

# 특정 패턴
npx jest --testPathPattern=auth
npx jest --testPathPattern=presence
```

## 단위 테스트 목록

| 파일 | 테스트 대상 | 주요 케이스 |
|------|------------|------------|
| `auth/auth.service.spec.ts` | AuthService | 회원가입 성공/중복, 로그인 성공/이메일 틀림/비밀번호 틀림 |
| `rooms/rooms.service.spec.ts` | RoomsService | 방 생성, 참가 성공/방 없음/중복, 멤버십 확인(캐시 miss/hit), Redis 캐싱 검증 |
| `messages/messages.service.spec.ts` | MessagesService | 메시지 조회(멤버/비멤버), 읽음 커서 업데이트(RoomsService 위임) |
| `presence/presence.service.spec.ts` | PresenceService | 온라인 등록, 오프라인(마지막 소켓/잔여 소켓), TTL 갱신, 온라인 확인 |
| `persistor/persistor.service.spec.ts` | PersistorService | 저장 성공+fanout, 중복 감지(fanout 스킵) |

## E2E 테스트

### HTTP E2E (`test/app.e2e-spec.ts`)

실제 PostgreSQL + Redis 연결. Kafka producer는 mock.

| 그룹 | 테스트 |
|------|--------|
| Auth | 회원가입, 로그인, 중복 이메일, 틀린 비밀번호 |
| Rooms | 방 생성, 참가, 목록 조회, 멤버 조회 |
| Messages | 빈 메시지 조회, 읽음 커서 |
| Guard | 토큰 없이 접근 시 401 |

### WebSocket E2E (`test/ws.e2e-spec.ts`)

Socket.IO 클라이언트로 실제 WebSocket 연결 테스트.

| 테스트 | 검증 |
|--------|------|
| 유효한 토큰으로 연결 | 연결 성공 |
| 잘못된 토큰으로 연결 | 연결 거부 |
| 멤버가 joinRoom | 성공 ACK |
| 비멤버가 joinRoom | 실패 ACK |
| sendMessage | Kafka publish mock 호출 확인 |
| heartbeat | `{ success: true }` ACK |

## 테스트 구조

### Mock 전략

```typescript
// 리포지토리 mock
const mockUserRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};

// 서비스 mock
const mockKafkaProducerService = {
  publish: jest.fn().mockResolvedValue(undefined),
};

// Redis mock (PresenceService - Hash 기반 접속 상태)
const mockRedisPresence = {
  hset: jest.fn(),
  hdel: jest.fn(),
  hgetall: jest.fn(),
  hexists: jest.fn(),
  expire: jest.fn(),
  exists: jest.fn(),
  del: jest.fn(),
};

// Redis mock (RoomsService - membership 캐시)
const mockRedisMembership = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
};
```

### E2E 테스트 설정

```typescript
// 랜덤 포트로 실행
await app.listen(0);
const port = app.getHttpServer().address().port;

// Socket.IO 클라이언트 연결
socket = io(`http://localhost:${port}`, {
  auth: { token: validToken },
  transports: ['websocket'],
});
```

## 커버리지 갭

현재 테스트가 없는 영역:

| 영역 | 비고 |
|------|------|
| `ChatGateway` 클래스 | 연결 인증, 메시지 디스패치 로직 |
| `BroadcastController` | Kafka → WebSocket 브로드캐스트 |
| `KafkaProducerService` | Kafka 연결, 발행 |
| `FanoutService` | Worker Kafka 발행 |
| `ZodValidationPipe` | 파이프 변환 로직 |
| 컨트롤러 (Auth, Rooms, Messages) | HTTP 레이어 |
| Worker 앱 전체 E2E | Gateway → Kafka → Worker → Kafka → Gateway |
| 전체 메시지 흐름 통합 테스트 | end-to-end |
