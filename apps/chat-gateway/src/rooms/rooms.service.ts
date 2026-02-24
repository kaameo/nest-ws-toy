import { Injectable, Inject, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Room, RoomMember } from '@app/db';
import { CreateRoomDto } from '@app/common';
import { REDIS_CLIENT } from '@app/redis';

const MEMBER_CACHE_TTL = 30; // seconds
const MEMBER_CACHE_PREFIX = 'membership:';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(RoomMember)
    private readonly memberRepository: Repository<RoomMember>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async create(dto: CreateRoomDto, userId: string): Promise<Room> {
    const room = this.roomRepository.create({ name: dto.name });
    const saved = await this.roomRepository.save(room);

    const member = this.memberRepository.create({
      roomId: saved.id,
      userId,
    });
    await this.memberRepository.save(member);

    this.logger.log(`Room created: ${saved.id} by user ${userId}`);
    return saved;
  }

  async join(roomId: string, userId: string): Promise<RoomMember> {
    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const existing = await this.memberRepository.findOne({
      where: { roomId, userId },
    });
    if (existing) {
      throw new ConflictException('Already a member of this room');
    }

    const member = this.memberRepository.create({ roomId, userId });
    const saved = await this.memberRepository.save(member);
    await this.redis.del(`${MEMBER_CACHE_PREFIX}${roomId}:${userId}`);
    return saved;
  }

  async findMyRooms(userId: string): Promise<Room[]> {
    const members = await this.memberRepository.find({
      where: { userId },
    });
    if (members.length === 0) return [];

    const roomIds = members.map((m) => m.roomId);
    return this.roomRepository
      .createQueryBuilder('room')
      .whereInIds(roomIds)
      .orderBy('room.created_at', 'DESC')
      .getMany();
  }

  async findMembers(roomId: string): Promise<RoomMember[]> {
    return this.memberRepository.find({ where: { roomId } });
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    const cacheKey = `${MEMBER_CACHE_PREFIX}${roomId}:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      return cached === '1';
    }

    const member = await this.memberRepository.findOne({
      where: { roomId, userId },
    });
    const result = member !== null;
    await this.redis.set(cacheKey, result ? '1' : '0', 'EX', MEMBER_CACHE_TTL);
    return result;
  }

  async updateReadCursor(
    roomId: string,
    userId: string,
    lastReadMessageId: string,
  ): Promise<void> {
    await this.memberRepository.update(
      { roomId, userId },
      { lastReadMessageId },
    );
    this.logger.debug(`Read cursor updated: user=${userId} room=${roomId} cursor=${lastReadMessageId}`);
  }
}
