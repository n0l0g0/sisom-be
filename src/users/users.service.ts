import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const { passwordHash, ...rest } = createUserDto;
    const normalized: Omit<CreateUserDto, 'passwordHash'> = {
      ...rest,
      username: rest.username.trim(),
      phone: rest.phone?.trim() || undefined,
      lineUserId:
        typeof rest.lineUserId === 'string' &&
        rest.lineUserId.trim().length > 0
          ? rest.lineUserId.trim()
          : undefined,
    };
    const hashedPassword = await bcrypt.hash(passwordHash, 10);

    const gen = () => String(Math.floor(100000 + Math.random() * 900000));
    const initialVerify =
      !normalized.lineUserId && normalized.phone
        ? normalized.verifyCode && /^\d{6}$/.test(normalized.verifyCode)
          ? normalized.verifyCode
          : gen()
        : undefined;

    try {
      return await this.prisma.user.create({
        data: {
          ...normalized,
          verifyCode: initialVerify,
          passwordHash: hashedPassword,
          permissions: createUserDto.permissions as Prisma.InputJsonValue,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = Array.isArray(e.meta?.target)
          ? (e.meta?.target as string[])[0]
          : (e.meta?.target as string | undefined);
        if (target === 'lineUserId') {
          throw new BadRequestException('LINE User ID นี้ถูกใช้แล้วกับผู้ใช้งานอื่น');
        }
        if (target === 'username') {
          throw new BadRequestException('ชื่อผู้ใช้งานนี้ถูกใช้แล้ว');
        }
        if (target === 'phone') {
          throw new BadRequestException('เบอร์โทรศัพท์นี้ถูกใช้แล้ว');
        }
      }
      throw e;
    }
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        phone: true,
        lineUserId: true,
        verifyCode: true,
        role: true,
        permissions: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const { passwordHash, permissions, ...rest } = updateUserDto;

    const data: Prisma.UserUpdateInput = { ...rest };

    const gen = () => String(Math.floor(100000 + Math.random() * 900000));
    if (rest.verifyCode === 'GENERATE') {
      data.verifyCode = gen();
    }
    if (typeof rest.lineUserId === 'string' && rest.lineUserId.length > 0) {
      data.verifyCode = null;
    } else if (!rest.lineUserId && rest.phone && !rest.verifyCode) {
      data.verifyCode = gen();
    }

    if (passwordHash) {
      data.passwordHash = await bcrypt.hash(passwordHash, 10);
    }

    if (permissions) {
      data.permissions = permissions as Prisma.InputJsonValue;
    }

    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    return this.prisma.user.delete({
      where: { id },
    });
  }
}
