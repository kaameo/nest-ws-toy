import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from '@app/common';
import { DbModule } from '@app/db';
import { RedisModule } from '@app/redis';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { GatewayModule } from './gateway/gateway.module';
import { MessagesModule } from './messages/messages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    DbModule,
    RedisModule.forRoot(),
    HealthModule,
    AuthModule,
    RoomsModule,
    GatewayModule,
    MessagesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
