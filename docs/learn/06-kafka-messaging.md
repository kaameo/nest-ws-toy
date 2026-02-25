# Phase 6: Kafka 메시징 — 마이크로서비스, 이벤트 드리븐

## 학습 목표

- Kafka 토픽/컨슈머 그룹 상수를 중앙화하는 패턴을 익힌다
- Zod로 이벤트 스키마를 정의하는 방법을 배운다
- `ClientsModule.registerAsync()`로 Kafka 프로듀서를 설정한다
- `OnModuleInit`으로 모듈 초기화 시 Kafka 연결을 수행한다
- Worker의 부트스트랩과 `@MessagePattern()`으로 Kafka 메시지를 처리한다
- TypeORM 트랜잭션과 `orIgnore()`로 멱등성을 구현한다
- Kafka → WebSocket 브리지(BroadcastController) 패턴을 이해한다

## 읽을 파일 목록

24. `libs/common/src/events/kafka.constants.ts`
25. `libs/common/src/events/message-created.event.ts`
26. `apps/chat-gateway/src/kafka/kafka-producer.module.ts`
27. `apps/chat-gateway/src/kafka/kafka-producer.service.ts`
28. `apps/chat-worker/src/main.ts`
29. `apps/chat-worker/src/persistor/persistor.controller.ts`
30. `apps/chat-worker/src/persistor/persistor.service.ts`
31. `apps/chat-worker/src/fanout/fanout.service.ts`
32. `apps/chat-gateway/src/gateway/broadcast.controller.ts`

---

## 24. `libs/common/src/events/kafka.constants.ts` — 상수 중앙화

### 핵심 코드

```typescript
export const KAFKA_TOPICS = {
  MESSAGES_V1: 'chat.messages.v1',
  MESSAGES_PERSISTED_V1: 'chat.messages.persisted.v1',
} as const;

export const KAFKA_CONSUMER_GROUPS = {
  PERSISTOR: 'chat-persistor',
  BROADCAST: 'chat-broadcast',
} as const;

export const KAFKA_CLIENT_ID = 'chat-service';
```

### NestJS 개념: 상수 공유 전략

`as const`는 TypeScript에서 리터럴 타입을 보존합니다:

```typescript
// as const 없음
const TOPICS = { MESSAGES_V1: 'chat.messages.v1' }
// TOPICS.MESSAGES_V1의 타입: string

// as const 있음
const TOPICS = { MESSAGES_V1: 'chat.messages.v1' } as const
// TOPICS.MESSAGES_V1의 타입: 'chat.messages.v1' (리터럴 타입)
```

**왜 `libs/common`에 두는가?**
- `KAFKA_TOPICS.MESSAGES_V1`을 Gateway(프로듀서)와 Worker(컨슈머)가 모두 사용합니다
- 토픽명이 변경될 때 한 곳만 수정하면 됩니다

**컨슈머 그룹 설계:**
```
chat.messages.v1 토픽
  ├── 컨슈머 그룹: chat-persistor (Worker)  ← DB 저장
  └── (Gateway는 이 토픽을 구독하지 않음)

chat.messages.persisted.v1 토픽
  └── 컨슈머 그룹: chat-broadcast (Gateway) ← WebSocket 브로드캐스트
```

---

## 25. `libs/common/src/events/message-created.event.ts` — 이벤트 스키마

### 핵심 코드

```typescript
export const MessageCreatedEventSchema = z.object({
  eventId: z.uuid(),           // 이벤트 자체의 고유 ID (재처리 감지용)
  roomId: z.uuid(),
  senderId: z.uuid(),
  clientMsgId: z.uuid(),       // 클라이언트 생성 ID (멱등성 키)
  messageType: z.enum(['TEXT', 'IMAGE', 'SYSTEM']).default('TEXT'),
  content: z.string().min(1),
  producedAt: z.string(),      // ISO 8601 timestamp
});

export type MessageCreatedEvent = z.infer<typeof MessageCreatedEventSchema>;
```

### NestJS 개념: 이벤트 스키마 설계

Kafka 메시지는 직렬화/역직렬화 과정에서 타입 정보가 손실됩니다. 컨슈머에서 Zod로 검증하면 런타임 안전성을 확보합니다.

**`eventId` vs `clientMsgId`:**
| 필드 | 생성자 | 용도 |
|------|--------|------|
| `eventId` | Gateway (서버 측) | Kafka 이벤트 고유 식별 |
| `clientMsgId` | 클라이언트 | DB 멱등성 키 (동일 메시지 중복 방지) |

---

## 26. `apps/chat-gateway/src/kafka/kafka-producer.module.ts` — ClientsModule

### 핵심 코드

```typescript
@Module({
  imports: [
    ClientsModule.registerAsync([      // 여러 클라이언트를 배열로 등록
      {
        name: KAFKA_PRODUCER,          // 인젝션 토큰 (문자열 상수)
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: KAFKA_CLIENT_ID,
              brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
            },
            producer: {
              allowAutoTopicCreation: true,
              idempotent: true,          // 정확히 1회 전송 보장 (acks=-1 자동 설정)
            },
            producerOnlyMode: true,      // 컨슈머 연결 없이 프로듀서만 사용
          },
        }),
      },
    ]),
  ],
  providers: [KafkaProducerService],
  exports: [KafkaProducerService],
})
export class KafkaProducerModule {}
```

### NestJS 개념: `ClientsModule`

`ClientsModule`은 NestJS 마이크로서비스 클라이언트(프로듀서)를 DI로 사용할 수 있게 해주는 모듈입니다.

```
ClientsModule.registerAsync([{ name: TOKEN, ... }])
  ↓
ClientKafka 인스턴스 생성
  ↓
@Inject(TOKEN) private readonly kafkaClient: ClientKafka
```

**`idempotent: true`의 의미:**
- Kafka 프로듀서의 멱등성 옵션입니다
- 네트워크 오류로 재전송할 때 동일한 메시지가 중복 저장되지 않습니다
- 내부적으로 `acks=-1`(all)와 재시도를 자동 설정합니다
- DB 레벨의 `ON CONFLICT DO NOTHING`과 함께 이중 멱등성을 보장합니다

---

## 27. `apps/chat-gateway/src/kafka/kafka-producer.service.ts` — OnModuleInit

### 핵심 코드

```typescript
@Injectable()
export class KafkaProducerService implements OnModuleInit {
  constructor(
    @Inject(KAFKA_PRODUCER)
    private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaClient.connect();   // 모듈 초기화 시 Kafka 연결
    this.logger.log('Kafka producer connected');
  }

  async publish(topic: string, key: string, value: Record<string, unknown>): Promise<void> {
    await lastValueFrom(
      this.kafkaClient.emit(topic, {
        key,
        value: JSON.stringify(value),
      }),
    );
  }
}
```

### NestJS 개념: 생명주기 훅

NestJS 모듈/서비스는 생명주기 인터페이스를 구현할 수 있습니다:

```
앱 시작
  ↓
모듈 인스턴스화
  ↓
OnModuleInit.onModuleInit()    ← Kafka 연결
  ↓
앱 실행 중
  ↓
OnModuleDestroy.onModuleDestroy()  ← Kafka 연결 해제
```

| 훅 | 실행 시점 |
|----|-----------|
| `OnModuleInit` | 모듈이 완전히 초기화된 후 |
| `OnApplicationBootstrap` | 앱 부트스트랩 완료 후 |
| `OnModuleDestroy` | 모듈 파괴 전 (graceful shutdown) |

**`lastValueFrom(Observable)`:**
`ClientKafka.emit()`은 RxJS `Observable`을 반환합니다. `lastValueFrom()`은 Observable이 완료될 때까지 기다려 Promise로 변환합니다.

```typescript
// Observable → Promise 변환
await lastValueFrom(this.kafkaClient.emit(topic, message));
```

**메시지 키(`key: dto.roomId`)의 역할:**
- 같은 키를 가진 메시지는 항상 같은 Kafka 파티션으로 갑니다
- 같은 방의 메시지가 순서 보장되며 처리됩니다

---

## 28. `apps/chat-worker/src/main.ts` — Worker 부트스트랩

### 핵심 코드

```typescript
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableShutdownHooks();

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: `${KAFKA_CLIENT_ID}-worker`,    // gateway와 다른 clientId
        brokers,
      },
      consumer: {
        groupId: KAFKA_CONSUMER_GROUPS.PERSISTOR,  // 'chat-persistor'
        allowAutoTopicCreation: true,
      },
    },
  });

  await app.startAllMicroservices();
  const port = configService.get<number>('WORKER_PORT', 3001);
  await app.listen(port, '0.0.0.0');  // Fastify는 호스트 명시 필요
}
```

**Gateway와 Worker의 부트스트랩 비교:**

| | Gateway | Worker |
|--|---------|--------|
| clientId | `chat-service-gateway` | `chat-service-worker` |
| 컨슈머 그룹 | `chat-broadcast` | `chat-persistor` |
| 구독 토픽 | `chat.messages.persisted.v1` | `chat.messages.v1` |
| HTTP 서버 | 포트 3000 | 포트 3001 |

---

## 29. `apps/chat-worker/src/persistor/persistor.controller.ts` — @MessagePattern

### 핵심 코드

```typescript
@Controller()
export class PersistorController {
  @MessagePattern(KAFKA_TOPICS.MESSAGES_V1)    // 'chat.messages.v1' 토픽 구독
  async handleMessage(
    @Payload() data: MessageCreatedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    // 컨슈머 측에서도 Zod로 재검증
    const parsed = MessageCreatedEventSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.error(`Invalid message event: ${JSON.stringify(parsed.error.issues)}`);
      return;  // 오프셋 커밋 (무효 메시지는 재처리하지 않음)
    }

    try {
      await this.persistorService.persistMessage(parsed.data);
    } catch (error) {
      this.logger.error(`Failed to persist message: ${error}`);
      throw error;  // 예외 재던지기 → 오프셋 미커밋 → 재처리
    }
  }
}
```

### NestJS 개념: `@MessagePattern()`

HTTP의 `@Get()`, `@Post()`처럼 마이크로서비스에서는 `@MessagePattern()`이 메시지를 처리하는 핸들러를 등록합니다.

```
Kafka → NestJS 마이크로서비스 컨슈머
  ↓
@MessagePattern('chat.messages.v1')
  ↓
handleMessage(@Payload() data, @Ctx() context)
```

**오류 처리 전략:**
```
검증 실패 (무효한 메시지)
  → return (오프셋 커밋)
  → 이 메시지는 건너뜀
  → 다음 메시지 처리

DB 저장 실패 (일시적 오류)
  → throw error (오프셋 미커밋)
  → Kafka가 같은 메시지를 재전달
  → 재처리 시도
```

**`@Ctx() context: KafkaContext`:**
- Kafka 메타데이터 접근: 파티션, 오프셋, 토픽 등
- 수동 오프셋 커밋이 필요할 때 사용 (이 프로젝트에서는 자동 커밋)

---

## 30. `apps/chat-worker/src/persistor/persistor.service.ts` — 트랜잭션 + 멱등성

### 핵심 코드

```typescript
async persistMessage(event: MessageCreatedEvent): Promise<{ persisted: boolean; messageId: string }> {
  const messageId = generateUlid();   // 새 ULID 생성

  const result = await this.dataSource.transaction(async (manager) => {
    // 1단계: INSERT OR IGNORE (멱등성)
    const insertResult = await manager
      .createQueryBuilder()
      .insert()
      .into(Message)
      .values({
        id: messageId,
        roomId: event.roomId,
        senderId: event.senderId,
        clientMsgId: event.clientMsgId,   // UNIQUE 제약의 멱등성 키
        type: event.messageType,
        content: event.content,
      })
      .orIgnore()    // ON CONFLICT DO NOTHING
      .execute();

    // 2단계: 중복이면 조기 반환
    if (insertResult.raw.length === 0 || insertResult.identifiers.length === 0) {
      return { persisted: false, messageId };
    }

    // 3단계: Room의 lastMessage 업데이트
    await manager
      .createQueryBuilder()
      .update(Room)
      .set({ lastMessageId: messageId, lastMessageAt: new Date() })
      .where('id = :roomId', { roomId: event.roomId })
      .execute();

    return { persisted: true, messageId };
  });

  // 4단계: 저장 성공 시에만 fanout 발행
  if (result.persisted) {
    const persistedEvent: MessagePersistedEvent = { ... };
    await this.fanoutService.publishPersisted(persistedEvent);
  }

  return result;
}
```

### NestJS 개념: 트랜잭션과 멱등성

**`dataSource.transaction()`:**
```typescript
await this.dataSource.transaction(async (manager) => {
  // manager를 통한 모든 DB 작업이 하나의 트랜잭션으로 묶임
  // 예외 발생 시 자동 ROLLBACK
  // 정상 완료 시 자동 COMMIT
});
```

**`.orIgnore()` — 멱등성의 핵심:**
```sql
INSERT INTO messages (id, room_id, sender_id, client_msg_id, ...)
VALUES (...)
ON CONFLICT DO NOTHING   -- ← .orIgnore()
```

Kafka의 at-least-once 보장과 네트워크 재시도로 인해 같은 메시지가 여러 번 올 수 있습니다. `(roomId, senderId, clientMsgId)` UNIQUE 제약 + `ON CONFLICT DO NOTHING`으로 처리합니다:

```
첫 번째 수신: INSERT 성공 → persisted: true → fanout 발행
두 번째 수신 (중복): INSERT 무시 → persisted: false → fanout 생략
```

> **주의: DB 멱등성은 end-to-end exactly-once가 아닙니다**
>
> 현재 구현은 DB 레벨에서 중복 저장을 방지하지만, 전체 파이프라인에는 3가지 갭이 존재합니다:
>
> 1. **autoCommit 미비활성화**: consumer `autoCommit: true` (기본값)으로 인해 DB INSERT 전에 offset이 커밋될 수 있습니다. 크래시 시 메시지 유실 가능.
> 2. **DB write ↔ fanout 비원자적**: DB 커밋 후 fanout 발행 전 크래시 시, 재처리에서 `.orIgnore()`로 `persisted: false`가 반환되어 브로드캐스트가 영구적으로 생략될 수 있습니다.
> 3. **브로드캐스트 중복 방지 없음**: consumer 리밸런싱 시 동일 메시지가 중복 브로드캐스트될 수 있으며 클라이언트 dedup이 없습니다.
>
> 전체 분석 및 개선 방향은 [08-architecture-decisions.md — 섹션 2](./08-architecture-decisions.md) 를 참고하세요.

**트랜잭션이 필요한 이유:**
- Message INSERT와 Room lastMessage UPDATE가 원자적으로 실행되어야 합니다
- Message는 저장됐는데 Room 업데이트가 실패하면 데이터 불일치가 발생합니다

---

## 31. `apps/chat-worker/src/fanout/fanout.service.ts` — 두 번째 Kafka 프로듀서

### 핵심 코드

```typescript
export const WORKER_KAFKA_PRODUCER = 'WORKER_KAFKA_PRODUCER';

@Injectable()
export class FanoutService implements OnModuleInit {
  constructor(
    @Inject(WORKER_KAFKA_PRODUCER)
    private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaClient.connect();
  }

  async publishPersisted(event: MessagePersistedEvent): Promise<void> {
    await lastValueFrom(
      this.kafkaClient.emit(KAFKA_TOPICS.MESSAGES_PERSISTED_V1, {
        key: event.roomId,
        value: JSON.stringify(event),
      }),
    );
  }
}
```

**왜 Worker에도 Kafka 프로듀서가 있는가?**

Worker는 컨슈머이면서 동시에 프로듀서입니다:

```
chat.messages.v1  →  [Worker PersistorService]  →  DB 저장
                                ↓
                      [Worker FanoutService]  →  chat.messages.persisted.v1
                                                          ↓
                                              [Gateway BroadcastController]
                                                          ↓
                                              Socket.IO 브로드캐스트
```

---

## 32. `apps/chat-gateway/src/gateway/broadcast.controller.ts` — Kafka→WS 브리지

### 핵심 코드

```typescript
@Controller()
export class BroadcastController {
  constructor(private readonly chatGateway: ChatGateway) {}

  @MessagePattern(KAFKA_TOPICS.MESSAGES_PERSISTED_V1)
  async handlePersistedMessage(@Payload() data: MessagePersistedEvent): Promise<void> {
    const parsed = MessagePersistedEventSchema.safeParse(data);
    if (!parsed.success) {
      return;
    }

    const event = parsed.data;

    // Socket.IO Room에 참가한 모든 클라이언트에게 브로드캐스트
    this.chatGateway.server.to(event.roomId).emit('newMessage', {
      id: event.messageId,
      roomId: event.roomId,
      senderId: event.senderId,
      clientMsgId: event.clientMsgId,
      type: event.messageType,
      content: event.content,
      createdAt: event.createdAt,
    });
  }
}
```

### NestJS 개념: 마이크로서비스 컨트롤러 + WebSocket 서버 조합

`BroadcastController`는 HTTP 컨트롤러가 아닌 **마이크로서비스 컨트롤러**입니다:

```typescript
// HTTP 컨트롤러
@Controller('rooms')
class RoomsController {
  @Get()               // HTTP GET 처리
}

// 마이크로서비스 컨트롤러 (라우트 없음)
@Controller()
class BroadcastController {
  @MessagePattern(TOPIC)   // Kafka 메시지 처리
}
```

**`ChatGateway` 의존성 주입:**
- `BroadcastController`가 `ChatGateway`를 주입받아 `server.to(roomId).emit()`을 호출합니다
- 이것이 가능한 이유: 둘 다 같은 NestJS 모듈(`GatewayModule`) 안에 있기 때문입니다

**`server.to(roomId).emit('newMessage', data)`:**
- `to(roomId)`: `joinRoom` 이벤트로 해당 Socket.IO Room에 참가한 소켓들에게만 전송
- `emit('newMessage', data)`: 'newMessage' 이벤트를 발행

---

## 전체 메시지 플로우 요약

```
클라이언트 A (발신자)
  sendMessage → Gateway WebSocket
    ↓
ChatGateway.handleSendMessage()
  KafkaProducerService.publish(chat.messages.v1, roomId, event)
    ↓
[Kafka: chat.messages.v1]
    ↓
Worker PersistorController.handleMessage()
  PersistorService.persistMessage()
    ↓ DB INSERT (orIgnore)
    ↓ Room lastMessage UPDATE
    ↓ FanoutService.publishPersisted()
      ↓
[Kafka: chat.messages.persisted.v1]
      ↓
Gateway BroadcastController.handlePersistedMessage()
  chatGateway.server.to(roomId).emit('newMessage', ...)
    ↓
클라이언트 A, B, C ... (방 참가자 모두)
  'newMessage' 이벤트 수신
```

## 다음 단계

[Phase 7: 운영 →](./07-operational.md)

Terminus 헬스체크, 커스텀 HealthIndicator, Docker Compose 인프라를 학습합니다.
