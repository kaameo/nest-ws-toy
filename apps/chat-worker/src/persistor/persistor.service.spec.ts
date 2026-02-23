import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PersistorService } from './persistor.service';
import { FanoutService } from '../fanout/fanout.service';
import { Message, Room } from '@app/db';
import { MessageCreatedEvent } from '@app/common';

describe('PersistorService', () => {
  let service: PersistorService;
  const mockMessageRepo = {};
  const mockRoomRepo = {};
  const mockFanoutService = { publishPersisted: jest.fn() };

  const mockQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };

  const mockManager = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  const mockDataSource = {
    transaction: jest.fn((cb: (manager: typeof mockManager) => Promise<unknown>) => cb(mockManager)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersistorService,
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: getRepositoryToken(Room), useValue: mockRoomRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: FanoutService, useValue: mockFanoutService },
      ],
    }).compile();
    service = module.get<PersistorService>(PersistorService);
    jest.clearAllMocks();
    mockDataSource.transaction.mockImplementation(
      (cb: (manager: typeof mockManager) => Promise<unknown>) => cb(mockManager),
    );
    mockManager.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.insert.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.into.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.values.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.orIgnore.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.update.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.set.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);
  });

  const event: MessageCreatedEvent = {
    eventId: 'evt-1',
    roomId: 'room-1',
    senderId: 'user-1',
    clientMsgId: 'client-1',
    messageType: 'TEXT',
    content: 'Hello',
    producedAt: new Date().toISOString(),
  };

  it('should persist message and publish fanout event', async () => {
    mockQueryBuilder.execute
      .mockResolvedValueOnce({ raw: [{}], identifiers: [{ id: 'ulid-1' }] })
      .mockResolvedValueOnce({});

    const result = await service.persistMessage(event);
    expect(result.persisted).toBe(true);
    expect(mockFanoutService.publishPersisted).toHaveBeenCalled();
  });

  it('should skip fanout for duplicate messages', async () => {
    mockQueryBuilder.execute.mockResolvedValueOnce({ raw: [], identifiers: [] });

    const result = await service.persistMessage(event);
    expect(result.persisted).toBe(false);
    expect(mockFanoutService.publishPersisted).not.toHaveBeenCalled();
  });
});
