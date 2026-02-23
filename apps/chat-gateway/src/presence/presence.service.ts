import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@app/redis';

const PRESENCE_TTL = 60; // seconds
const PRESENCE_KEY_PREFIX = 'presence:user:';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async setOnline(userId: string, serverId: string, socketId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    await this.redis.hset(key, socketId, JSON.stringify({ serverId, connectedAt: new Date().toISOString() }));
    await this.redis.expire(key, PRESENCE_TTL);
    this.logger.debug(`User ${userId} online (socket: ${socketId})`);
  }

  async setOffline(userId: string, socketId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    await this.redis.hdel(key, socketId);
    const remaining = await this.redis.hlen(key);
    if (remaining === 0) {
      await this.redis.del(key);
      this.logger.debug(`User ${userId} fully offline`);
    } else {
      this.logger.debug(`User ${userId} socket ${socketId} removed, ${remaining} remaining`);
    }
  }

  async refreshTTL(userId: string): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    await this.redis.expire(key, PRESENCE_TTL);
  }

  async isOnline(userId: string): Promise<boolean> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
}
