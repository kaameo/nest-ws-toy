import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KAFKA_CLIENT_ID } from '@app/common';
import { FanoutService, WORKER_KAFKA_PRODUCER } from './fanout.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: WORKER_KAFKA_PRODUCER,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: `${KAFKA_CLIENT_ID}-fanout`,
              brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
            },
            producer: {
              allowAutoTopicCreation: true,
              idempotent: true,
            },
            producerOnlyMode: true,
          },
        }),
      },
    ]),
  ],
  providers: [FanoutService],
  exports: [FanoutService],
})
export class FanoutModule {}
