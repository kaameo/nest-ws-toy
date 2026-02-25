# NestJS 개념 인덱스

이 프로젝트에서 사용된 모든 NestJS 개념과 해당 파일 위치를 빠르게 찾을 수 있는 참조표입니다.

---

## 모듈 시스템

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `@Module()` 데코레이터 | `apps/chat-gateway/src/app.module.ts` | 루트 모듈 정의 |
| `ConfigModule.forRoot()` | `apps/chat-gateway/src/app.module.ts` | 전역 환경변수 모듈 |
| `isGlobal: true` | `apps/chat-gateway/src/app.module.ts` | 모듈 전역 등록 |
| `TypeOrmModule.forRootAsync()` | `libs/db/src/db.module.ts` | 비동기 DB 설정 |
| `TypeOrmModule.forFeature()` | `libs/db/src/db.module.ts` | Repository 등록 |
| `DynamicModule` | `libs/redis/src/redis.module.ts` | 동적 모듈 패턴 |
| `@Global()` | `libs/redis/src/redis.module.ts` | 모듈 전역 등록 데코레이터 |
| `forRoot()` static 메서드 | `libs/redis/src/redis.module.ts` | 동적 모듈 팩토리 |
| `ClientsModule.registerAsync()` | `apps/chat-gateway/src/kafka/kafka-producer.module.ts` | Kafka 클라이언트 등록 |
| `JwtModule.registerAsync()` | `apps/chat-gateway/src/auth/auth.module.ts` | JWT 비동기 설정 |
| `PassportModule` | `apps/chat-gateway/src/auth/auth.module.ts` | Passport 통합 |
| `ServeStaticModule` | `apps/chat-gateway/src/app.module.ts` | 정적 파일 서빙 |

---

## 의존성 주입 (DI)

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `@Injectable()` | `apps/chat-gateway/src/auth/auth.service.ts` 등 | 프로바이더 등록 |
| `@Inject(TOKEN)` | `apps/chat-gateway/src/rooms/rooms.service.ts` | 커스텀 토큰으로 주입 |
| `@InjectRepository()` | `apps/chat-gateway/src/auth/auth.service.ts` | TypeORM Repository 주입 |
| 문자열 인젝션 토큰 | `libs/redis/src/redis.module.ts` | `REDIS_CLIENT = 'REDIS_CLIENT'` |
| `useFactory` | `libs/db/src/db.module.ts` | 팩토리 기반 프로바이더 |

---

## 컨트롤러

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `@Controller()` | `apps/chat-gateway/src/auth/auth.controller.ts` | HTTP 컨트롤러 |
| `@Get()`, `@Post()` | `apps/chat-gateway/src/rooms/rooms.controller.ts` | HTTP 메서드 데코레이터 |
| `@Body()` | `apps/chat-gateway/src/auth/auth.controller.ts` | 요청 본문 추출 |
| `@Param()` | `apps/chat-gateway/src/rooms/rooms.controller.ts` | URL 파라미터 추출 |
| `@Query()` | `apps/chat-gateway/src/messages/messages.controller.ts` | 쿼리스트링 추출 |
| `@Request()` | `apps/chat-gateway/src/rooms/rooms.controller.ts` | `req.user` 접근 |
| `@HttpCode(HttpStatus.OK)` | `apps/chat-gateway/src/auth/auth.controller.ts` | 응답 상태 코드 변경 |

---

## 파이프 (Pipes)

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `PipeTransform` 구현 | `libs/common/src/utils/zod-validation.pipe.ts` | 커스텀 파이프 |
| `@UsePipes()` | `apps/chat-gateway/src/auth/auth.controller.ts` | 파이프 적용 데코레이터 |
| `ParseUUIDPipe` | `apps/chat-gateway/src/rooms/rooms.controller.ts` | UUID 검증 내장 파이프 |
| 파라미터 레벨 파이프 | `apps/chat-gateway/src/messages/messages.controller.ts` | `@Query(new ZodValidationPipe(...))` |

---

## Guards

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `AuthGuard('jwt')` | `apps/chat-gateway/src/rooms/rooms.controller.ts` | JWT 인증 가드 |
| `@UseGuards()` | `apps/chat-gateway/src/rooms/rooms.controller.ts` | 가드 적용 데코레이터 |

---

## 인증 (Authentication)

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `PassportStrategy(Strategy)` | `apps/chat-gateway/src/auth/jwt.strategy.ts` | JWT 전략 구현 |
| `ExtractJwt.fromAuthHeaderAsBearerToken()` | `apps/chat-gateway/src/auth/jwt.strategy.ts` | Bearer 토큰 추출 |
| `validate()` → `req.user` | `apps/chat-gateway/src/auth/jwt.strategy.ts` | 인증 후 사용자 정보 저장 |
| `JwtService.sign()` | `apps/chat-gateway/src/auth/auth.service.ts` | JWT 토큰 발급 |
| `JwtService.verify()` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | JWT 수동 검증 |
| `bcrypt.hash()` | `apps/chat-gateway/src/auth/auth.service.ts` | 비밀번호 해싱 |
| `bcrypt.compare()` | `apps/chat-gateway/src/auth/auth.service.ts` | 비밀번호 검증 |

---

## TypeORM 엔티티

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `@Entity()` | `libs/db/src/entities/user.entity.ts` | 엔티티 등록 |
| `@PrimaryGeneratedColumn('uuid')` | `libs/db/src/entities/user.entity.ts` | UUID 자동 생성 PK |
| `@PrimaryColumn()` | `libs/db/src/entities/message.entity.ts` | 수동 PK (ULID) |
| 복합 PK | `libs/db/src/entities/room-member.entity.ts` | `@PrimaryColumn()` 두 개 |
| `@Column({ name: ... })` | `libs/db/src/entities/user.entity.ts` | snake_case 컬럼명 매핑 |
| `@CreateDateColumn` | `libs/db/src/entities/user.entity.ts` | 생성 시각 자동 설정 |
| `@Unique()` | `libs/db/src/entities/message.entity.ts` | 복합 UNIQUE 제약 |
| `@Index()` | `libs/db/src/entities/message.entity.ts` | 성능 인덱스 |

---

## TypeORM 쿼리

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `repository.findOne()` | `apps/chat-gateway/src/auth/auth.service.ts` | 단일 레코드 조회 |
| `repository.create()` + `save()` | `apps/chat-gateway/src/auth/auth.service.ts` | 엔티티 생성 및 저장 |
| `repository.find()` | `apps/chat-gateway/src/rooms/rooms.service.ts` | 다중 레코드 조회 |
| `createQueryBuilder()` | `apps/chat-gateway/src/rooms/rooms.service.ts` | 복잡한 쿼리 빌더 |
| `.whereInIds()` | `apps/chat-gateway/src/rooms/rooms.service.ts` | `WHERE id IN (...)` |
| `.andWhere()` | `apps/chat-gateway/src/messages/messages.service.ts` | 조건 추가 |
| `.orderBy()` | `apps/chat-gateway/src/messages/messages.service.ts` | 정렬 |
| `.limit()` | `apps/chat-gateway/src/messages/messages.service.ts` | 결과 수 제한 |
| `dataSource.transaction()` | `apps/chat-worker/src/persistor/persistor.service.ts` | 트랜잭션 |
| `.orIgnore()` | `apps/chat-worker/src/persistor/persistor.service.ts` | `ON CONFLICT DO NOTHING` |

---

## WebSocket

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `@WebSocketGateway()` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | 게이트웨이 등록 |
| `@WebSocketServer()` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | Server 인스턴스 주입 |
| `OnGatewayConnection` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | 연결 이벤트 훅 |
| `OnGatewayDisconnect` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | 연결 해제 이벤트 훅 |
| `@SubscribeMessage()` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | 이벤트 핸들러 등록 |
| `@ConnectedSocket()` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | 소켓 객체 주입 |
| `@MessageBody()` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | 이벤트 페이로드 주입 |
| `client.join(roomId)` | `apps/chat-gateway/src/gateway/chat.gateway.ts` | Socket.IO Room 참가 |
| `server.to(roomId).emit()` | `apps/chat-gateway/src/gateway/broadcast.controller.ts` | Room 브로드캐스트 |
| WebSocket JWT 수동 검증 | `apps/chat-gateway/src/gateway/chat.gateway.ts` | `jwtService.verify()` |

---

## Kafka / 마이크로서비스

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `NestFactory.create<NestFastifyApplication>()` + `connectMicroservice()` | `apps/chat-gateway/src/main.ts` | 하이브리드 앱 (Fastify) |
| `app.startAllMicroservices()` | `apps/chat-gateway/src/main.ts` | 마이크로서비스 시작 |
| `Transport.KAFKA` | `apps/chat-gateway/src/main.ts` | Kafka 트랜스포트 |
| `ClientsModule.registerAsync()` | `apps/chat-gateway/src/kafka/kafka-producer.module.ts` | Kafka 프로듀서 등록 |
| `ClientKafka` | `apps/chat-gateway/src/kafka/kafka-producer.service.ts` | Kafka 클라이언트 타입 |
| `kafkaClient.emit()` | `apps/chat-gateway/src/kafka/kafka-producer.service.ts` | Kafka 메시지 발행 |
| `lastValueFrom()` | `apps/chat-gateway/src/kafka/kafka-producer.service.ts` | Observable → Promise |
| `@MessagePattern()` | `apps/chat-worker/src/persistor/persistor.controller.ts` | Kafka 컨슈머 핸들러 |
| `@Payload()` | `apps/chat-worker/src/persistor/persistor.controller.ts` | 메시지 페이로드 주입 |
| `@Ctx()` | `apps/chat-worker/src/persistor/persistor.controller.ts` | Kafka 컨텍스트 주입 |
| `idempotent: true` | `apps/chat-gateway/src/kafka/kafka-producer.module.ts` | 프로듀서 멱등성 |

---

## 생명주기 훅

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `OnModuleInit` | `apps/chat-gateway/src/kafka/kafka-producer.service.ts` | 모듈 초기화 후 실행 |
| `enableShutdownHooks()` | `apps/chat-gateway/src/main.ts` | Graceful shutdown 활성화 |

---

## 헬스체크

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `@HealthCheck()` | `apps/chat-gateway/src/health/health.controller.ts` | 헬스체크 엔드포인트 |
| `HealthCheckService` | `apps/chat-gateway/src/health/health.controller.ts` | 헬스체크 실행 |
| `TypeOrmHealthIndicator` | `apps/chat-gateway/src/health/health.controller.ts` | DB 헬스 지표 |
| `HealthIndicator` 상속 | `apps/chat-gateway/src/health/redis.health.ts` | 커스텀 헬스 지표 |
| `getStatus()` | `apps/chat-gateway/src/health/redis.health.ts` | 상태 객체 생성 |
| `HealthCheckError` | `apps/chat-gateway/src/health/redis.health.ts` | 헬스체크 실패 예외 |

---

## 환경변수 및 설정

| 개념 | 파일 위치 | 설명 |
|------|-----------|------|
| `z.object()` 환경변수 스키마 | `libs/common/src/utils/env.validation.ts` | Zod 환경변수 검증 |
| `z.coerce.number()` | `libs/common/src/utils/env.validation.ts` | 문자열 → 숫자 강제 변환 |
| `z.infer<typeof Schema>` | `libs/common/src/dto/auth.dto.ts` | 스키마에서 타입 추론 |
| `ConfigService.getOrThrow()` | `libs/db/src/db.module.ts` | 필수 환경변수 조회 |
| `ConfigService.get('KEY', default)` | `apps/chat-gateway/src/main.ts` | 기본값 있는 조회 |
| `validate` 함수 | `apps/chat-gateway/src/app.module.ts` | ConfigModule 검증 함수 |

---

## NestJS 예외 처리

| 예외 클래스 | HTTP 상태 | 파일 위치 |
|------------|-----------|-----------|
| `BadRequestException` | 400 | `libs/common/src/utils/zod-validation.pipe.ts` |
| `UnauthorizedException` | 401 | `apps/chat-gateway/src/auth/auth.service.ts` |
| `ForbiddenException` | 403 | `apps/chat-gateway/src/rooms/rooms.controller.ts` |
| `NotFoundException` | 404 | `apps/chat-gateway/src/rooms/rooms.service.ts` |
| `ConflictException` | 409 | `apps/chat-gateway/src/auth/auth.service.ts` |

---

## 개념 학습 순서 추천

```
NestJS 처음 시작
  ↓
@Module, @Injectable, @Controller → Phase 1, 2
  ↓
DI, forRootAsync, DynamicModule → Phase 2
  ↓
Passport, JWT, Guards → Phase 3
  ↓
Repository, QueryBuilder, Pipes → Phase 4
  ↓
WebSocket, OnGatewayConnection → Phase 5
  ↓
Kafka, @MessagePattern, 마이크로서비스 → Phase 6
  ↓
Terminus, HealthIndicator → Phase 7
```

[← 돌아가기: README](./README.md)
