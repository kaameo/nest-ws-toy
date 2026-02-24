import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { Room, RoomMember } from '@app/db';
import { REDIS_CLIENT } from '@app/redis';

describe('RoomsService', () => {
  let service: RoomsService;
  const mockRoomRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockMemberRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: getRepositoryToken(Room), useValue: mockRoomRepo },
        { provide: getRepositoryToken(RoomMember), useValue: mockMemberRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    service = module.get<RoomsService>(RoomsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a room and add creator as member', async () => {
      const room = { id: 'room-1', name: 'Test Room' };
      mockRoomRepo.create.mockReturnValue(room);
      mockRoomRepo.save.mockResolvedValue(room);
      mockMemberRepo.create.mockReturnValue({ roomId: 'room-1', userId: 'user-1' });
      mockMemberRepo.save.mockResolvedValue({ roomId: 'room-1', userId: 'user-1' });

      const result = await service.create({ name: 'Test Room' }, 'user-1');
      expect(result).toEqual(room);
      expect(mockMemberRepo.save).toHaveBeenCalled();
    });
  });

  describe('join', () => {
    it('should add user to room', async () => {
      mockRoomRepo.findOne.mockResolvedValue({ id: 'room-1' });
      mockMemberRepo.findOne.mockResolvedValue(null);
      mockMemberRepo.create.mockReturnValue({ roomId: 'room-1', userId: 'user-2' });
      mockMemberRepo.save.mockResolvedValue({ roomId: 'room-1', userId: 'user-2' });

      const result = await service.join('room-1', 'user-2');
      expect(result.roomId).toBe('room-1');
    });

    it('should throw NotFoundException if room does not exist', async () => {
      mockRoomRepo.findOne.mockResolvedValue(null);
      await expect(service.join('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already a member', async () => {
      mockRoomRepo.findOne.mockResolvedValue({ id: 'room-1' });
      mockMemberRepo.findOne.mockResolvedValue({ roomId: 'room-1', userId: 'user-1' });
      await expect(service.join('room-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('isMember', () => {
    it('should return true if user is member (cache miss)', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockMemberRepo.findOne.mockResolvedValue({ roomId: 'room-1', userId: 'user-1' });
      mockRedis.set.mockResolvedValue('OK');
      expect(await service.isMember('room-1', 'user-1')).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith('membership:room-1:user-1', '1', 'EX', 30);
    });

    it('should return cached result on cache hit', async () => {
      mockRedis.get.mockResolvedValue('1');
      expect(await service.isMember('room-1', 'user-1')).toBe(true);
      expect(mockMemberRepo.findOne).not.toHaveBeenCalled();
    });

    it('should return false if user is not member', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockMemberRepo.findOne.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');
      expect(await service.isMember('room-1', 'user-2')).toBe(false);
      expect(mockRedis.set).toHaveBeenCalledWith('membership:room-1:user-2', '0', 'EX', 30);
    });
  });
});
