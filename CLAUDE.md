# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS monorepo implementing a real-time chat system with two-tier message processing: a **Gateway** (REST API + WebSocket) receives messages and publishes to Kafka, and a **Worker** consumes from Kafka, persists to PostgreSQL, then triggers broadcast back through the Gateway.

## Commands

```bash
# Infrastructure (must be running first)
docker compose up -d          # PostgreSQL 15, Redis 7, Kafka 3.7 (KRaft), Kafka UI

# Development
pnpm start:gateway:dev        # chat-gateway with --watch (port 3000)
pnpm start:worker:dev         # chat-worker with --watch (port 3001)

# Build
pnpm build                    # Build all apps
pnpm build:gateway            # Build chat-gateway only
pnpm build:worker             # Build chat-worker only

# Test
pnpm test                     # Run all tests (Jest)
pnpm test:watch               # Watch mode
pnpm test:cov                 # Coverage report
npx jest --testPathPattern=auth  # Run tests matching pattern
```

## Architecture

### Monorepo Structure

- **`apps/chat-gateway`** — HTTP API + Socket.IO WebSocket gateway. Modules: auth (JWT), rooms, messages, gateway, presence, kafka producer, health.
- **`apps/chat-worker`** — Kafka consumer. Modules: persistor (saves messages to DB), fanout (publishes persisted events).
- **`libs/common`** — Shared DTOs (`@app/common/dto`), Kafka event schemas (`@app/common/events`), utilities (ULID generator, pagination, Zod validation pipe).
- **`libs/db`** — TypeORM entities (User, Room, RoomMember, Message) and database module (`@app/db`).
- **`libs/redis`** — ioredis dynamic module (`@app/redis`).

### Message Flow

1. Client sends `sendMessage` via Socket.IO → Gateway publishes to Kafka topic `chat.messages.v1` → returns `messageAccepted` ACK
2. Worker consumes from Kafka → INSERTs to DB (idempotent via `UNIQUE(room_id, sender_id, client_msg_id)`) → publishes to `chat.messages.persisted.v1`
3. Gateway consumes persisted event → broadcasts `newMessage` to room members via Socket.IO

### Key Design Decisions

- **At-least-once delivery** with Kafka (`acks=all`, `idempotent=true`) + DB-level deduplication (`ON CONFLICT DO NOTHING`)
- **ULID primary keys** on messages for time-sortable cursor-based pagination
- **Presence tracking** via Redis TTL (60s) with 20s client heartbeat, keyed per socketId for multi-device support
- **Zod validation** for both DTOs and environment variables (app fails fast on missing env vars)
- **TypeORM** with `synchronize: true` (dev mode — no migrations yet)

### Path Aliases

Configured in `tsconfig.json`, used throughout:
- `@app/common` → `libs/common/src`
- `@app/db` → `libs/db/src`
- `@app/redis` → `libs/redis/src`

## Environment

All env vars defined in `.env`. Validated at startup via Zod. Key vars: `DB_*`, `REDIS_*`, `KAFKA_BROKERS`, `JWT_SECRET`, `PORT` (3000), `WORKER_PORT` (3001).
