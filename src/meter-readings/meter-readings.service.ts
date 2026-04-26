import { Injectable } from '@nestjs/common';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto';
import { UpdateMeterReadingDto } from './dto/update-meter-reading.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { InvoicesService } from '../invoices/invoices.service';
import {
  appendLog,
  readDeletedStore,
  softDeleteRecord,
} from '../activity/logger';

@Injectable()
export class MeterReadingsService {
  constructor(
    private prisma: PrismaService,
    private invoicesService: InvoicesService,
  ) {}

  async create(createMeterReadingDto: CreateMeterReadingDto) {
    await this.ensurePreviousMonthReading(
      createMeterReadingDto.roomId,
      createMeterReadingDto.month,
      createMeterReadingDto.year,
      Number(createMeterReadingDto.waterReading),
      Number(createMeterReadingDto.electricReading),
    );

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
        // Auto-refresh invoice utility values for this room/month after meter change.
        this.invoicesService
          .recalculateRoomMonth(mr.roomId, mr.month, mr.year)
          .catch(() => {});
        return mr;
      });
  }

  private async ensurePreviousMonthReading(
    roomId: string,
    month: number,
    year: number,
    currentWater: number,
    currentElectric: number,
  ) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    const prevExists = await this.prisma.meterReading.findUnique({
      where: { roomId_month_year: { roomId, month: prevMonth, year: prevYear } },
    });
    if (prevExists) return;

    // หาค่ามิเตอร์ล่าสุดที่มีอยู่ก่อนเดือนที่กำลังบันทึก
    const latest = await this.prisma.meterReading.findFirst({
      where: {
        roomId,
        OR: [
          { year: { lt: year } },
          { year, month: { lt: month } },
        ],
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    // ถ้าไม่มีค่าก่อนหน้าเลย ใช้ค่าปัจจุบันแทน (ใช้ไป = 0)
    const fillWater = latest ? Number(latest.waterReading) : currentWater;
    const fillElectric = latest ? Number(latest.electricReading) : currentElectric;

    await this.prisma.meterReading.create({
      data: {
        roomId,
        month: prevMonth,
        year: prevYear,
        waterReading: fillWater,
        electricReading: fillElectric,
      },
    });

    appendLog({
      action: 'UPSERT',
      entityType: 'MeterReading',
      details: {
        roomId,
        month: prevMonth,
        year: prevYear,
        autoFilled: true,
        source: latest ? `copied from ${latest.month}/${latest.year}` : 'same as current (no prior reading)',
      },
    });
  }

  async findLatestPerRoom(beforeMonth: number, beforeYear: number) {
    const readings = await this.prisma.meterReading.findMany({
      where: {
        OR: [
          { year: { lt: beforeYear } },
          { year: beforeYear, month: { lt: beforeMonth } },
        ],
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    const latestPerRoom = new Map<string, (typeof readings)[0]>();
    for (const r of readings) {
      if (!latestPerRoom.has(r.roomId)) {
        latestPerRoom.set(r.roomId, r);
      }
    }
    return Array.from(latestPerRoom.values());
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
        this.invoicesService
          .recalculateRoomMonth(mr.roomId, mr.month, mr.year)
          .catch(() => {});
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
