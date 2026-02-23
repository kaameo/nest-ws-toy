import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '@app/db';

describe('AuthService', () => {
  let service: AuthService;
  const mockUserRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockJwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.create.mockReturnValue({ id: 'uuid-1', email: 'test@test.com', passwordHash: 'hashed' });
      mockUserRepository.save.mockResolvedValue({ id: 'uuid-1', email: 'test@test.com' });

      const result = await service.register({ email: 'test@test.com', password: 'password123' });
      expect(result).toEqual({ id: 'uuid-1', email: 'test@test.com' });
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { email: 'test@test.com' } });
    });

    it('should throw ConflictException if email exists', async () => {
      mockUserRepository.findOne.mockResolvedValue({ id: 'uuid-1', email: 'test@test.com' });
      await expect(service.register({ email: 'test@test.com', password: 'password123' }))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return access token for valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 10);
      mockUserRepository.findOne.mockResolvedValue({ id: 'uuid-1', email: 'test@test.com', passwordHash: hash });
      mockJwtService.sign.mockReturnValue('jwt-token');

      const result = await service.login({ email: 'test@test.com', password: 'password123' });
      expect(result).toEqual({ accessToken: 'jwt-token' });
    });

    it('should throw UnauthorizedException for invalid email', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.login({ email: 'no@test.com', password: 'pass' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('correct', 10);
      mockUserRepository.findOne.mockResolvedValue({ id: 'uuid-1', email: 'test@test.com', passwordHash: hash });
      await expect(service.login({ email: 'test@test.com', password: 'wrong' }))
        .rejects.toThrow(UnauthorizedException);
    });
  });
});
