import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { BroadcastController } from './broadcast.controller';
import { PresenceModule } from '../presence/presence.module';
import { RoomsModule } from '../rooms/rooms.module';
import { KafkaProducerModule } from '../kafka/kafka-producer.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    PresenceModule,
    RoomsModule,
    KafkaProducerModule,
  ],
  controllers: [BroadcastController],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class GatewayModule {}
