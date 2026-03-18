import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; findFirst: jest.Mock } };
  let jwtService: { sign: jest.Mock };
  let usersService: Partial<UsersService>;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    jwtService = { sign: jest.fn() };

    usersService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('validateUser', () => {
    it('ควรคืน user (ไม่รวม passwordHash) เมื่อ username/password ถูกต้อง', async () => {
      const mockUser = {
        id: 'u1',
        username: 'admin',
        passwordHash: 'hashed',
        role: 'OWNER',
        permissions: ['meter'],
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('admin', 'secret');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'admin' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith('secret', 'hashed');
      expect(result).toEqual({
        id: 'u1',
        username: 'admin',
        role: 'OWNER',
        permissions: ['meter'],
      });
      // @ts-expect-error passwordHash ควรถูกตัดออก
      expect(result.passwordHash).toBeUndefined();
    });

    it('ควรคืน null เมื่อ username ไม่พบ', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('unknown', 'secret');

      expect(result).toBeNull();
    });

    it('ควรคืน null เมื่อ password ไม่ถูกต้อง', async () => {
      const mockUser = {
        id: 'u1',
        username: 'admin',
        passwordHash: 'hashed',
        role: 'OWNER',
        permissions: ['meter'],
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('admin', 'wrong');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('ควรคืน access_token และ user เมื่อ credential ถูกต้อง', async () => {
      const user = {
        id: 'u1',
        username: 'admin',
        role: 'OWNER',
        permissions: ['meter'],
      };

      jest.spyOn(service, 'validateUser').mockResolvedValue(user as any);
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.login({
        username: 'admin',
        password: 'secret',
      });

      expect(service.validateUser).toHaveBeenCalledWith('admin', 'secret');
      expect(jwtService.sign).toHaveBeenCalledWith({
        username: 'admin',
        sub: 'u1',
        role: 'OWNER',
        permissions: ['meter'],
      });
      expect(result).toEqual({
        access_token: 'jwt-token',
        user,
      });
    });

    it('ควร throw UnauthorizedException เมื่อ credential ไม่ถูกต้อง', async () => {
      jest.spyOn(service, 'validateUser').mockResolvedValue(null);

      await expect(
        service.login({ username: 'admin', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('loginWithLine', () => {
    it('ควร login ด้วย lineUserId ได้เมื่อพบ user', async () => {
      const mockUser = {
        id: 'u2',
        username: 'lineuser',
        passwordHash: 'hashed',
        role: 'USER',
        permissions: [],
      };

      prisma.user.findFirst.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('jwt-line');

      const result = await service.loginWithLine('line-123');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { lineUserId: 'line-123' },
      });
      expect(jwtService.sign).toHaveBeenCalledWith({
        username: 'lineuser',
        sub: 'u2',
        role: 'USER',
        permissions: [],
      });
      expect(result).toEqual({
        access_token: 'jwt-line',
        user: {
          id: 'u2',
          username: 'lineuser',
          role: 'USER',
          permissions: [],
        },
      });
    });

    it('ควร throw UnauthorizedException เมื่อไม่พบ user จาก lineUserId', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.loginWithLine('not-found')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});

