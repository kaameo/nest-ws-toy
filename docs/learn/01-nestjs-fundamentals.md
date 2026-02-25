# Phase 1: NestJS 기초 — 모노레포, 부트스트랩, ConfigModule

## 학습 목표

- NestJS 모노레포 구조와 `nest-cli.json` 설정 방법을 이해한다
- TypeScript 경로 별칭(`@app/common` 등)이 어떻게 동작하는지 안다
- 하이브리드 앱(HTTP + 마이크로서비스) 부트스트랩 방법을 익힌다
- `ConfigModule`과 Zod를 활용한 환경변수 검증 패턴을 배운다

## 읽을 파일 목록

1. `nest-cli.json`
2. `tsconfig.json`
3. `apps/chat-gateway/src/main.ts`
4. `apps/chat-gateway/src/app.module.ts`
5. `libs/common/src/utils/env.validation.ts`

---

## 1. `nest-cli.json` — 모노레포 구성

### 핵심 코드

```json
{
  "monorepo": true,
  "root": "apps/chat-gateway",
  "projects": {
    "chat-gateway": {
      "type": "application",
      "root": "apps/chat-gateway",
      "entryFile": "main"
    },
    "chat-worker": {
      "type": "application",
      "root": "apps/chat-worker",
      "entryFile": "main"
    },
    "common": {
      "type": "library",
      "root": "libs/common",
      "entryFile": "index"
    }
  }
}
```

### NestJS 개념: 모노레포 프로젝트 타입

NestJS CLI는 두 가지 프로젝트 타입을 지원합니다.

| 타입 | 설명 | 빌드 명령 |
|------|------|-----------|
| `application` | 독립 실행 가능한 앱 (main.ts 포함) | `nest build chat-gateway` |
| `library` | 다른 앱들이 import하는 공유 라이브러리 | `nest build common` |

**학습 포인트:**
- `monorepo: true` 설정 시 `pnpm build:gateway`는 `chat-gateway` 앱과 그 의존 라이브러리(`common`, `db`, `redis`)를 함께 빌드합니다
- `entryFile: "index"`인 라이브러리는 `libs/common/src/index.ts`를 통해 공개 API를 관리합니다
- `sourceRoot`는 TypeScript 컴파일러가 소스를 찾는 기준 경로입니다

---

## 2. `tsconfig.json` — 경로 별칭

### 핵심 코드

```json
{
  "compilerOptions": {
    "paths": {
      "@app/common": ["libs/common/src"],
      "@app/common/*": ["libs/common/src/*"],
      "@app/db": ["libs/db/src"],
      "@app/db/*": ["libs/db/src/*"],
      "@app/redis": ["libs/redis/src"],
      "@app/redis/*": ["libs/redis/src/*"]
    }
  }
}
```

### NestJS 개념: 경로 별칭

`paths` 설정은 TypeScript 컴파일러에게 `@app/common`이라는 import를 `libs/common/src`로 해석하도록 지시합니다.

```typescript
// 이렇게 쓰면
import { ZodValidationPipe } from '@app/common';

// 실제로는 이것입니다
import { ZodValidationPipe } from '../../libs/common/src';
```

**학습 포인트:**
- 상대 경로 지옥(`../../../../libs/common/src/...`)을 피할 수 있습니다
- `@app/common`과 `@app/common/*` 두 가지를 모두 등록해야 합니다
  - `@app/common` → `libs/common/src/index.ts` (배럴 파일)
  - `@app/common/utils/env` → `libs/common/src/utils/env.ts` (직접 경로)

---

## 3. `apps/chat-gateway/src/main.ts` — 하이브리드 앱 부트스트랩

### 핵심 코드

```typescript
async function bootstrap() {
  // 1단계: HTTP 앱 생성 (Fastify 어댑터 사용)
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableCors({ origin: '*' });
  app.enableShutdownHooks();

  // 2단계: Kafka 마이크로서비스를 HTTP 앱에 연결
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: `${KAFKA_CLIENT_ID}-gateway`,
        brokers,
      },
      consumer: {
        groupId: KAFKA_CONSUMER_GROUPS.BROADCAST,
        allowAutoTopicCreation: true,
      },
    },
  });

  // 3단계: 마이크로서비스 먼저 시작, 그 다음 HTTP
  await app.startAllMicroservices();
  await app.listen(port, '0.0.0.0');  // Fastify는 호스트 명시 필요
}
```

### NestJS 개념: 하이브리드 앱 (with Fastify)

Gateway는 두 가지 역할을 동시에 합니다.

```
chat-gateway 프로세스
├── HTTP 서버 (포트 3000)     ← NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
│   ├── REST API (/auth, /rooms, /messages)
│   └── Socket.IO WebSocket
└── Kafka 컨슈머              ← connectMicroservice()
    └── chat.messages.persisted.v1 토픽 구독
```

**왜 하이브리드 앱인가?**
- Worker가 DB에 저장 후 Kafka에 발행한 `chat.messages.persisted.v1` 이벤트를
- Gateway가 구독해서 Socket.IO로 클라이언트들에게 브로드캐스트해야 하기 때문입니다

**Fastify 어댑터 임포트:**
```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
```

**학습 포인트:**
- `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())`로 Express 대신 Fastify를 HTTP 레이어로 사용합니다
- `app.listen(port, '0.0.0.0')`에서 호스트를 명시해야 합니다 — Fastify의 기본 바인딩은 `localhost`(루프백)이므로 Docker 컨테이너 등 외부에서 접근할 때 `'0.0.0.0'`이 필요합니다
- `NestFactory.createMicroservice()`는 마이크로서비스 전용 앱을 만들지만, `connectMicroservice()`는 기존 HTTP 앱에 마이크로서비스 기능을 추가합니다
- `startAllMicroservices()`를 `listen()` 전에 호출해야 Kafka 컨슈머가 HTTP 요청 처리 전에 준비됩니다
- `enableShutdownHooks()`는 SIGTERM 신호 수신 시 graceful shutdown을 활성화합니다

---

## 4. `apps/chat-gateway/src/app.module.ts` — 루트 모듈

### 핵심 코드

```typescript
@Module({
  imports: [
    // 환경변수 전역 설정 + Zod 검증
    ConfigModule.forRoot({
      isGlobal: true,
      validate,          // libs/common/src/utils/env.validation.ts의 함수
    }),
    // 정적 파일 서빙 (public/)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', 'public'),
    }),
    DbModule,
    RedisModule.forRoot(),
    HealthModule,
    AuthModule,
    RoomsModule,
    GatewayModule,
    MessagesModule,
  ],
})
export class AppModule {}
```

### NestJS 개념: 루트 모듈과 ConfigModule

**`ConfigModule.forRoot()` 핵심 옵션:**

| 옵션 | 설명 |
|------|------|
| `isGlobal: true` | 다른 모듈에서 `imports: [ConfigModule]` 없이 `ConfigService`를 주입받을 수 있음 |
| `validate` | 앱 시작 시 환경변수를 검증하는 함수. 실패 시 즉시 프로세스 종료 |

**학습 포인트:**
- `isGlobal: true` 없이는 `ConfigService`를 사용하는 모든 모듈이 `imports: [ConfigModule]`을 선언해야 합니다
- `validate` 함수는 raw `process.env` 객체를 받아 검증 후 타입이 보장된 객체를 반환합니다
- `DbModule`, `RedisModule.forRoot()`의 순서가 중요합니다 — `ConfigModule`이 먼저 초기화되어야 이들이 환경변수를 읽을 수 있습니다

---

## 5. `libs/common/src/utils/env.validation.ts` — Zod 환경변수 검증

### 핵심 코드

```typescript
export const envSchema = z.object({
  // Database
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),  // 문자열 → 숫자 강제 변환
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_DATABASE: z.string().min(1),

  // Redis
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // Kafka
  KAFKA_BROKERS: z.string().min(1).default('localhost:29092'),

  // JWT
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('1d'),

  // App
  PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvConfig = z.infer<typeof envSchema>;  // 타입 자동 생성

export function validate(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Environment validation failed:\n${JSON.stringify(formatted, null, 2)}`);
  }
  return result.data;
}
```

### NestJS 개념: Fail-Fast 환경변수 검증

`process.env`의 모든 값은 문자열이므로 타입 문제가 생기기 쉽습니다.

```
환경변수 문제 없이 → 앱 정상 시작
환경변수 누락/잘못됨 → 앱 시작 즉시 에러 출력 후 종료
```

**`z.coerce.number()`를 사용하는 이유:**
- `process.env.PORT`는 항상 문자열 `"3000"`입니다
- `z.number()`는 문자열을 거부하지만, `z.coerce.number()`는 `Number("3000") = 3000`으로 변환합니다

**학습 포인트:**
- `z.infer<typeof envSchema>`로 타입을 자동 생성하므로 스키마와 타입이 항상 동기화됩니다
- `safeParse` 대신 `parse`를 쓰면 예외가 던져지지만, 에러 메시지를 커스터마이즈하려면 `safeParse`가 유리합니다
- `ConfigService.get('PORT')`의 반환 타입은 `unknown`이지만, 이 검증을 통과한 값은 타입이 보장됩니다

---

## 핵심 정리

```
nest-cli.json        → 모노레포 구조 정의 (어떤 앱/라이브러리가 있는가)
tsconfig.json        → @app/* 별칭 (libs/를 짧게 import)
main.ts              → 앱 부트스트랩 (HTTP + Kafka 동시 시작)
app.module.ts        → 루트 모듈 (전역 설정 집합점)
env.validation.ts    → Zod 환경변수 검증 (fail-fast)
```

## 다음 단계

[Phase 2: 공유 라이브러리 →](./02-shared-libraries.md)

TypeORM 비동기 모듈 설정, 엔티티 설계, Redis DynamicModule, 커스텀 ValidationPipe를 학습합니다.
