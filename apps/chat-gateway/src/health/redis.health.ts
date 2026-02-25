import { Injectable, Inject } from '@nestjs/common';
import {
  HealthIndicatorService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@app/redis';

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
        return indicator.up();
      }
      return indicator.down({ message: 'Redis ping failed' });
    } catch (error) {
      return indicator.down({ message: 'Redis not available' });
    }
  }
}
