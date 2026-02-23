import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { KAFKA_TOPICS, MessagePersistedEvent, MessagePersistedEventSchema } from '@app/common';
import { ChatGateway } from './chat.gateway';

@Controller()
export class BroadcastController {
  private readonly logger = new Logger(BroadcastController.name);

  constructor(private readonly chatGateway: ChatGateway) {}

  @MessagePattern(KAFKA_TOPICS.MESSAGES_PERSISTED_V1)
  async handlePersistedMessage(
    @Payload() data: MessagePersistedEvent,
  ): Promise<void> {
    const parsed = MessagePersistedEventSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.error(`Invalid persisted event: ${JSON.stringify(parsed.error.issues)}`);
      return;
    }

    const event = parsed.data;
    this.logger.debug(`Broadcasting message ${event.messageId} to room ${event.roomId}`);

    this.chatGateway.server.to(event.roomId).emit('newMessage', {
      id: event.messageId,
      roomId: event.roomId,
      senderId: event.senderId,
      clientMsgId: event.clientMsgId,
      type: event.messageType,
      content: event.content,
      createdAt: event.createdAt,
    });
  }
}
