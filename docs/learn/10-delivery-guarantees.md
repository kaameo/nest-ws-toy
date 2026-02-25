# 메시지 전달 보장 수준 이해하기

## 학습 목표

- At-Most-Once, At-Least-Once, Exactly-Once의 차이 이해
- 각각의 실무 사용 사례 파악
- 이 프로젝트의 전달 보장 수준 분석

---

## 1. 세 가지 전달 보장 수준

### At-Most-Once (최대 1회)

- 메시지 유실 가능, 중복 없음
- 사용 사례: 실시간 메트릭/로그 수집, GPS 위치 추적, 라이브 스트리밍, 게임 상태 동기화
- 공통점: 데이터가 연속적이고 최신 값이 이전 값을 대체

### At-Least-Once (최소 1회)

- 메시지 유실 없음, 중복 가능
- 사용 사례: 이메일/푸시 알림, 이벤트 로그 적재(Data Lake), Webhook 전달, 이 프로젝트의 채팅 메시지
- 공통점: 수신 측에 멱등성이 있거나, 중복 비용이 유실보다 낮음

### Exactly-Once (정확히 1회)

- 유실도 중복도 없음. 가장 강력하고 비쌈
- 사용 사례: 결제/송금, 재고 차감, 주문 생성, 금융 원장
- 공통점: 비가역적 부수효과가 있어 중복도 유실도 비용이 큼

### 비교표

| | At-Most-Once | At-Least-Once | Exactly-Once |
|---|---|---|---|
| 메시지 유실 | 가능 | 없음 | 없음 |
| 메시지 중복 | 없음 | 가능 | 없음 |
| 구현 복잡도 | 낮음 | 중간 | 높음 |
| 성능 | 빠름 | 보통 | 느림 (트랜잭션 오버헤드) |
| 필수 요소 | Fire-and-forget | ACK + 재시도 | Kafka Transactions 또는 Outbox 패턴 |

### 선택 기준 의사결정 트리

```
"중복되면 돈이 날아가나?"
  → Yes → Exactly-Once
  → No  → "유실되면 문제인가?"
            → No  → At-Most-Once
            → Yes → At-Least-Once + 멱등성
```

> 실무에서는 At-Least-Once + 멱등성이 80% 이상. Exactly-Once가 필요한 곳은 금융/결제로 한정적이며, 분산 트랜잭션 대신 멱등 키 + 상태 머신으로 대체하는 경우가 많음.

---

## 2. 이 프로젝트의 At-Least-Once 구현 검증

### 2.1 프로듀서 설정 — PASS

- 파일: `apps/chat-gateway/src/kafka/kafka-producer.module.ts:24`, `apps/chat-worker/src/fanout/fanout.module.ts:23`
- `idempotent: true` → KafkaJS가 자동으로 `acks: -1` (all replicas) + `retries: MAX_SAFE_INTEGER` 적용
- 프로듀서 → 브로커 구간 메시지 유실 방지 확인

### 2.2 컨슈머 오프셋 관리 — PASS (암묵적)

- 파일: `apps/chat-worker/src/main.ts:29-32`, `apps/chat-gateway/src/main.ts:30-33`
- `autoCommit` 명시 없음 → KafkaJS 기본값 `autoCommit: true`, `autoCommitInterval: 5000ms`
- NestJS Kafka transport는 `eachMessage` 모드 사용 → 핸들러 Promise resolve 후 오프셋 커밋
- 핸들러가 throw하면 오프셋 미커밋 → 재처리됨
- 주의: 5초 간격 auto-commit으로 인해 처리 완료~커밋 사이 크래시 시 재전달 발생 (at-least-once에서는 정상)

### 2.3 Worker 에러 핸들링 — PASS

- 파일: `apps/chat-worker/src/persistor/persistor.controller.ts:26-31`
- persist 실패 시 `throw error` → 오프셋 미커밋 → KafkaJS가 파티션 pause 후 재시도
- 잘못된 메시지(Zod 파싱 실패)는 `return`으로 스킵 — 의도적 poison pill 처리

### 2.4 Gateway 브로드캐스트 핸들링 — WARN

- 파일: `apps/chat-gateway/src/gateway/broadcast.controller.ts:25-33`
- `server.to().emit()`은 fire-and-forget (Socket.IO 특성상 전달 보장 불가)
- try/catch 없음 — `server`가 null이면 미처리 에러로 오프셋 미커밋 (올바른 동작이지만 로깅 부재)
- Kafka 레이어에서는 at-least-once 유지, WebSocket 구간은 본질적으로 best-effort

### 2.5 DB 멱등성 — PASS

- 파일: `libs/db/src/entities/message.entity.ts:11`
- `UNIQUE(roomId, senderId, clientMsgId)` + `.orIgnore()` = `ON CONFLICT DO NOTHING`
- at-least-once 재전달 시 중복 INSERT 방지

### 종합 결과

| 검증 항목 | 결과 | 비고 |
|-----------|------|------|
| 프로듀서 acks | PASS | `idempotent: true` → `acks=-1` 자동 |
| 컨슈머 오프셋 | PASS | 암묵적 auto-commit, throw 시 미커밋 |
| Worker 에러 핸들링 | PASS | rethrow로 재처리 보장 |
| 브로드캐스트 핸들링 | WARN | Socket.IO fire-and-forget, try/catch 부재 |
| DB 멱등성 | PASS | 유니크 제약조건 + orIgnore |

---

## 3. 개선 방향

| 방안 | 난이도 | 효과 | 설명 |
|------|--------|------|------|
| `autoCommitThreshold: 1` 설정 | 낮음 | 크래시 윈도우 축소 | 매 메시지 처리 후 즉시 커밋 |
| BroadcastController try/catch 추가 | 낮음 | 안정성 향상 | emit 실패 시 로깅, 오프셋은 커밋 |
| Manual commit (`autoCommit: false`) | 중간 | 최대 제어 | persist + fanout 완료 후 수동 커밋 |

---

## 4. 다음 단계

- [08-architecture-decisions.md](./08-architecture-decisions.md) — Exactly-Once가 아닌 이유와 3가지 갭 상세 분석
