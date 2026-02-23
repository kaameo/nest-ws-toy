import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { KAFKA_CLIENT_ID } from '@app/common';
import { KafkaProducerService } from './kafka-producer.service';

export const KAFKA_PRODUCER = 'KAFKA_PRODUCER';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: KAFKA_PRODUCER,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: KAFKA_CLIENT_ID,
              brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
            },
            producer: {
              allowAutoTopicCreation: true,
              idempotent: true, // Forces acks=-1 (all) automatically
            },
            producerOnlyMode: true,
          },
        }),
      },
    ]),
  ],
  providers: [KafkaProducerService],
  exports: [KafkaProducerService],
})
export class KafkaProducerModule {}
