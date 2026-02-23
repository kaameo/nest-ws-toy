import { Test, TestingModule } from '@nestjs/testing';
import { PresenceService } from './presence.service';
import { REDIS_CLIENT } from '@app/redis';

describe('PresenceService', () => {
  let service: PresenceService;
  const mockRedis = {
    hset: jest.fn(),
    hdel: jest.fn(),
    hlen: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    exists: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();
    service = module.get<PresenceService>(PresenceService);
    jest.clearAllMocks();
  });

  describe('setOnline', () => {
    it('should set presence hash with TTL', async () => {
      await service.setOnline('user-1', 'server-1', 'socket-1');
      expect(mockRedis.hset).toHaveBeenCalledWith(
        'presence:user:user-1',
        'socket-1',
        expect.any(String),
      );
      expect(mockRedis.expire).toHaveBeenCalledWith('presence:user:user-1', 60);
    });
  });

  describe('setOffline', () => {
    it('should remove socket and delete key if no remaining sockets', async () => {
      mockRedis.hlen.mockResolvedValue(0);
      await service.setOffline('user-1', 'socket-1');
      expect(mockRedis.hdel).toHaveBeenCalledWith('presence:user:user-1', 'socket-1');
      expect(mockRedis.del).toHaveBeenCalledWith('presence:user:user-1');
    });

    it('should only remove socket if other sockets remain', async () => {
      mockRedis.hlen.mockResolvedValue(1);
      await service.setOffline('user-1', 'socket-1');
      expect(mockRedis.hdel).toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('refreshTTL', () => {
    it('should refresh TTL to 60s', async () => {
      await service.refreshTTL('user-1');
      expect(mockRedis.expire).toHaveBeenCalledWith('presence:user:user-1', 60);
    });
  });

  describe('isOnline', () => {
    it('should return true if key exists', async () => {
      mockRedis.exists.mockResolvedValue(1);
      expect(await service.isOnline('user-1')).toBe(true);
    });

    it('should return false if key does not exist', async () => {
      mockRedis.exists.mockResolvedValue(0);
      expect(await service.isOnline('user-1')).toBe(false);
    });
  });
});
