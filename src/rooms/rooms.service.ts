import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async create(createRoomDto: CreateRoomDto) {
    const { number, floor, pricePerMonth, status, buildingId, waterOverrideAmount, electricOverrideAmount } = createRoomDto;
    if (!buildingId || !buildingId.trim()) {
      throw new BadRequestException('buildingId is required');
    }
    const normalizedNumber = (number || '').trim();
    if (!normalizedNumber) {
      throw new BadRequestException('number is required');
    }
    const dup = await this.prisma.room.findFirst({
      where: { buildingId, number: normalizedNumber },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException('room number already exists in this building');
    }
    const data: Prisma.RoomUncheckedCreateInput = {
      number: normalizedNumber,
      floor,
      status: status ?? undefined,
      buildingId,
    };
    if (pricePerMonth !== undefined) {
      data.pricePerMonth = pricePerMonth;
    }
    if (waterOverrideAmount !== undefined) {
      data.waterOverrideAmount = waterOverrideAmount;
    }
    if (electricOverrideAmount !== undefined) {
      data.electricOverrideAmount = electricOverrideAmount;
    }
    return this.prisma.room.create({
      data,
    });
  }

  findAll() {
    return this.prisma.room.findMany({
      orderBy: [{ building: { code: 'asc' } }, { number: 'asc' }],
      include: {
        contracts: {
          where: { isActive: true },
          orderBy: { startDate: 'desc' },
          take: 1,
          include: { tenant: true },
        },
        meterReadings: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        building: true,
      },
    });
  }

  findOne(id: string) {
    return this.prisma.room.findUnique({
      where: { id },
    });
  }

  async update(id: string, updateRoomDto: UpdateRoomDto) {
    const existing = await this.prisma.room.findUnique({
      where: { id },
      select: { buildingId: true, number: true },
    });
    if (!existing) {
      throw new BadRequestException('room not found');
    }

    const nextNumber =
      typeof updateRoomDto.number === 'string' && updateRoomDto.number.trim()
        ? updateRoomDto.number.trim()
        : undefined;
    if (nextNumber && existing.buildingId) {
      const dup = await this.prisma.room.findFirst({
        where: {
          buildingId: existing.buildingId,
          number: nextNumber,
          id: { not: id },
        },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException('room number already exists in this building');
      }
    }

    return this.prisma.room.update({
      where: { id },
      data: {
        number: nextNumber,
        floor: updateRoomDto.floor ?? undefined,
        pricePerMonth:
          updateRoomDto.pricePerMonth !== undefined
            ? updateRoomDto.pricePerMonth
            : undefined,
        waterOverrideAmount:
          updateRoomDto.waterOverrideAmount !== undefined
            ? updateRoomDto.waterOverrideAmount
            : undefined,
        electricOverrideAmount:
          updateRoomDto.electricOverrideAmount !== undefined
            ? updateRoomDto.electricOverrideAmount
            : undefined,
      },
    });
  }

  remove(id: string) {
    return this.prisma.room.delete({
      where: { id },
    });
  }
}
