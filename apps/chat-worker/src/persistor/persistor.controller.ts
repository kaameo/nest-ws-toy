import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, KafkaContext } from '@nestjs/microservices';
import { KAFKA_TOPICS, MessageCreatedEvent, MessageCreatedEventSchema } from '@app/common';
import { PersistorService } from './persistor.service';

@Controller()
export class PersistorController {
  private readonly logger = new Logger(PersistorController.name);

  constructor(private readonly persistorService: PersistorService) {}

  @MessagePattern(KAFKA_TOPICS.MESSAGES_V1)
  async handleMessage(
    @Payload() data: MessageCreatedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const parsed = MessageCreatedEventSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.error(`Invalid message event: ${JSON.stringify(parsed.error.issues)}`);
      return;
    }

    const event = parsed.data;
    this.logger.debug(`Processing message: clientMsgId=${event.clientMsgId}`);

    try {
      await this.persistorService.persistMessage(event);
    } catch (error) {
      this.logger.error(`Failed to persist message: ${error}`);
      throw error; // rethrow to prevent offset commit
    }
  }
}
