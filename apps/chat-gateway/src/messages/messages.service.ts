import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, RoomMember } from '@app/db';
import { MessageQueryDto, MessageResponse } from '@app/common';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(RoomMember)
    private readonly memberRepository: Repository<RoomMember>,
  ) {}

  async getMessages(
    roomId: string,
    userId: string,
    query: MessageQueryDto,
  ): Promise<MessageResponse[]> {
    const isMember = await this.isMember(roomId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this room');
    }

    const qb = this.messageRepository
      .createQueryBuilder('msg')
      .where('msg.room_id = :roomId', { roomId });

    if (query.before) {
      qb.andWhere('msg.id < :before', { before: query.before });
    }

    if (query.after) {
      qb.andWhere('msg.id > :after', { after: query.after });
    }

    if (query.before) {
      qb.orderBy('msg.id', 'DESC');
    } else {
      qb.orderBy('msg.id', 'ASC');
    }

    qb.limit(query.limit);

    const messages = await qb.getMany();

    // If we queried with before (descending), reverse to chronological order
    if (query.before) {
      messages.reverse();
    }

    return messages;
  }

  async updateReadCursor(
    roomId: string,
    userId: string,
    lastReadMessageId: string,
  ): Promise<void> {
    const isMember = await this.isMember(roomId, userId);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this room');
    }

    await this.memberRepository.update(
      { roomId, userId },
      { lastReadMessageId },
    );

    this.logger.debug(`Read cursor updated: user=${userId} room=${roomId} cursor=${lastReadMessageId}`);
  }

  private async isMember(roomId: string, userId: string): Promise<boolean> {
    const member = await this.memberRepository.findOne({
      where: { roomId, userId },
    });
    return member !== null;
  }
}
