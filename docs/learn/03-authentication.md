# Phase 3: 인증 — JWT, Passport, Guards

## 학습 목표

- Zod 스키마로 DTO를 정의하고 타입을 추론하는 패턴을 익힌다
- `JwtModule.registerAsync()`로 설정 기반 JWT 모듈을 구성한다
- `PassportStrategy`를 상속해 커스텀 인증 전략을 구현한다
- `bcrypt`로 안전한 비밀번호 해싱과 검증을 구현한다
- `ZodValidationPipe`를 컨트롤러에서 실제로 적용하는 방법을 본다

## 읽을 파일 목록

12. `libs/common/src/dto/auth.dto.ts`
13. `apps/chat-gateway/src/auth/auth.module.ts`
14. `apps/chat-gateway/src/auth/jwt.strategy.ts`
15. `apps/chat-gateway/src/auth/auth.service.ts`
16. `apps/chat-gateway/src/auth/auth.controller.ts`

---

## 12. `libs/common/src/dto/auth.dto.ts` — Zod 스키마 + 타입 추론

### 핵심 코드

```typescript
export const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(6).max(100),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
// 결과: { email: string; password: string }

export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof LoginSchema>;
```

### NestJS 개념: Zod 스키마 기반 DTO

**전통적인 class-validator 방식:**
```typescript
export class RegisterDto {
  @IsEmail()
  email: string;

  @MinLength(6)
  @MaxLength(100)
  password: string;
}
```

**이 프로젝트의 Zod 방식:**
```typescript
export const RegisterSchema = z.object({ ... });
export type RegisterDto = z.infer<typeof RegisterSchema>;
```

**차이점:**
- 클래스가 아닌 일반 타입(`type`)이므로 런타임 오버헤드가 없습니다
- 스키마와 타입이 한 곳에서 관리되므로 불일치가 발생하지 않습니다
- `z.infer`는 TypeScript의 조건부 타입을 활용해 스키마로부터 타입을 추출합니다

**학습 포인트:**
- `libs/common`에 DTO를 두는 이유: Gateway와 Worker가 같은 DTO를 공유하기 때문입니다
- `z.email()`은 `z.string().email()`의 축약형입니다 (Zod 3.x)

---

## 13. `apps/chat-gateway/src/auth/auth.module.ts` — JwtModule 비동기 설정

### 핵심 코드

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),    // User Repository 주입 허용
    PassportModule,                       // Passport 전략 등록 인프라
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '1d') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],   // JwtService를 GatewayModule에서도 사용
})
export class AuthModule {}
```

### NestJS 개념: `registerAsync` 패턴

`JwtModule.registerAsync()`는 Phase 2에서 배운 `TypeOrmModule.forRootAsync()`와 동일한 패턴입니다. NestJS의 공식 모듈 대부분이 이 패턴을 지원합니다:

```
Module.forRoot()         → 앱 전체에 한 번 설정 (TypeORM, Config)
Module.forFeature()      → 기능별 설정 (특정 Repository)
Module.register()        → 정적 설정
Module.registerAsync()   → 동적 설정 (환경변수 필요)
```

**`exports`에 `JwtModule`을 포함하는 이유:**
- `ChatGateway`(WebSocket)에서 JWT 토큰을 수동으로 검증할 때 `JwtService`가 필요합니다
- `AuthModule`을 import하는 모듈은 `JwtService`를 주입받을 수 있습니다

---

## 14. `apps/chat-gateway/src/auth/jwt.strategy.ts` — PassportStrategy

### 핵심 코드

```typescript
export interface JwtPayload {
  sub: string;    // subject — 사용자 ID (JWT 표준 클레임)
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload) {
    // 반환값이 req.user에 저장됨
    return { userId: payload.sub, email: payload.email };
  }
}
```

### NestJS 개념: Passport Strategy

**Passport 동작 흐름:**

```
HTTP 요청
  ↓
AuthGuard('jwt')                    ← @UseGuards(AuthGuard('jwt'))
  ↓
JwtStrategy.validate(payload)       ← JWT 검증 성공 후 호출
  ↓
req.user = { userId, email }        ← validate() 반환값 저장
  ↓
Controller 핸들러 실행
```

**`PassportStrategy(Strategy)` 믹스인:**
- `Strategy`는 `passport-jwt` 패키지의 JWT 전략입니다
- `PassportStrategy(Strategy)`는 NestJS의 DI와 Passport를 연결하는 믹스인 함수입니다
- `super(options)`에서 JWT 검증 설정을 합니다

**`validate()` 메서드:**
- JWT 서명 검증이 성공한 후에만 호출됩니다
- 반환값은 `req.user`에 자동으로 저장됩니다
- DB 조회를 추가해 사용자 존재 여부를 확인할 수도 있습니다 (이 프로젝트에서는 생략)

**학습 포인트:**
- `sub`은 JWT 표준에서 subject를 의미하며, 사용자 ID를 담는 관례적 클레임입니다
- `ignoreExpiration: false`는 만료된 토큰을 자동으로 거부합니다
- `fromAuthHeaderAsBearerToken()`은 `Authorization: Bearer <token>` 헤더에서 토큰을 추출합니다

---

## 15. `apps/chat-gateway/src/auth/auth.service.ts` — bcrypt, JWT 서명

### 핵심 코드

```typescript
const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const user = this.userRepository.create({ email: dto.email, passwordHash });
    const saved = await this.userRepository.save(user);
    return { id: saved.id, email: saved.email };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.userRepository.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken };
  }
}
```

### NestJS 개념: 서비스 레이어와 예외 처리

**NestJS 내장 HTTP 예외:**

| 예외 클래스 | HTTP 상태 | 사용 시점 |
|------------|-----------|-----------|
| `BadRequestException` | 400 | 잘못된 입력 |
| `UnauthorizedException` | 401 | 인증 실패 |
| `ForbiddenException` | 403 | 권한 없음 |
| `NotFoundException` | 404 | 리소스 없음 |
| `ConflictException` | 409 | 중복 리소스 |

**보안 주의사항 — 이메일 존재 여부 노출 방지:**
```typescript
// 이 코드는 이메일이 존재하는지 알 수 없게 합니다
if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
  throw new UnauthorizedException('Invalid credentials');
}
```
이 프로젝트는 두 단계로 분리했지만, 실제로는 타이밍 공격(timing attack)을 막기 위해 통합하는 것이 더 안전합니다.

**bcrypt 솔트 라운드:**
- 10라운드: 약 100ms (일반적인 권장값)
- 12라운드: 약 400ms (더 안전하지만 느림)
- 값이 높을수록 브루트포스 공격에 강하지만 서버 부하가 증가합니다

**`create()` + `save()` 패턴:**
```typescript
// create(): 엔티티 인스턴스만 생성 (DB 저장 안 함)
const user = this.userRepository.create({ email, passwordHash });

// save(): 실제 INSERT 실행
const saved = await this.userRepository.save(user);
```

---

## 16. `apps/chat-gateway/src/auth/auth.controller.ts` — ZodValidationPipe 적용

### 핵심 코드

```typescript
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UsePipes(new ZodValidationPipe(RegisterSchema))   // 메서드 전체에 파이프 적용
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)                           // 기본 201 대신 200 반환
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
```

### NestJS 개념: 컨트롤러 데코레이터

**`@HttpCode(HttpStatus.OK)`를 사용하는 이유:**
- NestJS의 `@Post()`는 기본적으로 201 Created를 반환합니다
- 로그인은 리소스를 생성하는 것이 아니므로 200 OK가 더 적절합니다

**`@UsePipes()` 적용 범위:**

```typescript
// 클래스 레벨 — 모든 핸들러에 적용
@UsePipes(new ZodValidationPipe(SomeSchema))
@Controller('auth')

// 메서드 레벨 — 특정 핸들러에만 적용
@Post('register')
@UsePipes(new ZodValidationPipe(RegisterSchema))

// 파라미터 레벨 — 특정 파라미터에만 적용
async getMessages(@Query(new ZodValidationPipe(QuerySchema)) query: QueryDto)
```

**요청에서 컨트롤러까지 흐름:**
```
POST /auth/register
Body: { "email": "test@example.com", "password": "123456" }
  ↓
ZodValidationPipe.transform(body)    → RegisterSchema.safeParse(body)
  ↓ 검증 성공
AuthController.register(dto)         → dto는 타입이 보장된 RegisterDto
  ↓
AuthService.register(dto)
  ↓
{ id: "uuid", email: "test@example.com" }
```

---

## 인증 전체 흐름 요약

```
회원가입:
POST /auth/register
  → ZodValidationPipe (입력 검증)
  → AuthService.register()
  → bcrypt.hash() (비밀번호 해싱)
  → DB INSERT
  → { id, email } 반환

로그인:
POST /auth/login
  → ZodValidationPipe (입력 검증)
  → AuthService.login()
  → DB SELECT (이메일로 조회)
  → bcrypt.compare() (비밀번호 검증)
  → JwtService.sign({ sub: userId, email })
  → { accessToken: "eyJ..." } 반환

인증이 필요한 API 호출:
GET /rooms (Authorization: Bearer eyJ...)
  → AuthGuard('jwt')
  → JwtStrategy: 토큰 검증
  → validate(): req.user = { userId, email }
  → RoomsController.findMyRooms(req)
```

## 다음 단계

[Phase 4: REST API →](./04-rest-api.md)

Redis 캐시-어사이드 패턴, QueryBuilder, ULID 커서 페이지네이션을 학습합니다.
