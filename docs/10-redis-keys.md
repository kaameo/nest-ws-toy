# 10. Valkey(Redis) 키 구조

Valkey에 저장되는 모든 키를 정리한 문서.

## 키 요약

| 키 패턴 | 자료형 | TTL | 용도 | 소스 |
|---------|--------|-----|------|------|
| `presence:user:{userId}` | Hash | 60초 | 접속 상태 추적 (멀티 디바이스) | `presence.service.ts` |
| `membership:{roomId}:{userId}` | String | 30초 | 방 멤버십 캐시 | `rooms.service.ts` |

---

## 1. Presence (접속 상태)

### 키 형식
```
presence:user:{userId}
```

### 자료형: Hash
- **field**: `socketId`
- **value**: JSON 문자열

### TTL: 60초 (클라이언트 20초 주기 하트비트로 갱신)

### 동작

| 이벤트 | 명령 | 설명 |
|--------|------|------|
| 소켓 연결 | `HSET` + `EXPIRE 60` | 소켓 ID를 필드로 추가 |
| 하트비트 | `HSET` + `EXPIRE 60` | TTL 갱신 + 타임스탬프 업데이트 |
| 소켓 해제 | `HDEL` | 해당 소켓 필드 제거 |
| 마지막 소켓 해제 | `DEL` | 키 자체 삭제 (완전 오프라인) |
| 온라인 확인 | `EXISTS` | 키 존재 여부로 판단 |

### 저장 예시

```bash
# 유저 abc-123이 소켓 2개로 접속 중
> HGETALL presence:user:abc-123
1) "socket-id-aaa"
2) "{\"serverId\":\"gateway-1\",\"connectedAt\":\"2026-02-25T10:00:00.000Z\"}"
3) "socket-id-bbb"
4) "{\"serverId\":\"gateway-1\",\"connectedAt\":\"2026-02-25T10:05:00.000Z\"}"

> TTL presence:user:abc-123
(integer) 58

# 하트비트 후 값이 refreshedAt으로 변경
> HGET presence:user:abc-123 socket-id-aaa
"{\"refreshedAt\":\"2026-02-25T10:00:20.000Z\"}"
```

### 설계 포인트
- **멀티 디바이스 지원**: Hash 필드가 socketId이므로 한 유저가 여러 소켓으로 접속 가능
- **자동 만료**: TTL 60초, 하트비트 없으면 자동 오프라인 처리
- **완전 오프라인 감지**: 마지막 소켓 `HDEL` 후 `HLEN`이 0이면 키 삭제

---

## 2. Membership Cache (방 멤버십 캐시)

### 키 형식
```
membership:{roomId}:{userId}
```

### 자료형: String (`"1"` 또는 `"0"`)

### TTL: 30초

### 동작

| 이벤트 | 명령 | 설명 |
|--------|------|------|
| 멤버십 조회 (캐시 미스) | `GET` → DB 조회 → `SET EX 30` | DB 결과를 캐싱 |
| 멤버십 조회 (캐시 히트) | `GET` | `"1"`이면 멤버, `"0"`이면 비멤버 |
| 방 참가 | `DEL` | 캐시 무효화 (다음 조회 시 DB에서 갱신) |

### 저장 예시

```bash
# 유저 abc-123이 방 room-456의 멤버인 경우
> GET membership:room-456:abc-123
"1"

> TTL membership:room-456:abc-123
(integer) 27

# 멤버가 아닌 경우
> GET membership:room-789:abc-123
"0"

# 방 참가 시 캐시 무효화
> DEL membership:room-456:abc-123
(integer) 1
```

### 설계 포인트
- **네거티브 캐싱**: 비멤버도 `"0"`으로 캐싱하여 DB 조회 방지
- **짧은 TTL (30초)**: 멤버십 변경이 빠르게 반영됨
- **참가 시 무효화**: `join()` 호출 시 `DEL`로 즉시 캐시 제거
