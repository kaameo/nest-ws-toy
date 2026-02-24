import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { RoomsService } from '../rooms/rooms.service';
import { Message } from '@app/db';

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

  const mockRoomsService = {
    isMember: jest.fn(),
    updateReadCursor: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: RoomsService, useValue: mockRoomsService },
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
      mockRoomsService.isMember.mockResolvedValue(true);
      const msgs = [{ id: '1', content: 'hi' }];
      mockQb.getMany.mockResolvedValue(msgs);

      const result = await service.getMessages('r1', 'u1', { limit: 50 });
      expect(result).toEqual(msgs);
    });

    it('should throw ForbiddenException for non-members', async () => {
      mockRoomsService.isMember.mockResolvedValue(false);
      await expect(service.getMessages('r1', 'u2', { limit: 50 })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateReadCursor', () => {
    it('should update read cursor for member', async () => {
      mockRoomsService.isMember.mockResolvedValue(true);
      await service.updateReadCursor('r1', 'u1', 'msg-1');
      expect(mockRoomsService.updateReadCursor).toHaveBeenCalledWith('r1', 'u1', 'msg-1');
    });

    it('should throw ForbiddenException for non-members', async () => {
      mockRoomsService.isMember.mockResolvedValue(false);
      await expect(service.updateReadCursor('r1', 'u2', 'msg-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
