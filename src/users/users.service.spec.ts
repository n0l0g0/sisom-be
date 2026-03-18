import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('bcrypt');
jest.mock('../activity/logger', () => ({
  appendLog: jest.fn(),
  readDeletedStore: jest.fn().mockReturnValue({}),
  softDeleteRecord: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('create', () => {
    it('ควรสร้าง user ใหม่ พร้อม hash password และ normalize field', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pass');

      const dto = {
        username: '  admin  ',
        passwordHash: 'plain',
        phone: ' 0812345678 ',
        lineUserId: '  line-uid  ',
        role: 'OWNER',
        permissions: ['meter'],
      } as any;

      const created = {
        id: 'u1',
        username: 'admin',
        phone: '0812345678',
        lineUserId: 'line-uid',
        role: 'OWNER',
        permissions: ['meter'],
      } as any;

      prisma.user.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith('plain', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'admin',
          phone: '0812345678',
          lineUserId: 'line-uid',
        }),
      });
      expect(result).toBe(created);
    });
  });

  describe('findAll', () => {
    it('ควรคืน users ที่ไม่ได้ถูก soft delete', async () => {
      const { readDeletedStore } = jest.requireMock('../activity/logger') as {
        readDeletedStore: jest.Mock;
      };
      readDeletedStore.mockReturnValue({
        User: { ids: ['u2'] },
      });

      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', username: 'a' },
        { id: 'u2', username: 'b' },
      ]);

      const result = await service.findAll();

      expect(result).toEqual([{ id: 'u1', username: 'a' }]);
    });
  });

  describe('update', () => {
    it('ควร hash password ใหม่เมื่อมีการส่ง passwordHash มา', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-new');

      prisma.user.update.mockResolvedValue({
        id: 'u1',
        username: 'admin',
      });

      const dto = {
        passwordHash: 'newpass',
      } as any;

      const result = await service.update('u1', dto);

      expect(bcrypt.hash).toHaveBeenCalledWith('newpass', 10);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          passwordHash: 'hashed-new',
        }),
      });
      expect(result).toEqual({
        id: 'u1',
        username: 'admin',
      });
    });
  });
});

