import { DynamicModule, Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({})
export class RedisModule {
  static forRoot(): DynamicModule {
    return {
      module: RedisModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: REDIS_CLIENT,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            return new Redis({
              host: config.getOrThrow('REDIS_HOST'),
              port: config.getOrThrow<number>('REDIS_PORT'),
              lazyConnect: true,
            });
          },
        },
      ],
      exports: [REDIS_CLIENT],
    };
  }
}
