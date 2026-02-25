# Design Decisions (설계 결정)

## 주요 기술 선택과 근거

### 1. 왜 Kafka인가? (직접 WebSocket 브로드캐스트 대신)

| 관점 | 직접 브로드캐스트 | Kafka 경유 |
|------|-------------------|------------|
| 지연 시간 | 즉시 (~1ms) | 추가 지연 (~10-50ms) |
| 내구성 | 메모리만 (서버 죽으면 유실) | 디스크 저장 (서버 죽어도 보존) |
| 백프레셔 | DB 느리면 클라이언트도 느림 | Kafka에 큐잉, DB 독립적 |
| 확장성 | 단일 서버 한계 | 파티션으로 수평 확장 |
| 재처리 | 불가 | 오프셋 리셋으로 재처리 가능 |
| 관심사 분리 | Gateway가 DB도 관리 | Gateway는 수신만, Worker가 저장 |

**결론**: "accepted"(빠름, Kafka까지만)와 "persisted"(느림, DB까지)를 분리하여 사용자 체감 지연을 최소화.

### 2. 왜 ULID인가? (UUID 대신)

| 관점 | UUID v4 | ULID |
|------|---------|------|
| 정렬 | 랜덤 → 정렬 불가 | 시간순 정렬 가능 |
| 페이지네이션 | offset 기반 필요 | 커서 기반 가능 (`WHERE id > :cursor`) |
| 인덱스 성능 | B-tree 삽입 랜덤 | 시간순 삽입 → append 패턴 |
| 길이 | 36자 (하이픈 포함) | 26자 |
| 분산 생성 | 가능 | 가능 |

**결론**: 채팅 메시지는 시간순 조회가 핵심. ULID로 별도 타임스탬프 컬럼 없이 효율적 커서 페이지네이션 가능.

### 3. 왜 Redis로 Presence인가? (DB 대신)

| 관점 | DB | Redis |
|------|-------|-------|
| 속도 | 느림 (디스크 I/O) | 빠름 (메모리) |
| TTL | 직접 구현 필요 | 내장 (`EXPIRE`) |
| 장애 시 | 영구 저장 → 좀비 데이터 | TTL 만료 → 자동 정리 |
| 크로스 서버 | 가능 | 가능 |
| 멀티 디바이스 | 직접 구현 | Hash 타입으로 자연스럽게 |

**결론**: 접속 상태는 일시적(transient) 데이터. TTL 기반 자동 만료가 핵심 요구사항이며, Redis가 가장 적합.

### 4. 왜 Zod인가? (class-validator 대신)

| 관점 | class-validator | Zod |
|------|-----------------|-----|
| 타입 추론 | 수동 (class 정의) | 자동 (`z.infer<typeof Schema>`) |
| 재사용 범위 | HTTP DTO만 | HTTP + WebSocket + Kafka + env |
| 스키마 조합 | 데코레이터 기반 | `.merge()`, `.extend()`, `.pick()` |
| 런타임 검증 | NestJS 파이프라인 내 | 어디서든 `.safeParse()` |

**결론**: Kafka 이벤트와 WebSocket 페이로드도 검증해야 하므로 NestJS에 종속되지 않는 Zod가 유리.

### 5. 연결 시점 인증 vs 메시지별 인증

| 관점 | 연결 시점 (현재) | 메시지별 |
|------|------------------|----------|
| 지연 | 메시지마다 검증 없음 (빠름) | 매번 JWT 검증 (느림) |
| 보안 | 토큰 만료 감지 못함 | 만료 즉시 차단 |
| 구현 | 간단 (`handleConnection`에서 1회) | `@UseGuards()` 매 핸들러에 적용 |

**결론**: 학습 프로젝트에서는 연결 시점 인증으로 충분. 프로덕션에서는 토큰 만료 시 연결 해제 로직 추가 필요.

### 6. At-Least-Once Delivery + 멱등 저장

```
Producer (idempotent: true, acks: all)
  → Kafka (복제 완료까지 대기)
    → Consumer (에러 시 throw → offset commit 방지 → 재시도)
      → DB (UNIQUE 제약 + ON CONFLICT DO NOTHING → 중복 무시)
```

**왜 Exactly-Once가 아닌가?**: Kafka Exactly-Once는 트랜잭션 설정이 복잡하고 성능 비용이 큼. At-Least-Once + 멱등 저장이 더 단순하고 실용적.

### 7. isMember Redis 캐싱

매 WebSocket 이벤트(`joinRoom`, `sendMessage`)와 HTTP 요청(`getMessages`, `updateReadCursor`)마다 `RoomMember` 테이블을 조회하면 DB 부하가 높다.

**구현**: `RoomsService.isMember()`에서 Redis GET/SET으로 30초 TTL 캐싱.

- 키: `membership:{roomId}:{userId}` → 값: `'1'` 또는 `'0'`
- `join()` 시 해당 키 삭제(캐시 무효화)

| 관점 | DB만 | Redis 캐싱 |
|------|------|-----------|
| 지연 | ~1-5ms (DB) | ~0.1ms (Redis hit) |
| 일관성 | 즉시 | 최대 30초 stale (leave 미구현이므로 현재 문제 없음) |
| 복잡도 | 낮음 | 캐시 무효화 로직 필요 |

---

## Trade-offs 요약

| 결정 | 장점 | 단점 |
|------|------|------|
| Kafka 2-tier | 내구성, 확장성, 관심사 분리 | 지연 추가, 인프라 복잡 |
| ULID | 시간순 정렬, 커서 페이지네이션 | 26자 문자열, 앱에서 생성 |
| Redis Presence | TTL 자동 만료, 빠름 | 인프라 추가, eventual consistency |
| Zod | 범용 검증, 타입 추론 | NestJS Swagger 통합 약함 |
| 연결 시점 인증 | 간단, 빠름 | 토큰 만료 감지 불가 |
| TypeORM `synchronize: true` | 마이그레이션 불필요 | 프로덕션 위험, 데이터 유실 가능 |
| TypeORM 관계 미정의 | 엔티티 단순 | FK 제약 없음, JOIN 불편 |
