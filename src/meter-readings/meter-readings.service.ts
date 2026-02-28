import { Injectable } from '@nestjs/common';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto';
import { UpdateMeterReadingDto } from './dto/update-meter-reading.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  appendLog,
  readDeletedStore,
  softDeleteRecord,
} from '../activity/logger';

@Injectable()
export class MeterReadingsService {
  constructor(private prisma: PrismaService) {}

  create(createMeterReadingDto: CreateMeterReadingDto) {
    return this.prisma.meterReading
      .upsert({
        where: {
          roomId_month_year: {
            roomId: createMeterReadingDto.roomId,
            month: createMeterReadingDto.month,
            year: createMeterReadingDto.year,
          },
        },
        update: {
          waterReading: createMeterReadingDto.waterReading,
          electricReading: createMeterReadingDto.electricReading,
        },
        create: createMeterReadingDto,
      })
      .then((mr) => {
        appendLog({
          action: 'UPSERT',
          entityType: 'MeterReading',
          entityId: mr.id,
          details: { roomId: mr.roomId, month: mr.month, year: mr.year },
        });
        return mr;
      });
  }

  findAll(month?: number, year?: number) {
    const where: Prisma.MeterReadingWhereInput = {};
    if (month) where.month = month;
    if (year) where.year = year;

    return this.prisma.meterReading
      .findMany({
        where,
        include: {
          room: {
            select: {
              id: true,
              number: true,
              floor: true,
              buildingId: true,
              building: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
            },
          },
        },
        orderBy: [
          { year: 'desc' },
          { month: 'desc' },
          { room: { number: 'asc' } },
        ],
      })
      .then((list) => {
        const store = readDeletedStore();
        const removed = new Set<string>(store['MeterReading']?.ids || []);
        return list.filter((mr) => !removed.has(mr.id));
      });
  }

  findOne(id: string) {
    return this.prisma.meterReading.findUnique({
      where: { id },
      include: {
        room: {
          include: {
            building: true,
          },
        },
      },
    });
  }

  findByRoom(roomId: string, month?: number, year?: number) {
    const where: Prisma.MeterReadingWhereInput = { roomId };
    if (month) where.month = month;
    if (year) where.year = year;

    return this.prisma.meterReading
      .findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      })
      .then((list) => {
        const store = readDeletedStore();
        const removed = new Set<string>(store['MeterReading']?.ids || []);
        return list.filter((mr) => !removed.has(mr.id));
      });
  }

  update(id: string, updateMeterReadingDto: UpdateMeterReadingDto) {
    return this.prisma.meterReading
      .update({
        where: { id },
        data: updateMeterReadingDto,
      })
      .then((mr) => {
        appendLog({
          action: 'UPDATE',
          entityType: 'MeterReading',
          entityId: id,
          details: updateMeterReadingDto,
        });
        return mr;
      });
  }

  async remove(id: string) {
    const mr = await this.prisma.meterReading.findUnique({ where: { id } });
    if (mr) {
      softDeleteRecord('MeterReading', id, {
        roomId: mr.roomId,
        month: mr.month,
        year: mr.year,
      });
      appendLog({
        action: 'DELETE',
        entityType: 'MeterReading',
        entityId: id,
        details: { roomId: mr.roomId, month: mr.month, year: mr.year },
      });
    }
    return { ok: true };
  }
}
