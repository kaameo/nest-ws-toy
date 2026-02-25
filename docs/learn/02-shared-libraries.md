# Phase 2: 공유 라이브러리 — TypeORM, Redis, Validation

## 학습 목표

- `TypeOrmModule.forRootAsync()`로 비동기 DB 설정을 하는 방법을 익힌다
- TypeORM 엔티티 설계 패턴(UUID PK, ULID PK, 복합 PK, Unique 제약)을 배운다
- NestJS `DynamicModule`과 `@Global()` 데코레이터의 동작 원리를 이해한다
- 커스텀 `PipeTransform`으로 Zod 스키마를 활용한 검증 파이프를 구현하는 방법을 안다

## 읽을 파일 목록

6. `libs/db/src/db.module.ts`
7. `libs/db/src/entities/user.entity.ts`
8. `libs/db/src/entities/message.entity.ts`
9. `libs/db/src/entities/room-member.entity.ts`
10. `libs/redis/src/redis.module.ts`
11. `libs/common/src/utils/zod-validation.pipe.ts`

---

## 6. `libs/db/src/db.module.ts` — TypeORM 비동기 설정

### 핵심 코드

```typescript
const entities = [User, Room, RoomMember, Message];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow('DB_USERNAME'),
        password: config.getOrThrow('DB_PASSWORD'),
        database: config.getOrThrow('DB_DATABASE'),
        entities,
        synchronize: process.env.NODE_ENV !== 'production',
      }),
    }),
    TypeOrmModule.forFeature(entities),  // Repository 주입 허용
  ],
  exports: [TypeOrmModule],              // 다른 모듈에서 @InjectRepository 사용 가능
})
export class DbModule {}
```

### NestJS 개념: `forRoot` vs `forRootAsync`

| 메서드 | 사용 시점 |
|--------|-----------|
| `forRoot(options)` | 설정값이 정적일 때 (하드코딩) |
| `forRootAsync({ useFactory })` | 설정값이 런타임에 결정될 때 (환경변수 등) |

**`useFactory` 패턴:**
```typescript
TypeOrmModule.forRootAsync({
  imports: [ConfigModule],   // useFactory에서 사용할 모듈
  inject: [ConfigService],   // useFactory의 매개변수로 주입될 프로바이더
  useFactory: (config: ConfigService) => ({
    // config를 사용해 동적으로 옵션 생성
  }),
})
```

**학습 포인트:**
- `forRootAsync`는 앱 모듈의 DI 컨테이너가 준비된 후에 팩토리를 호출합니다
- `synchronize: process.env.NODE_ENV !== 'production'` — 개발 환경에서는 엔티티 변경 시 자동으로 테이블을 수정하지만, 프로덕션에서는 데이터 손실 위험 때문에 반드시 끕니다
- `TypeOrmModule.forFeature(entities)`는 해당 모듈에서 `@InjectRepository(Entity)` 사용을 허용합니다
- `exports: [TypeOrmModule]`으로 DbModule을 import한 다른 모듈들도 Repository를 주입받을 수 있습니다

---

## 7. `libs/db/src/entities/user.entity.ts` — 기본 엔티티

### 핵심 코드

```typescript
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;                          // UUID 자동 생성

  @Column({ unique: true })
  email: string;                       // 유니크 제약

  @Column({ name: 'password_hash' })
  passwordHash: string;                // DB 컬럼명은 password_hash, 코드명은 passwordHash

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;                     // INSERT 시 자동 설정
}
```

### NestJS 개념: TypeORM 기본 데코레이터

| 데코레이터 | 역할 |
|-----------|------|
| `@Entity('users')` | 클래스를 DB 테이블과 매핑. 인수는 테이블명 |
| `@PrimaryGeneratedColumn('uuid')` | UUID v4를 DB에서 자동 생성 |
| `@Column({ name: 'password_hash' })` | 카멜케이스 속성을 스네이크케이스 컬럼에 매핑 |
| `@CreateDateColumn` | INSERT 시 현재 시각 자동 입력 |

**학습 포인트:**
- `name` 옵션으로 TypeScript 관례(camelCase)와 DB 관례(snake_case)를 분리합니다
- `@Column({ unique: true })`는 DB 레벨의 유니크 인덱스를 생성합니다
- TypeORM에는 `@UpdateDateColumn`, `@DeleteDateColumn`(소프트 삭제)도 있습니다

---

## 8. `libs/db/src/entities/message.entity.ts` — ULID PK + 복합 Unique

### 핵심 코드

```typescript
@Entity('messages')
@Unique('UQ_messages_dedup', ['roomId', 'senderId', 'clientMsgId'])  // 중복 방지
@Index('IDX_messages_room_id', ['roomId', 'id'])                      // 커서 페이지네이션용
export class Message {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string; // ULID — UUID가 아닌 직접 생성한 문자열 PK

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @Column({ name: 'client_msg_id', type: 'uuid' })
  clientMsgId: string;    // 클라이언트가 생성한 메시지 고유 ID (멱등성 키)

  @Column({ type: 'varchar', length: 20, default: 'TEXT' })
  type: string; // TEXT | IMAGE | SYSTEM

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### NestJS 개념: `@PrimaryColumn` vs `@PrimaryGeneratedColumn`

| 데코레이터 | DB 동작 |
|-----------|---------|
| `@PrimaryGeneratedColumn('uuid')` | DB가 UUID를 자동 생성 |
| `@PrimaryGeneratedColumn('increment')` | DB가 AUTO_INCREMENT로 생성 |
| `@PrimaryColumn()` | 애플리케이션이 PK 값을 직접 제공 |

**왜 ULID를 PK로 사용하는가?**

ULID(Universally Unique Lexicographically Sortable Identifier)는 26자리 문자열입니다.

```
01ARZ3NDEKTSV4RRFFQ69G5FAV
└──────────┘└─────────────┘
  타임스탬프     랜덤
  (48 bits)    (80 bits)
```

- **시간순 정렬 가능**: UUID와 달리 사전순 정렬이 시간순과 일치합니다
- **커서 페이지네이션**: `WHERE id < :cursor ORDER BY id DESC`가 정확히 동작합니다
- **글로벌 유니크**: UUID처럼 충돌 가능성이 극히 낮습니다

**`@Unique`와 멱등성:**
```
(roomId, senderId, clientMsgId) UNIQUE
```
클라이언트가 같은 `clientMsgId`로 재전송해도 DB에는 한 번만 저장됩니다(멱등성). 이를 `ON CONFLICT DO NOTHING`과 함께 사용합니다.

---

## 9. `libs/db/src/entities/room-member.entity.ts` — 복합 PK

### 핵심 코드

```typescript
@Entity('room_members')
export class RoomMember {
  @PrimaryColumn({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;

  @Column({ name: 'last_read_message_id', type: 'varchar', length: 26, nullable: true })
  lastReadMessageId: string | null;
}
```

### NestJS 개념: 복합 PK (Composite Primary Key)

`@PrimaryColumn`을 여러 개 선언하면 복합 PK가 됩니다.

```sql
PRIMARY KEY (room_id, user_id)
```

**언제 복합 PK를 쓰는가?**
- 다대다 관계의 중간 테이블 (user_id + room_id의 조합이 유니크)
- 별도의 `id` 컬럼이 불필요하고 두 FK의 조합이 자연스러운 식별자가 될 때

**학습 포인트:**
- `nullable: true`가 없으면 기본값은 `NOT NULL`입니다
- TypeScript에서 `string | null`로 nullable을 표현하면 TypeORM이 자동으로 `nullable: true`로 인식합니다 (단, 명시적으로 쓰는 것이 더 명확합니다)
- `@ManyToOne`, `@JoinColumn` 등 관계 데코레이터를 의도적으로 사용하지 않았습니다 — [아키텍처 결정 참조](./08-architecture-decisions.md)

---

## 10. `libs/redis/src/redis.module.ts` — DynamicModule과 @Global

### 핵심 코드

```typescript
export const REDIS_CLIENT = 'REDIS_CLIENT';  // 커스텀 인젝션 토큰

@Global()          // 전역 등록 — 다른 모듈의 imports에 추가 불필요
@Module({})
export class RedisModule {
  static forRoot(): DynamicModule {
    return {
      module: RedisModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: REDIS_CLIENT,          // 문자열 토큰으로 제공
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            return new Redis({
              host: config.getOrThrow('REDIS_HOST'),
              port: config.getOrThrow<number>('REDIS_PORT'),
              lazyConnect: true,          // 실제 명령 전까지 연결 지연
            });
          },
        },
      ],
      exports: [REDIS_CLIENT],
    };
  }
}
```

### NestJS 개념: DynamicModule

**정적 모듈 vs 동적 모듈:**

```typescript
// 정적 모듈 — 설정 없음
@Module({ imports: [AuthModule] })

// 동적 모듈 — 설정을 인수로 받음
@Module({ imports: [RedisModule.forRoot()] })
@Module({ imports: [TypeOrmModule.forFeature([User])] })
```

동적 모듈은 `static` 메서드가 `DynamicModule` 타입 객체를 반환합니다:

```typescript
interface DynamicModule extends ModuleMetadata {
  module: Type<any>;   // 이 모듈 자체
  global?: boolean;    // 전역 등록 여부
}
```

**`@Global()` 데코레이터:**
- 이 데코레이터가 있으면 `AppModule`에서 한 번만 import해도 모든 모듈에서 주입받을 수 있습니다
- `ConfigModule.forRoot({ isGlobal: true })`와 동일한 효과이지만, `@Global()`은 클래스 레벨에서 선언합니다

**커스텀 인젝션 토큰:**
```typescript
// 제공
provide: REDIS_CLIENT  // 'REDIS_CLIENT' 문자열

// 주입
@Inject(REDIS_CLIENT)
private readonly redis: Redis
```
클래스가 아닌 서드파티 라이브러리 인스턴스를 주입할 때는 문자열 또는 Symbol 토큰을 사용합니다.

---

## 11. `libs/common/src/utils/zod-validation.pipe.ts` — 커스텀 ValidationPipe

### 핵심 코드

```typescript
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const errors = (result.error.issues as ZodIssue[]).map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    return result.data;  // 검증 + 변환된 값 반환
  }
}
```

### NestJS 개념: PipeTransform

Pipe는 컨트롤러 핸들러가 실행되기 전에 입력값을 **변환**하거나 **검증**합니다.

```
요청 → Middleware → Guard → Interceptor → Pipe → Controller
```

**`PipeTransform` 인터페이스:**
```typescript
interface PipeTransform<T = any, R = any> {
  transform(value: T, metadata: ArgumentMetadata): R;
}
```

**사용 방법 (Phase 3, 4에서 실제 사용):**
```typescript
// 메서드 레벨
@Post('register')
@UsePipes(new ZodValidationPipe(RegisterSchema))
async register(@Body() dto: RegisterDto) { ... }

// 파라미터 레벨
@Get('messages')
async getMessages(
  @Query(new ZodValidationPipe(MessageQuerySchema)) query: MessageQueryDto,
) { ... }
```

**왜 `class-validator` 대신 Zod를 사용하는가?**
- [아키텍처 결정 참조](./08-architecture-decisions.md)

**학습 포인트:**
- `safeParse`는 예외를 던지지 않고 `{ success, data, error }` 객체를 반환합니다
- `result.data`를 반환하므로 Zod의 `default()`, `transform()`, `coerce` 등의 변환이 적용된 값이 컨트롤러에 전달됩니다
- `BadRequestException`은 NestJS가 HTTP 400 응답으로 변환합니다

---

## 핵심 정리

```
db.module.ts          → forRootAsync 패턴, synchronize 조건부 설정
user.entity.ts        → UUID PK, snake_case 컬럼명 매핑
message.entity.ts     → ULID PK (직접 생성), @Unique (멱등성), @Index
room-member.entity.ts → 복합 PK (@PrimaryColumn 두 개)
redis.module.ts       → DynamicModule, @Global, 문자열 인젝션 토큰
zod-validation.pipe   → PipeTransform, safeParse, BadRequestException
```

## 다음 단계

[Phase 3: 인증 →](./03-authentication.md)

JWT 토큰 발급, Passport Strategy, AuthGuard를 학습합니다.
