import { Injectable } from '@nestjs/common';
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
    const hashedPassword = await bcrypt.hash(passwordHash, 10);

    const gen = () => String(Math.floor(100000 + Math.random() * 900000));
    const initialVerify =
      !rest.lineUserId && rest.phone ? (rest.verifyCode && /^\d{6}$/.test(rest.verifyCode) ? rest.verifyCode : gen()) : undefined;

    return this.prisma.user.create({
      data: {
        ...rest,
        verifyCode: initialVerify,
        passwordHash: hashedPassword,
        permissions: createUserDto.permissions as Prisma.InputJsonValue,
      },
    });
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
