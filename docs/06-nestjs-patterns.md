# NestJS 패턴 학습 가이드

이 프로젝트에서 사용된 NestJS 핵심 패턴을 정리한다.

## 1. 모듈 시스템

### 글로벌 모듈

```typescript
// libs/redis/src/redis.module.ts
@Global()  // 한 번 등록하면 모든 모듈에서 주입 가능
@Module({})
export class RedisModule {
  static forRoot(): DynamicModule { ... }
}

// ConfigModule도 글로벌로 등록
ConfigModule.forRoot({ isGlobal: true })
```

### 다이나믹 모듈 (forRoot / forRootAsync)

```typescript
// libs/db/src/db.module.ts
TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    type: 'postgres',
    host: config.getOrThrow('DB_HOST'),
    // ...
  }),
});
```

`forRoot`는 정적 설정, `forRootAsync`는 비동기로 설정값을 주입받을 때 사용.

### Feature 모듈

```typescript
// 특정 엔티티를 사용하는 모듈에서만 등록
TypeOrmModule.forFeature([Message, RoomMember])
```

## 2. 의존성 주입 (DI)

### 커스텀 프로바이더 토큰

```typescript
// 상수 토큰 정의
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const KAFKA_PRODUCER = 'KAFKA_PRODUCER';

// 프로바이더 등록
{
  provide: REDIS_CLIENT,
  useFactory: (config: ConfigService) => new Redis({ ... }),
  inject: [ConfigService],
}

// 주입
constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}
```

### 리포지토리 주입

```typescript
constructor(
  @InjectRepository(User)
  private readonly userRepository: Repository<User>,
) {}
```

### 라이프사이클 훅

```typescript
@Injectable()
export class KafkaProducerService implements OnModuleInit {
  async onModuleInit() {
    await this.kafkaClient.connect();  // 앱 시작 시 연결
  }
}
```

## 3. 가드 (Guards)

### HTTP JWT 가드 (Passport)

```typescript
// jwt.strategy.ts — Passport 전략 정의
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  validate(payload: any) {
    return { userId: payload.sub, email: payload.email };
  }
}

// 컨트롤러에서 사용
@UseGuards(AuthGuard('jwt'))
@Controller('rooms')
export class RoomsController { ... }
```

`AuthGuard('jwt')`는 Passport의 JWT 전략을 자동으로 실행. `validate()` 반환값이 `request.user`에 설정됨.

### WebSocket 인증

이 프로젝트에서는 가드 대신 `handleConnection`에서 직접 인증:

```typescript
// 연결 시점에 한 번만 검증
handleConnection(client: AuthenticatedSocket) {
  const payload = this.jwtService.verify(token, { secret });
  client.user = { userId: payload.sub, email: payload.email };
}
```

## 4. 파이프 (Pipes)

### 커스텀 Zod 검증 파이프

```typescript
// libs/common/src/utils/zod-validation.pipe.ts
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.errors);
    }
    return result.data;
  }
}

// 사용
@Post('register')
@UsePipes(new ZodValidationPipe(RegisterSchema))
async register(@Body() dto: RegisterDto) { ... }
```

### 내장 ParseUUIDPipe

```typescript
@Param('roomId', ParseUUIDPipe) roomId: string
```

## 5. 마이크로서비스 (Kafka Transport)

### 하이브리드 앱 (HTTP + Kafka)

```typescript
// main.ts — 하나의 프로세스에서 HTTP + Kafka 동시 서빙
const app = await NestFactory.create(AppModule);

app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.KAFKA,
  options: {
    client: { clientId: '...', brokers: ['localhost:29092'] },
    consumer: { groupId: 'chat-broadcast' },
  },
});

await app.startAllMicroservices();  // Kafka consumer 시작
await app.listen(3000);             // HTTP 서버 시작
```

### Kafka 메시지 핸들러

```typescript
// @MessagePattern으로 토픽 구독
@MessagePattern(KAFKA_TOPICS.MESSAGES_PERSISTED_V1)
handlePersistedMessage(@Payload() message, @Ctx() context: KafkaContext) {
  // message = Kafka 메시지 값
  // context = 파티션, 오프셋 등 메타정보
}
```

### Kafka 프로듀서

```typescript
// ClientsModule로 Kafka 클라이언트 등록
ClientsModule.registerAsync([{
  name: KAFKA_PRODUCER,
  useFactory: (config) => ({
    transport: Transport.KAFKA,
    options: {
      client: { clientId: '...', brokers: [...] },
      producer: { idempotent: true },
      producerOnlyMode: true,  // consumer 없이 producer만
    },
  }),
}]);

// 서비스에서 사용
@Inject(KAFKA_PRODUCER) private readonly kafkaClient: ClientKafka;

async publish(topic, key, value) {
  await lastValueFrom(this.kafkaClient.emit(topic, { key, value: JSON.stringify(value) }));
}
```

## 6. WebSocket 게이트웨이

```typescript
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;  // Socket.IO 서버 인스턴스

  handleConnection(client: Socket) { ... }    // 연결 시
  handleDisconnect(client: Socket) { ... }    // 해제 시

  @SubscribeMessage('sendMessage')
  handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    // 처리 후 return하면 자동으로 ACK 콜백에 전달됨
    return { status: 'ACCEPTED' };
  }
}
```

## 7. 헬스체크 (Terminus)

```typescript
// 커스텀 HealthIndicator 구현
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  async isHealthy(key: string) {
    const result = await this.redis.ping();
    if (result === 'PONG') return this.getStatus(key, true);
    throw new HealthCheckError('Redis failed', this.getStatus(key, false));
  }
}

// 컨트롤러
@Get('health')
check() {
  return this.health.check([
    () => this.db.pingCheck('database'),
    () => this.redis.isHealthy('redis'),
  ]);
}
```

## 8. 환경변수 검증 (Zod)

```typescript
// libs/common/src/utils/env.validation.ts
const envSchema = z.object({
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().int(),
  KAFKA_BROKERS: z.string(),
  JWT_SECRET: z.string().min(8),
  // ...
});

export function validate(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

// ConfigModule에서 사용
ConfigModule.forRoot({ validate })
// → 앱 시작 시 환경변수 누락이면 즉시 실패 (fail-fast)
```
