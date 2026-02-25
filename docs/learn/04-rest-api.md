# Phase 4: REST API — Controllers, Services, 캐싱

## 학습 목표

- Redis 캐시-어사이드(Cache-Aside) 패턴을 서비스 레이어에서 구현하는 방법을 익힌다
- TypeORM `QueryBuilder`로 복잡한 쿼리를 작성하는 방법을 배운다
- `ParseUUIDPipe`로 URL 파라미터를 검증하는 방법을 안다
- ULID를 활용한 커서 기반 페이지네이션을 이해한다
- `@Query()` 파라미터에 Zod 검증을 적용하는 방법을 본다

## 읽을 파일 목록

17. `apps/chat-gateway/src/rooms/rooms.service.ts`
18. `apps/chat-gateway/src/rooms/rooms.controller.ts`
19. `apps/chat-gateway/src/messages/messages.service.ts`
20. `apps/chat-gateway/src/messages/messages.controller.ts`

---

## 17. `apps/chat-gateway/src/rooms/rooms.service.ts` — 캐시-어사이드 + QueryBuilder

### 핵심 코드: 캐시-어사이드 패턴

```typescript
const MEMBER_CACHE_TTL = 30; // seconds
const MEMBER_CACHE_PREFIX = 'membership:';

async isMember(roomId: string, userId: string): Promise<boolean> {
  const cacheKey = `${MEMBER_CACHE_PREFIX}${roomId}:${userId}`;

  // 1단계: 캐시 확인
  const cached = await this.redis.get(cacheKey);
  if (cached !== null) {
    return cached === '1';
  }

  // 2단계: 캐시 미스 → DB 조회
  const member = await this.memberRepository.findOne({
    where: { roomId, userId },
  });
  const result = member !== null;

  // 3단계: 결과를 캐시에 저장 (30초 TTL)
  await this.redis.set(cacheKey, result ? '1' : '0', 'EX', MEMBER_CACHE_TTL);
  return result;
}
```

### NestJS 개념: 캐시-어사이드 패턴

채팅 메시지를 보낼 때마다 "이 사람이 이 방의 멤버인가?"를 DB에서 확인하면 성능 문제가 생깁니다. 캐시-어사이드로 이를 해결합니다.

```
isMember() 호출
  ↓
Redis에서 membership:{roomId}:{userId} 조회
  ├── 캐시 HIT ('0' 또는 '1') → 즉시 반환
  └── 캐시 MISS (null) → DB 조회 → Redis 저장 후 반환
```

**키 네이밍 전략 `membership:{roomId}:{userId}`:**
- 계층적 구조로 `SCAN membership:*`로 특정 방의 모든 멤버십 캐시를 찾을 수 있습니다
- `:` 구분자는 Redis 관례입니다

**`'EX'` 옵션:** Redis의 `SET key value EX seconds` 명령어로 TTL을 함께 설정합니다.

**캐시 무효화:**
```typescript
async join(roomId: string, userId: string): Promise<RoomMember> {
  // ...DB 저장...
  await this.redis.del(`${MEMBER_CACHE_PREFIX}${roomId}:${userId}`);  // 캐시 삭제
  return saved;
}
```
멤버십이 변경(가입)될 때 해당 캐시를 즉시 삭제합니다. 다음 `isMember()` 호출 시 DB를 조회하고 새 값을 캐싱합니다.

### 핵심 코드: QueryBuilder

```typescript
async findMyRooms(userId: string): Promise<Room[]> {
  const members = await this.memberRepository.find({
    where: { userId },
  });
  if (members.length === 0) return [];

  const roomIds = members.map((m) => m.roomId);
  return this.roomRepository
    .createQueryBuilder('room')
    .whereInIds(roomIds)
    .orderBy('room.created_at', 'DESC')
    .getMany();
}
```

**`find()` vs `createQueryBuilder()`:**

| 방법 | 언제 사용 |
|------|-----------|
| `find({ where: ... })` | 단순 조건 조회 |
| `createQueryBuilder()` | 정렬, JOIN, 서브쿼리 등 복잡한 쿼리 |

**`whereInIds(roomIds)`:** `WHERE id IN (uuid1, uuid2, ...)` SQL을 생성합니다.

---

## 18. `apps/chat-gateway/src/rooms/rooms.controller.ts` — Guards와 ParseUUIDPipe

### 핵심 코드

```typescript
@Controller('rooms')
@UseGuards(AuthGuard('jwt'))        // 클래스 레벨 — 모든 엔드포인트에 JWT 인증 적용
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateRoomSchema))
  async create(@Body() dto: CreateRoomDto, @Request() req: any) {
    return this.roomsService.create(dto, req.user.userId);  // req.user는 JwtStrategy.validate()가 설정
  }

  @Post(':roomId/join')
  async join(
    @Param('roomId', ParseUUIDPipe) roomId: string,  // UUID 형식 검증
    @Request() req: any,
  ) {
    return this.roomsService.join(roomId, req.user.userId);
  }

  @Get(':roomId/members')
  async findMembers(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Request() req: any,
  ) {
    const isMember = await this.roomsService.isMember(roomId, req.user.userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this room');
    }
    return this.roomsService.findMembers(roomId);
  }
}
```

### NestJS 개념: Guards

**Guard의 역할:** 인증(Authentication) — 요청자가 누구인지 확인.

Guard는 `CanActivate` 인터페이스를 구현하며, `true`를 반환하면 요청이 통과합니다.

```
요청
  ↓
AuthGuard('jwt')
  ├── JWT 유효 → true → 컨트롤러 실행
  └── JWT 무효/없음 → false → 401 UnauthorizedException
```

**`@UseGuards()` 적용 범위:**
```typescript
// 전역 (main.ts)
app.useGlobalGuards(new AuthGuard('jwt'));

// 클래스 레벨 (모든 메서드)
@UseGuards(AuthGuard('jwt'))
@Controller('rooms')

// 메서드 레벨 (특정 메서드만)
@Get('public')
@UseGuards(AuthGuard('jwt'))
```

### NestJS 개념: ParseUUIDPipe

```typescript
@Param('roomId', ParseUUIDPipe) roomId: string
```

URL 파라미터 `roomId`가 유효한 UUID 형식인지 자동으로 검증합니다.

```
GET /rooms/not-a-uuid/members
  → ParseUUIDPipe 검증 실패
  → 400 BadRequestException: "Validation failed (uuid is expected)"
```

**내장 파이프들:**
| 파이프 | 역할 |
|--------|------|
| `ParseUUIDPipe` | UUID 형식 검증 |
| `ParseIntPipe` | 문자열 → 정수 변환 |
| `ParseBoolPipe` | 문자열 → boolean 변환 |
| `ParseArrayPipe` | 배열 파싱 |
| `DefaultValuePipe` | 기본값 설정 |

---

## 19. `apps/chat-gateway/src/messages/messages.service.ts` — ULID 커서 페이지네이션

### 핵심 코드

```typescript
async getMessages(
  roomId: string,
  userId: string,
  query: MessageQueryDto,
): Promise<MessageResponse[]> {
  const isMember = await this.roomsService.isMember(roomId, userId);
  if (!isMember) {
    throw new ForbiddenException('Not a member of this room');
  }

  const qb = this.messageRepository
    .createQueryBuilder('msg')
    .where('msg.room_id = :roomId', { roomId });

  // 커서 페이지네이션
  if (query.before) {
    qb.andWhere('msg.id < :before', { before: query.before });  // 이 메시지 이전
  }
  if (query.after) {
    qb.andWhere('msg.id > :after', { after: query.after });     // 이 메시지 이후
  }

  // before가 있으면 역순 조회 후 뒤집기 (최신 → 과거 방향으로 페이지 이동)
  if (query.before) {
    qb.orderBy('msg.id', 'DESC');
  } else {
    qb.orderBy('msg.id', 'ASC');
  }

  qb.limit(query.limit);
  const messages = await qb.getMany();

  if (query.before) {
    messages.reverse();  // DESC로 조회했으므로 시간순으로 뒤집기
  }

  return messages;
}
```

### NestJS 개념: 커서 기반 페이지네이션

**오프셋 방식 vs 커서 방식:**

| 방식 | SQL | 문제점 |
|------|-----|--------|
| 오프셋 | `LIMIT 20 OFFSET 100` | 데이터 추가/삭제 시 중복/누락 발생 |
| 커서 | `WHERE id < :cursor LIMIT 20` | 일관성 보장, 대용량 데이터에서 성능 좋음 |

**ULID를 커서로 사용하는 이유:**
```
메시지 ID 예시:
01HXYZ1234567890ABCDEF  (2024-01-01 12:00:00)
01HXYZ2345678901BCDEFG  (2024-01-01 12:00:01)
01HXYZ3456789012CDEFGH  (2024-01-01 12:00:02)
```

ULID는 시간 기반이므로 사전순 정렬 = 시간순 정렬입니다. 따라서 `WHERE id < :cursor`가 "이 시간 이전 메시지"를 의미합니다.

**채팅 UI에서의 사용 패턴:**
```
# 최신 메시지 20개 로드
GET /rooms/{id}/messages?limit=20

# "더 이전 메시지" 불러오기 (스크롤 업)
GET /rooms/{id}/messages?before=01HXYZ1234...&limit=20

# 새 메시지 폴링 (스크롤 다운)
GET /rooms/{id}/messages?after=01HXYZ9999...&limit=20
```

**학습 포인트:**
- `QueryBuilder`의 파라미터는 `:paramName` 형식의 명명된 파라미터를 사용합니다 (SQL 인젝션 방지)
- `DESC` 조회 후 `reverse()`는 "최신 N개를 시간순으로 보여주는" UI 패턴입니다

---

## 20. `apps/chat-gateway/src/messages/messages.controller.ts` — 쿼리 파라미터 검증

### 핵심 코드

```typescript
@Controller('rooms/:roomId')
@UseGuards(AuthGuard('jwt'))
export class MessagesController {
  @Get('messages')
  async getMessages(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query(new ZodValidationPipe(MessageQuerySchema)) query: MessageQueryDto,  // 쿼리스트링 검증
    @Request() req: any,
  ) {
    return this.messagesService.getMessages(roomId, req.user.userId, query);
  }

  @Post('read')
  async updateReadCursor(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body(new ZodValidationPipe(UpdateReadCursorSchema)) dto: UpdateReadCursorDto,
    @Request() req: any,
  ) {
    await this.messagesService.updateReadCursor(roomId, req.user.userId, dto.lastReadMessageId);
    return { success: true };
  }
}
```

### NestJS 개념: 파라미터 레벨 파이프

`@Query(pipe)` 형태로 파라미터에 직접 파이프를 적용할 수 있습니다.

```typescript
// @UsePipes 방식 — 핸들러 전체에 적용
@UsePipes(new ZodValidationPipe(MessageQuerySchema))
async getMessages(@Query() query: MessageQueryDto)

// 파라미터 레벨 방식 — 특정 파라미터에만 적용
async getMessages(@Query(new ZodValidationPipe(MessageQuerySchema)) query: MessageQueryDto)
```

**`MessageQuerySchema`:**
```typescript
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const MessageQuerySchema = z.object({
  before: z.string().regex(ulidRegex, 'Invalid ULID format').optional(),  // ULID 커서
  after: z.string().regex(ulidRegex, 'Invalid ULID format').optional(),   // ULID 커서
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

**URL 예시:**
```
GET /rooms/550e8400.../messages?before=01HXYZ...&limit=20
```
`@Query()`는 쿼리스트링 전체를 객체로 받고, `ZodValidationPipe`가 타입 변환(`limit: "20"` → `20`)과 검증을 수행합니다.

**`@Controller('rooms/:roomId')`에서 중첩 경로:**
- 이 컨트롤러의 경로는 `/rooms/:roomId`를 기반으로 합니다
- `@Get('messages')`의 최종 경로: `GET /rooms/:roomId/messages`
- `@Post('read')`의 최종 경로: `POST /rooms/:roomId/read`

---

## REST API 전체 엔드포인트 정리

| 메서드 | 경로 | Guard | 기능 |
|--------|------|-------|------|
| POST | `/auth/register` | 없음 | 회원가입 |
| POST | `/auth/login` | 없음 | 로그인 (JWT 발급) |
| POST | `/rooms` | JWT | 채팅방 생성 |
| POST | `/rooms/:roomId/join` | JWT | 채팅방 참가 |
| GET | `/rooms` | JWT | 내 채팅방 목록 |
| GET | `/rooms/:roomId/members` | JWT + isMember | 채팅방 멤버 목록 |
| GET | `/rooms/:roomId/messages` | JWT | 메시지 조회 (커서 페이지네이션) |
| POST | `/rooms/:roomId/read` | JWT | 읽음 커서 업데이트 |
| GET | `/health` | 없음 | 헬스체크 |

## 다음 단계

[Phase 5: WebSocket →](./05-websocket.md)

Socket.IO 게이트웨이, JWT 수동 검증, Redis Presence 추적을 학습합니다.
