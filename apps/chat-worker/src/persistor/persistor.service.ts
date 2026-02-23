import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Message, Room } from '@app/db';
import { MessageCreatedEvent, MessagePersistedEvent, generateUlid } from '@app/common';
import { FanoutService } from '../fanout/fanout.service';

@Injectable()
export class PersistorService {
  private readonly logger = new Logger(PersistorService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    private readonly dataSource: DataSource,
    private readonly fanoutService: FanoutService,
  ) {}

  async persistMessage(event: MessageCreatedEvent): Promise<{ persisted: boolean; messageId: string }> {
    const messageId = generateUlid();

    const result = await this.dataSource.transaction(async (manager) => {
      const insertResult = await manager
        .createQueryBuilder()
        .insert()
        .into(Message)
        .values({
          id: messageId,
          roomId: event.roomId,
          senderId: event.senderId,
          clientMsgId: event.clientMsgId,
          type: event.messageType,
          content: event.content,
        })
        .orIgnore()
        .execute();

      if (insertResult.raw.length === 0 || insertResult.identifiers.length === 0) {
        this.logger.debug(`Duplicate message ignored: clientMsgId=${event.clientMsgId}`);
        return { persisted: false, messageId };
      }

      await manager
        .createQueryBuilder()
        .update(Room)
        .set({
          lastMessageId: messageId,
          lastMessageAt: new Date(),
        })
        .where('id = :roomId', { roomId: event.roomId })
        .execute();

      this.logger.log(`Message persisted: ${messageId} in room ${event.roomId}`);
      return { persisted: true, messageId };
    });

    if (result.persisted) {
      const persistedEvent: MessagePersistedEvent = {
        messageId: result.messageId,
        roomId: event.roomId,
        senderId: event.senderId,
        clientMsgId: event.clientMsgId,
        messageType: event.messageType,
        content: event.content,
        createdAt: new Date().toISOString(),
      };
      await this.fanoutService.publishPersisted(persistedEvent);
    }

    return result;
  }
}
