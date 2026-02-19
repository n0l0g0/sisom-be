import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  private getContactsFilePath() {
    const uploadsDir = path.resolve('/app/uploads');
    if (!fs.existsSync(uploadsDir)) {
      try {
        fs.mkdirSync(uploadsDir, { recursive: true });
      } catch {}
    }
    return path.join(uploadsDir, 'room-contacts.json');
  }

  private getSchedulesFilePath() {
    const uploadsDir = path.resolve('/app/uploads');
    if (!fs.existsSync(uploadsDir)) {
      try {
        fs.mkdirSync(uploadsDir, { recursive: true });
      } catch {}
    }
    return path.join(uploadsDir, 'room-payment-schedule.json');
  }

  private readContactsStore(): Record<
    string,
    Array<{ id: string; name: string; phone: string; lineUserId?: string }>
  > | null {
    try {
      const p = this.getContactsFilePath();
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, 'utf8');
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Record<
        string,
        Array<{ id: string; name: string; phone: string; lineUserId?: string }>
      >;
    } catch {
      return {};
    }
  }

  private writeContactsStore(
    store: Record<
      string,
      Array<{ id: string; name: string; phone: string; lineUserId?: string }>
    >,
  ) {
    try {
      const p = this.getContactsFilePath();
      fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
    } catch {}
  }

  private readSchedulesStore(): Record<
    string,
    { monthlyDay?: number; oneTimeDate?: string; updatedAt?: string }
  > {
    try {
      const p = this.getSchedulesFilePath();
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, 'utf8');
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Record<
        string,
        { monthlyDay?: number; oneTimeDate?: string; updatedAt?: string }
      >;
    } catch {
      return {};
    }
  }

  private writeSchedulesStore(
    store: Record<
      string,
      { monthlyDay?: number; oneTimeDate?: string; updatedAt?: string }
    >,
  ) {
    try {
      const p = this.getSchedulesFilePath();
      fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
    } catch {}
  }

  async getRoomContacts(roomId: string) {
    const store = this.readContactsStore() || {};
    const list = store[roomId] || [];
    if (list.length > 0) {
      return list;
    }

    const contract = await this.prisma.contract.findFirst({
      where: { roomId, isActive: true },
      include: { tenant: true },
    });
    const tenant = contract?.tenant;
    if (!tenant || !tenant.phone) {
      return [];
    }

    const now = new Date().toISOString();
    const contact = {
      id: randomUUID(),
      name: tenant.name || tenant.phone,
      phone: tenant.phone,
      lineUserId: tenant.lineUserId || undefined,
      createdAt: now,
      updatedAt: now,
    } as any;
    const next = [contact];
    store[roomId] = next;
    this.writeContactsStore(store);
    return next;
  }

  async addRoomContact(
    roomId: string,
    body: { name?: string; phone?: string },
  ) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true },
    });
    if (!room) {
      throw new NotFoundException('room not found');
    }
    const phone = (body.phone || '').trim();
    if (!phone) {
      throw new BadRequestException('phone is required');
    }
    const name = (body.name || '').trim() || phone;
    const store = this.readContactsStore() || {};
    const current = store[roomId] || [];
    if (current.some((c) => c.phone === phone)) {
      throw new ConflictException('phone already exists for this room');
    }
    const now = new Date().toISOString();
    const next = [
      ...current,
      {
        id: randomUUID(),
        name,
        phone,
        lineUserId: undefined,
        createdAt: now,
        updatedAt: now,
      } as any,
    ];
    store[roomId] = next;
    this.writeContactsStore(store);
    return next;
  }

  async clearRoomContactLine(roomId: string, contactId: string) {
    const store = this.readContactsStore() || {};
    const current = store[roomId] || [];
    const next = current.map((c) =>
      c.id === contactId
        ? { ...c, lineUserId: undefined, updatedAt: new Date().toISOString() }
        : c,
    );
    store[roomId] = next;
    this.writeContactsStore(store);
    return next;
  }

  async deleteRoomContact(roomId: string, contactId: string) {
    const store = this.readContactsStore() || {};
    const current = store[roomId] || [];
    const next = current.filter((c) => c.id !== contactId);
    store[roomId] = next;
    this.writeContactsStore(store);
    return next;
  }

  async create(createRoomDto: CreateRoomDto) {
    const {
      number,
      floor,
      pricePerMonth,
      status,
      buildingId,
      waterOverrideAmount,
      electricOverrideAmount,
    } = createRoomDto;
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
      throw new ConflictException(
        'room number already exists in this building',
      );
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
        throw new ConflictException(
          'room number already exists in this building',
        );
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

  async getRoomPaymentSchedule(roomId: string) {
    const store = this.readSchedulesStore() || {};
    const s = store[roomId] || null;
    return s;
  }

  async setRoomPaymentSchedule(
    roomId: string,
    payload: { date?: string; monthly?: boolean },
  ) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true },
    });
    if (!room) {
      throw new NotFoundException('room not found');
    }
    const dateStr = (payload.date || '').trim();
    if (!dateStr) {
      throw new BadRequestException('date is required');
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      throw new BadRequestException('invalid date');
    }
    const monthly = !!payload.monthly;
    const store = this.readSchedulesStore() || {};
    const updatedAt = new Date().toISOString();
    if (monthly) {
      const day = d.getUTCDate();
      store[roomId] = { monthlyDay: day, oneTimeDate: undefined, updatedAt };
    } else {
      store[roomId] = { oneTimeDate: d.toISOString(), monthlyDay: undefined, updatedAt };
    }
    this.writeSchedulesStore(store);
    return store[roomId];
  }

  async listRoomPaymentSchedules() {
    return this.readSchedulesStore() || {};
  }
}
