# 아키텍처 결정 사항 및 트레이드오프 분석

이 문서는 `nest-ws-toy` 프로젝트에서 내린 주요 설계 결정을 기록합니다. "왜 이렇게 했는가"와 "어떤 트레이드오프가 있는가"를 이해하면 실전에서 더 나은 결정을 내릴 수 있습니다.

---

## 1. Gateway / Worker 분리 (CQRS-like)

### 결정

HTTP API + WebSocket을 담당하는 `chat-gateway`와 메시지 영속화를 담당하는 `chat-worker`를 별도 프로세스로 분리했습니다.

### 이유

**관심사의 분리:**
```
chat-gateway: 클라이언트 인터페이스 (읽기 + 수신 처리)
chat-worker:  비즈니스 로직 실행 (쓰기 + 부수 효과)
```

**독립 확장:**
- 메시지 전송이 많아지면 Worker만 수평 확장 가능
- Socket.IO 연결이 많아지면 Gateway만 확장 가능

**장애 격리:**
- Worker DB 연결 실패 → Gateway의 WebSocket 서빙에 영향 없음
- Gateway 배포 재시작 → Kafka offset 보존으로 메시지 손실 없음

### 트레이드오프

| 장점 | 단점 |
|------|------|
| 독립 배포/확장 | 메시지가 DB에 저장되는 데 지연 발생 (비동기) |
| 장애 격리 | 로컬 개발 시 두 프로세스 동시 실행 필요 |
| 역할 명확화 | 분산 트레이싱 없이는 디버깅 복잡 |

### 관련 패턴

이 구조는 **CQRS(Command Query Responsibility Segregation)** 와 유사합니다. 엄밀한 CQRS는 아니지만, 쓰기 경로(Kafka → Worker → DB)와 읽기 경로(HTTP → Gateway → DB)를 분리했습니다.

---

## 2. Kafka At-Least-Once + DB 멱등성

### 결정

Kafka의 at-least-once 전송 보장과 DB 레벨의 멱등성(`ON CONFLICT DO NOTHING`)을 조합해 중복 저장을 방지합니다.

### 구현

```typescript
// 프로듀서: idempotent=true
producer: { idempotent: true }  // acks=-1, 재시도 자동 설정

// DB: Unique 제약 + ON CONFLICT DO NOTHING
@Unique('UQ_messages_dedup', ['roomId', 'senderId', 'clientMsgId'])

insertResult = await manager
  .createQueryBuilder()
  .insert()
  .into(Message)
  .orIgnore()   // ON CONFLICT DO NOTHING
  .execute();
```

### 실제 보장 수준 분석

현재 구현이 제공하는 보장 수준은 구간별로 다릅니다:

| 구간 | 보장 수준 | 구현 |
|------|----------|------|
| Kafka 프로듀서 → 브로커 | Exactly-once | `idempotent: true` |
| DB INSERT | At-most-once per dedup key | `ON CONFLICT DO NOTHING` via `.orIgnore()` |
| 전체 파이프라인 | At-least-once (불완전) | 아래 갭 참고 |

### 3가지 갭

**GAP 1: auto-commit 미비활성화**

`apps/chat-worker/src/main.ts`와 `apps/chat-gateway/src/main.ts` consumer 설정에 `autoCommit: false`가 없습니다. KafkaJS 기본값 `autoCommit: true` (5초)로 인해 DB INSERT 완료 전 offset이 커밋될 수 있습니다. 크래시 시 메시지 유실이 발생합니다.

**GAP 2: DB write ↔ fanout publish 비원자적**

`persistor.service.ts`에서 DB 트랜잭션 커밋 후 fanout이 별도로 실행됩니다. 크래시 시 DB에는 저장되었지만 브로드캐스트가 실행되지 않을 수 있습니다. 재처리 시 `.orIgnore()` → `persisted: false` → fanout 스킵 → 영구 미전송 상태가 됩니다.

**GAP 3: 브로드캐스트 중복 방지 없음**

`broadcast.controller.ts`의 `server.to().emit()`은 fire-and-forget 방식입니다. Consumer 리밸런싱 시 중복 브로드캐스트가 가능하며, 클라이언트 측 dedup이 없습니다.

### 개선 방향

| 개선 항목 | 난이도 | 효과 |
|-----------|--------|------|
| Consumer `autoCommit: false` 설정 | 낮음 | at-least-once 보장 복원 |
| 중복 감지 시에도 fanout 재시도 | 중간 | 미전송 방지 |
| 클라이언트 `clientMsgId` 기반 dedup | 낮음 | 중복 브로드캐스트 처리 |
| Transactional Outbox 패턴 적용 | 높음 | DB write + fanout 원자성 확보 |

### 왜 Exactly-Once Kafka(트랜잭션 프로듀서)를 안 쓰는가?

Kafka의 트랜잭션 API(`transactional.id`)는 exactly-once를 보장하지만:
- 설정이 복잡하고 성능 오버헤드가 있습니다
- DB INSERT와 Kafka 발행을 원자적으로 묶는 것은 여전히 불가능합니다

DB 레벨 중복 제거가 더 단순하고 실용적입니다.

### 클라이언트 역할

```
클라이언트가 UUID를 생성해서 clientMsgId로 전송
  → 네트워크 오류로 재전송해도 같은 clientMsgId
  → DB에서 UNIQUE 위반 → ON CONFLICT DO NOTHING
  → 딱 1회만 저장 (단, GAP 2로 인해 브로드캐스트는 보장 안 됨)
```

### 트레이드오프

| 장점 | 단점 |
|------|------|
| 구현이 단순 | 클라이언트가 UUID를 생성해야 함 |
| DB가 진실의 단일 원천 | 중복 시 두 번째 INSERT가 무시되는 것을 명시적으로 감지해야 함 |
| Kafka 트랜잭션 불필요 | TTL 없는 `clientMsgId`는 영구 저장 |
| | GAP 2로 인해 DB 저장 후 브로드캐스트 누락 가능 |

---

## 3. Redis 캐시-어사이드(Cache-Aside) 패턴 (30초 TTL)

### 결정

멤버십 확인(`isMember`)을 Redis에 30초 TTL로 캐시합니다.

```typescript
const MEMBER_CACHE_TTL = 30; // seconds
const cacheKey = `membership:${roomId}:${userId}`;
```

### 이유

메시지를 전송할 때마다 `isMember`를 확인합니다. 채팅이 활발한 방에서는 초당 수백 번 조회가 발생할 수 있습니다. DB 조회를 매번 하면 불필요한 부하가 됩니다.

### TTL을 30초로 설정한 이유

- 너무 짧으면 (< 5초): 캐시 효과 미미, 잦은 DB 조회
- 너무 길면 (> 5분): 멤버십 변경 반영 지연 (방에서 강퇴되어도 5분간 메시지 전송 가능)
- 30초: 실시간 채팅에서 허용 가능한 불일치 수준

### 캐시 무효화

```typescript
async join(roomId, userId) {
  await this.memberRepository.save(member);
  await this.redis.del(`membership:${roomId}:${userId}`);  // 즉시 무효화
}
```

멤버십이 변경될 때 즉시 삭제합니다. Write-Through나 Write-Behind 대신 단순 삭제를 선택한 이유: "다음 요청 시 DB에서 최신값을 가져오는 것"이 가장 안전합니다.

### 트레이드오프

| 장점 | 단점 |
|------|------|
| DB 부하 감소 | 멤버십 변경 후 최대 30초 지연 |
| 구현 단순 | Redis 장애 시 모든 요청이 DB로 직접 |
| TTL로 자동 정리 | 캐시 히트율 모니터링 필요 |

---

## 4. Zod vs class-validator

### 결정

NestJS의 기본 검증 라이브러리인 `class-validator` 대신 Zod를 사용했습니다.

### 비교

**class-validator 방식:**
```typescript
import { IsEmail, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @MinLength(6)
  password: string;
}
// 타입과 검증이 분리됨
// 데코레이터는 런타임에만 존재 (TypeScript 타입 X)
```

**Zod 방식:**
```typescript
export const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;
// 스키마 = 타입 = 런타임 검증이 하나로 통합
```

### Zod를 선택한 이유

1. **타입 추론**: `z.infer<typeof Schema>`로 TypeScript 타입을 자동 생성합니다. 스키마와 타입이 항상 동기화됩니다.

2. **런타임 변환**: `z.coerce.number()`, `default()`, `transform()` 등으로 검증과 변환을 동시에 처리합니다.

3. **isomorphic**: 브라우저/Node.js 모두에서 동작합니다. 프론트엔드와 스키마를 공유할 수 있습니다.

4. **에러 메시지**: 구조화된 에러 정보(`path`, `message`)를 반환합니다.

### 트레이드오프

| Zod 장점 | Zod 단점 |
|----------|----------|
| 타입-스키마 통합 | class-validator보다 번들 크기 큼 |
| 변환 내장 | NestJS 생태계와 덜 통합 (내장 ValidationPipe 불가) |
| 함수형 API | 커스텀 파이프 직접 구현 필요 |

---

## 5. ULID vs UUID vs Auto-Increment

### 결정

메시지 PK로 ULID(Universally Unique Lexicographically Sortable Identifier)를 사용했습니다.

### 각 방식의 특성

**Auto-Increment (`1, 2, 3, ...`):**
- 장점: 가장 단순, 정렬 보장, 인덱스 효율 최고
- 단점: 분산 시스템에서 충돌, PK 예측 가능 (보안 문제), 마이그레이션 복잡

**UUID v4 (`550e8400-e29b-41d4-a716-446655440000`):**
- 장점: 글로벌 유니크, 분산 생성 가능
- 단점: 무작위 → B-Tree 인덱스 단편화, 정렬 불가

**ULID (`01ARZ3NDEKTSV4RRFFQ69G5FAV`):**
```
01ARZ3NDEK  TSVA RRFFQ69G5FAV
└─────────┘ └───────────────┘
타임스탬프    랜덤 (80비트)
(48비트)
```
- 장점: 시간순 정렬 가능, 글로벌 유니크, 커서 페이지네이션 자연스러움
- 단점: Auto-Increment보다 인덱스 효율 낮음, 외부 라이브러리 필요

### ULID를 선택한 이유

채팅 메시지의 핵심 요구사항:
1. **시간순 정렬**: 메시지는 항상 생성 순서대로 표시해야 합니다
2. **커서 페이지네이션**: `WHERE id < :cursor`가 "이 시간 이전" 의미를 가져야 합니다
3. **분산 생성**: Worker 인스턴스가 여러 개일 때도 DB 없이 고유 ID 생성이 가능해야 합니다

UUID는 1, 2번을 만족하지 못하고, Auto-Increment는 3번을 만족하지 못합니다.

### 사용자 ID는 UUID를 사용하는 이유

사용자(`users` 테이블)는 시간순 정렬이 필요 없고, TypeORM의 `@PrimaryGeneratedColumn('uuid')`로 간단하게 생성할 수 있기 때문입니다.

---

## 6. TypeORM 관계(@ManyToOne 등) 미사용

### 결정

엔티티 간 관계 데코레이터(`@ManyToOne`, `@OneToMany`, `@JoinColumn`)를 의도적으로 사용하지 않았습니다. 외래키는 일반 컬럼으로만 저장합니다.

```typescript
// 사용하지 않은 방식
@Entity('messages')
export class Message {
  @ManyToOne(() => Room)
  @JoinColumn({ name: 'room_id' })
  room: Room;       // Room 객체를 직접 로드
}

// 실제 사용 방식
@Entity('messages')
export class Message {
  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;   // ID만 저장
}
```

### 이유

1. **N+1 문제 방지**: `room.messages`를 실수로 접근하면 TypeORM이 자동으로 추가 쿼리를 발행합니다. 관계를 제거하면 이 위험이 없습니다.

2. **명시적인 조회**: 관련 데이터가 필요하면 명시적으로 JOIN 또는 별도 쿼리를 작성해야 합니다. 암묵적인 Lazy Loading이 없습니다.

3. **단순성**: 이 프로젝트 규모에서는 관계 객체 그래프 탐색이 필요하지 않습니다.

### 트레이드오프

| 장점 | 단점 |
|------|------|
| N+1 문제 없음 | TypeORM의 관계 기능(Eager/Lazy Loading, Cascade) 불가 |
| 쿼리 예측 가능 | JOIN 쿼리를 직접 작성해야 함 |
| 단순한 엔티티 | 관계 데이터 접근이 명시적으로 더 복잡 |

---

## 7. HTTP 어댑터: Fastify (Express 대신)

### 결정

NestJS의 기본 HTTP 어댑터인 `@nestjs/platform-express` 대신 `@nestjs/platform-fastify`를 사용합니다.

### 구현

```typescript
// main.ts (gateway & worker 공통)
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
);
await app.listen(port, '0.0.0.0');  // Fastify 기본값은 localhost — 외부 접근을 위해 명시
```

**패키지 변경:**
```
제거: @nestjs/platform-express
추가: @nestjs/platform-fastify, @fastify/static
```

### 이유

**성능:** Fastify는 Express보다 요청 처리 처리량이 높고 오버헤드가 낮습니다. 벤치마크 기준 약 2배 빠른 응답 속도를 보입니다.

**스키마 기반 직렬화:** Fastify는 JSON 스키마로 응답 직렬화를 최적화합니다.

**TypeScript 친화적:** Fastify의 타입 정의가 더 정교합니다.

### Socket.IO 호환성

Socket.IO(`@nestjs/platform-socket.io`)는 Fastify로 마이그레이션해도 **변경 없이 동작**합니다. Socket.IO는 HTTP 어댑터와 독립적으로 NestJS WebSocket 레이어에서 처리됩니다.

### E2E 테스트 주의사항

Fastify를 사용할 때 E2E 테스트에서 앱이 완전히 준비된 후 요청해야 합니다:

```typescript
// e2e 테스트
await app.init();
await app.getHttpAdapter().getInstance().ready();  // Fastify 전용 — Express에는 불필요
```

### 트레이드오프

| 장점 | 단점 |
|------|------|
| 더 높은 처리량 | `req.user` 등 Express 전용 패턴은 Fastify 방식으로 변경 필요 |
| 낮은 오버헤드 | 일부 Express 전용 미들웨어 호환 불가 |
| 스키마 기반 직렬화 | `app.listen(port, '0.0.0.0')` 호스트 명시 필요 |

---

## 결정 요약

| 결정 | 선택 | 핵심 이유 |
|------|------|-----------|
| 아키텍처 | Gateway/Worker 분리 | 독립 확장, 장애 격리 |
| HTTP 어댑터 | Fastify (Express 대신) | 성능, 낮은 오버헤드 |
| 전송 보장 | Kafka at-least-once + DB 멱등성 | 단순성과 안전성의 균형 |
| 캐시 전략 | Redis 캐시-어사이드 (30s TTL) | 멤버십 확인 DB 부하 감소 |
| 검증 라이브러리 | Zod | 타입-스키마 통합 |
| 메시지 PK | ULID | 시간순 정렬 + 커서 페이지네이션 |
| 사용자 PK | UUID | 단순성 (TypeORM 자동 생성) |
| ORM 관계 | 미사용 | N+1 방지, 예측 가능한 쿼리 |

[← 돌아가기: README](./README.md)
