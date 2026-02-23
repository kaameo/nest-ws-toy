import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { Message, RoomMember } from '@app/db';

describe('MessagesService', () => {
  let service: MessagesService;

  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  const mockMessageRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  const mockMemberRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: getRepositoryToken(RoomMember), useValue: mockMemberRepo },
      ],
    }).compile();
    service = module.get<MessagesService>(MessagesService);
    jest.clearAllMocks();
    mockMessageRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.where.mockReturnValue(mockQb);
    mockQb.andWhere.mockReturnValue(mockQb);
    mockQb.orderBy.mockReturnValue(mockQb);
    mockQb.limit.mockReturnValue(mockQb);
  });

  describe('getMessages', () => {
    it('should return messages for a member', async () => {
      mockMemberRepo.findOne.mockResolvedValue({ roomId: 'r1', userId: 'u1' });
      const msgs = [{ id: '1', content: 'hi' }];
      mockQb.getMany.mockResolvedValue(msgs);

      const result = await service.getMessages('r1', 'u1', { limit: 50 });
      expect(result).toEqual(msgs);
    });

    it('should throw ForbiddenException for non-members', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(service.getMessages('r1', 'u2', { limit: 50 })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateReadCursor', () => {
    it('should update read cursor for member', async () => {
      mockMemberRepo.findOne.mockResolvedValue({ roomId: 'r1', userId: 'u1' });
      await service.updateReadCursor('r1', 'u1', 'msg-1');
      expect(mockMemberRepo.update).toHaveBeenCalledWith(
        { roomId: 'r1', userId: 'u1' },
        { lastReadMessageId: 'msg-1' },
      );
    });

    it('should throw ForbiddenException for non-members', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(service.updateReadCursor('r1', 'u2', 'msg-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
