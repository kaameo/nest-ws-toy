# Improvements (개선 사항)

## 완료된 개선 (Completed)

### ~~1. WsJwtGuard 미사용 (dead code)~~ ✅

`ws-jwt.guard.ts` 파일 삭제, `AuthModule`에서 export 제거.

### ~~2. Fanout Producer에 `idempotent: true` 누락~~ ✅

`apps/chat-worker/src/fanout/fanout.module.ts`에 `idempotent: true` 추가.

### ~~7. `isMember` 중복 구현~~ ✅

`MessagesService`에서 자체 `isMember()` 제거, `RoomsService.isMember()`로 통합. `MessagesModule`에서 `RoomMember` TypeORM import 제거, `RoomsModule` import 추가.

### ~~client.user undefined 가드 누락~~ ✅

`joinRoom`, `sendMessage` 핸들러에 `client.user` 미인증 체크 추가.

### ~~findMembers 권한 검증 누락~~ ✅

`RoomsController.findMembers()`에 요청 유저의 멤버십 확인 추가 (`ForbiddenException`).

### ~~SYSTEM 메시지 타입 클라이언트 노출~~ ✅

`SendMessageSchema`의 `type` enum에서 `'SYSTEM'` 제거 → `['TEXT', 'IMAGE']`만 허용.

### ~~isMember Redis 캐싱~~ ✅

`RoomsService.isMember()`에 Redis 캐싱 추가 (30초 TTL, `membership:{roomId}:{userId}` 키). `join()` 시 캐시 무효화.

### ~~Presence refreshTTL 스테일 소켓~~ ✅

`PresenceService.refreshTTL()`에서 `socketId` 존재 여부 확인 후 hash entry 업데이트. `ChatGateway`에서 heartbeat 시 `client.id` 전달.

### ~~ULID 커서 유효성 검증~~ ✅

`MessageQuerySchema`의 `before`/`after`에 ULID 정규식 검증 추가 (`/^[0-9A-HJKMNP-TV-Z]{26}$/`).

### ~~MessagesService RoomMember 리포지토리 제거~~ ✅

`MessagesService`에서 `RoomMember` 리포지토리 의존 제거. `updateReadCursor`는 `RoomsService.updateReadCursor()`로 위임.

---

## HIGH Priority (미완료)

### 3. TypeORM 관계(Relations) 미정의

모든 엔티티가 raw 컬럼만 사용하고 `@ManyToOne`/`@OneToMany`가 없다. DB 레벨 FK 제약조건이 없어 데이터 무결성 보장 안 됨.

**방안**: 엔티티에 관계 데코레이터 추가, FK 제약조건 생성.

### 4. `synchronize: true` (dev 전용)

`libs/db/src/db.module.ts:24`에서 `NODE_ENV !== 'production'`일 때 auto sync. 스키마 변경 시 데이터 유실 위험.

**방안**: TypeORM migration 사용으로 전환.

### 5. Rate Limiting 없음

`sendMessage`, `register`, `login` 등 모든 엔드포인트에 속도 제한 없음.

**방안**: `@nestjs/throttler` 적용.

---

## MEDIUM Priority (미완료)

### 6. 방 나가기(leave) 미구현

`POST /rooms/:roomId/join`은 있지만 나가기 기능이 없음. `leaveRoom` WebSocket 이벤트도 없음.

### 8. CORS `origin: '*'`

HTTP (`main.ts:10`)와 WebSocket (`chat.gateway.ts:32`) 모두 모든 origin 허용. 프로덕션에서는 특정 도메인으로 제한.

### 9. Kafka Graceful Shutdown 없음

`enableShutdownHooks()`는 있지만 Kafka 클라이언트의 `OnModuleDestroy`가 미구현. 셧다운 시 메시지 유실 가능.

### 10. JWT Secret 최소 길이 8자

`env.validation.ts:19`에서 `JWT_SECRET: z.string().min(8)`. 프로덕션에서는 32자 이상 권장.

---

## LOW Priority (미완료)

### 11. 방 목록 페이지네이션 없음

`findMyRooms()`가 전체 방 목록을 반환. 방이 많아지면 성능 저하.

### 12. `findMyRooms`의 `whereInIds` 쿼리

`rooms.service.ts:57-58`에서 `WHERE id IN (...)` 사용. 방이 많으면 JOIN 기반 쿼리가 효율적.

### 13. 연결 해제 시 "user left" 이벤트 없음

Socket.IO가 자동으로 룸에서 제거하지만, 다른 멤버에게 퇴장 알림을 보내지 않음.

### 14. Redis `lazyConnect` 주의

`redis.module.ts:22`에서 `lazyConnect: true` 설정. 첫 명령 실행 시까지 연결되지 않아 헬스체크가 실패할 수 있음.
