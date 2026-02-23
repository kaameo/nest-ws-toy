import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { KAFKA_TOPICS, MessagePersistedEvent } from '@app/common';

export const WORKER_KAFKA_PRODUCER = 'WORKER_KAFKA_PRODUCER';

@Injectable()
export class FanoutService implements OnModuleInit {
  private readonly logger = new Logger(FanoutService.name);

  constructor(
    @Inject(WORKER_KAFKA_PRODUCER)
    private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaClient.connect();
    this.logger.log('Fanout Kafka producer connected');
  }

  async publishPersisted(event: MessagePersistedEvent): Promise<void> {
    await lastValueFrom(
      this.kafkaClient.emit(KAFKA_TOPICS.MESSAGES_PERSISTED_V1, {
        key: event.roomId,
        value: JSON.stringify(event),
      }),
    );
    this.logger.debug(`Persisted event published for message ${event.messageId}`);
  }
}
