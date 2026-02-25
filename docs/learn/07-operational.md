# Phase 7: 운영 — Health Check, Docker, 인프라

## 학습 목표

- `@nestjs/terminus`로 헬스체크 엔드포인트를 구현하는 방법을 익힌다
- `HealthIndicator`를 상속해 커스텀 헬스 지표를 만드는 방법을 배운다
- Docker Compose로 개발 환경 인프라 전체를 구성하는 방법을 이해한다
- Kafka KRaft 모드와 토픽 초기화 패턴을 안다

## 읽을 파일 목록

33. `apps/chat-gateway/src/health/health.controller.ts`
34. `apps/chat-gateway/src/health/redis.health.ts`
35. `docker-compose.yml`

---

## 33. `apps/chat-gateway/src/health/health.controller.ts` — Terminus 헬스체크

### 핵심 코드

```typescript
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,   // 커스텀 지표
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),     // TypeORM DB 연결 확인
      () => this.redis.isHealthy('redis'),     // Redis PING 확인
    ]);
  }
}
```

### NestJS 개념: Terminus 헬스체크

`@nestjs/terminus`는 K8s, Docker의 `livenessProbe`/`readinessProbe`와 연동되는 헬스체크 엔드포인트를 제공합니다.

**응답 형식:**

```json
// 모두 정상 — HTTP 200
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  }
}

// 일부 실패 — HTTP 503
{
  "status": "error",
  "info": { "database": { "status": "up" } },
  "error": { "redis": { "status": "down", "message": "Redis not available" } },
  "details": { ... }
}
```

**`@HealthCheck()` 데코레이터:**
- `health.check()` 배열의 각 지표를 병렬로 실행합니다
- 하나라도 실패하면 HTTP 503을 반환합니다
- 각 지표 함수는 `() => indicator.method(key)` 형태의 팩토리 함수입니다

**내장 헬스 지표:**
| 지표 클래스 | 확인 대상 |
|------------|-----------|
| `TypeOrmHealthIndicator` | PostgreSQL (TypeORM) |
| `HttpHealthIndicator` | 외부 HTTP 엔드포인트 |
| `MicroserviceHealthIndicator` | NestJS 마이크로서비스 |
| `MemoryHealthIndicator` | 메모리 사용량 |
| `DiskHealthIndicator` | 디스크 사용량 |

---

## 34. `apps/chat-gateway/src/health/redis.health.ts` — 커스텀 HealthIndicator

### 핵심 코드

```typescript
@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const result = await this.redis.ping();
      if (result === 'PONG') {
        return indicator.up();                              // { redis: { status: 'up' } }
      }
      return indicator.down({ message: 'Redis ping failed' });
    } catch (error) {
      return indicator.down({ message: 'Redis not available' });
    }
  }
}
```

### NestJS 개념: 커스텀 HealthIndicator (Terminus v9+)

`terminus`에는 Redis용 내장 지표가 없으므로 직접 구현합니다.

**Terminus v9+ API — `HealthIndicatorService` 주입 방식:**

Terminus v9부터는 `HealthIndicator`를 상속하는 대신 `HealthIndicatorService`를 주입받아 사용합니다.

```typescript
// 구버전 (v8 이하) — 상속 방식
export class RedisHealthIndicator extends HealthIndicator {
  constructor(...) { super(); }
  async isHealthy(key: string) {
    return this.getStatus(key, true);  // 또는 throw new HealthCheckError(...)
  }
}

// 신버전 (v9+) — 주입 방식 (이 프로젝트)
export class RedisHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}
  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    return indicator.up();   // 또는 indicator.down({ message: '...' })
  }
}
```

**`indicator.up()` / `indicator.down()`:**
- `up()`: `{ [key]: { status: 'up' } }` 객체 반환
- `down(data)`: `{ [key]: { status: 'down', ...data } }` 객체 반환 (예외를 던지지 않음)

**왜 `this.redis.ping()`이 'PONG'을 반환하는가?**
- Redis의 `PING` 명령은 서버가 응답 가능하면 `PONG`을 반환합니다
- ioredis의 `ping()` 메서드는 이 명령을 래핑합니다

---

## 35. `docker-compose.yml` — 개발 환경 인프라 스택

### 핵심 코드: 전체 서비스 구성

```yaml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: chat
      POSTGRES_PASSWORD: chat1234
      POSTGRES_DB: chat
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chat"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: valkey/valkey:8-alpine    # Redis 호환 오픈소스 포크
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  kafka:
    image: apache/kafka:3.7.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller    # KRaft 모드 (ZooKeeper 불필요)
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093,EXTERNAL://0.0.0.0:29092
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,EXTERNAL://localhost:29092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
      KAFKA_LOG_DIRS: /tmp/kraft-combined-logs
      CLUSTER_ID: "MkU3OEVBNTcwNTJENDM2Qk"
    ports:
      - "29092:29092"
    healthcheck:
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s

  kafka-init:                        # 토픽 사전 생성 컨테이너 (일회성)
    image: apache/kafka:3.7.0
    depends_on:
      kafka:
        condition: service_healthy
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic chat.messages.v1 --partitions 3 --replication-factor 1
        /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic chat.messages.persisted.v1 --partitions 3 --replication-factor 1
        echo "Kafka topics created successfully"

  kafka-ui:                          # Kafka 관리 UI (포트 8080)
    image: provectuslabs/kafka-ui:latest
    depends_on:
      kafka:
        condition: service_healthy
    environment:
      KAFKA_CLUSTERS_0_NAME: local
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
    ports:
      - "8080:8080"
```

### 개념: Kafka KRaft 모드

기존 Kafka는 ZooKeeper가 필요했지만, Kafka 3.x의 KRaft(Kafka Raft) 모드는 ZooKeeper 없이 동작합니다.

```yaml
KAFKA_PROCESS_ROLES: broker,controller
# 하나의 컨테이너가 브로커(메시지 처리)와
# 컨트롤러(메타데이터 관리) 역할을 동시에 수행
```

**리스너 구성:**
```yaml
KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,EXTERNAL://0.0.0.0:29092
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,EXTERNAL://localhost:29092
```

| 리스너 | 주소 | 용도 |
|--------|------|------|
| `PLAINTEXT://kafka:9092` | 컨테이너 내부 | Docker 컨테이너끼리 통신 |
| `EXTERNAL://localhost:29092` | 호스트 머신 | 로컬 개발 시 직접 접근 |

**`kafka-init` 패턴:**
```yaml
kafka-init:
  depends_on:
    kafka:
      condition: service_healthy   # Kafka가 완전히 뜬 후 실행
  entrypoint: ["/bin/sh", "-c"]
  command:
    - |
      /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic chat.messages.v1 --partitions 3 --replication-factor 1
      /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic chat.messages.persisted.v1 --partitions 3 --replication-factor 1
```

`KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"`로 자동 생성도 가능하지만, `kafka-init`으로 파티션 수를 명시적으로 3으로 설정합니다. 파티션이 많을수록 병렬 처리가 가능합니다.

### 개념: Valkey (Redis 대체재)

```yaml
image: valkey/valkey:8-alpine
```

**Valkey**는 2024년 Redis의 라이선스 변경 후 Linux Foundation이 주도하는 Redis 7.x 포크입니다.
- Redis API와 완전 호환 (ioredis, 기존 Redis 클라이언트 그대로 사용)
- BSL이 아닌 BSD 3-Clause 라이선스

### 개념: healthcheck와 depends_on

```yaml
kafka-init:
  depends_on:
    kafka:
      condition: service_healthy   # healthcheck가 통과할 때까지 대기
```

`condition: service_healthy`는 `healthcheck`가 성공할 때까지 해당 서비스의 시작을 지연합니다. 단순 `depends_on: [kafka]`는 컨테이너가 시작됐을 뿐 준비됐다는 보장이 없습니다.

---

## 개발 환경 포트 매핑

| 서비스 | 포트 | 접속 URL |
|--------|------|---------|
| chat-gateway | 3000 | http://localhost:3000 |
| chat-worker | 3001 | http://localhost:3001 |
| PostgreSQL | 5432 | postgresql://chat:chat1234@localhost:5432/chat |
| Redis/Valkey | 6379 | redis://localhost:6379 |
| Kafka | 29092 | localhost:29092 |
| Kafka UI | 8080 | http://localhost:8080 |

## 다음 단계

[아키텍처 결정 사항 →](./08-architecture-decisions.md)

이 프로젝트에서 내린 주요 설계 결정과 그 이유, 트레이드오프를 분석합니다.
