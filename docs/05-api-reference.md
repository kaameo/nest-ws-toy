# API Reference

## 인증 (Auth)

### POST /auth/register

회원가입

**Request Body** (Zod: `RegisterSchema`):

```json
{
  "email": "user@example.com",
  "password": "123456"   // min 6, max 100
}
```

**Response** `201`:

```json
{
  "id": "uuid",
  "email": "user@example.com"
}
```

### POST /auth/login

로그인

**Request Body** (Zod: `LoginSchema`):

```json
{
  "email": "user@example.com",
  "password": "123456"
}
```

**Response** `200`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

## 방 (Rooms) — `Authorization: Bearer {token}` 필요

### POST /rooms

방 생성 (생성자 자동 참가)

**Request Body** (Zod: `CreateRoomSchema`):

```json
{
  "name": "방 이름"   // min 1, max 100
}
```

**Response** `201`:

```json
{
  "id": "uuid",
  "name": "방 이름",
  "createdAt": "2026-02-24T06:00:00.000Z"
}
```

### POST /rooms/:roomId/join

방 참가

**Response** `201`:

```json
{
  "roomId": "uuid",
  "userId": "uuid",
  "joinedAt": "2026-02-24T06:00:00.000Z"
}
```

### GET /rooms

내가 참가한 방 목록

**Response** `200`:

```json
[
  {
    "id": "uuid",
    "name": "방 이름",
    "createdAt": "...",
    "lastMessageId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "lastMessageAt": "..."
  }
]
```

### GET /rooms/:roomId/members

방 멤버 목록

**Response** `200`:

```json
[
  {
    "roomId": "uuid",
    "userId": "uuid",
    "joinedAt": "...",
    "lastReadMessageId": null
  }
]
```

---

## 메시지 (Messages) — `Authorization: Bearer {token}` 필요

### GET /rooms/:roomId/messages

메시지 조회 (커서 기반 페이지네이션)

**Query Params** (Zod: `MessageQuerySchema`):

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `limit` | number (1-100) | 50 | 조회 개수 |
| `before` | string (ULID) | - | 이 메시지 이전 조회 (과거 방향) |
| `after` | string (ULID) | - | 이 메시지 이후 조회 (최신 방향) |

**Response** `200`:

```json
[
  {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "roomId": "uuid",
    "senderId": "uuid",
    "clientMsgId": "uuid",
    "type": "TEXT",
    "content": "안녕하세요",
    "createdAt": "2026-02-24T06:00:00.000Z"
  }
]
```

### POST /rooms/:roomId/read

읽음 커서 업데이트

**Request Body** (Zod: `UpdateReadCursorSchema`):

```json
{
  "lastReadMessageId": "01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

**Response** `200`: 업데이트된 RoomMember 객체

---

## 헬스체크

### GET /health

DB + Redis 상태 확인

**Response** `200`:

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```
