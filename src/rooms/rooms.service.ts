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
import {
  appendLog,
  readDeletedStore,
  softDeleteRecord,
} from '../activity/logger';

type RoomContact = {
  id: string;
  name: string;
  phone: string;
  lineUserId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type RoomContactsStore = Record<string, RoomContact[]>;

type RoomPaymentSchedule = {
  monthlyDay?: number;
  oneTimeDate?: string;
  updatedAt?: string;
};

type RoomSchedulesStore = Record<string, RoomPaymentSchedule>;

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private ensureUploadsDir() {
    const uploadsDir = path.resolve('/app/uploads');
    if (!fs.existsSync(uploadsDir)) {
      try {
        fs.mkdirSync(uploadsDir, { recursive: true });
      } catch {
        return uploadsDir;
      }
    }
    return uploadsDir;
  }

  private getContactsFilePath() {
    return path.join(this.ensureUploadsDir(), 'room-contacts.json');
  }

  private getSchedulesFilePath() {
    return path.join(this.ensureUploadsDir(), 'room-payment-schedule.json');
  }

  private readContactsStore(): RoomContactsStore | null {
    try {
      const p = this.getContactsFilePath();
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, 'utf8');
      if (!raw.trim()) return {};
      const parsedUnknown = JSON.parse(raw) as unknown;
      if (!this.isRecord(parsedUnknown)) return {};
      return parsedUnknown as RoomContactsStore;
    } catch {
      return {};
    }
  }

  private writeContactsStore(store: RoomContactsStore) {
    try {
      const p = this.getContactsFilePath();
      fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
    } catch {
      return;
    }
  }

  private readSchedulesStore(): RoomSchedulesStore {
    try {
      const p = this.getSchedulesFilePath();
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, 'utf8');
      if (!raw.trim()) return {};
      const parsedUnknown = JSON.parse(raw) as unknown;
      if (!this.isRecord(parsedUnknown)) return {};
      return parsedUnknown as RoomSchedulesStore;
    } catch {
      return {};
    }
  }

  private writeSchedulesStore(store: RoomSchedulesStore) {
    try {
      const p = this.getSchedulesFilePath();
      fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
    } catch {
      return;
    }
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
    const contact: RoomContact = {
      id: randomUUID(),
      name: tenant.name || tenant.phone,
      phone: tenant.phone,
      lineUserId: tenant.lineUserId || undefined,
      createdAt: now,
      updatedAt: now,
    };
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
    const next: RoomContact[] = [
      ...current,
      {
        id: randomUUID(),
        name,
        phone,
        lineUserId: undefined,
        createdAt: now,
        updatedAt: now,
      },
    ];
    store[roomId] = next;
    this.writeContactsStore(store);
    return next;
  }

  clearRoomContactLine(roomId: string, contactId: string) {
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

  deleteRoomContact(roomId: string, contactId: string) {
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
    const room = await this.prisma.room.create({
      data,
    });
    appendLog({
      action: 'CREATE',
      entityType: 'Room',
      entityId: room.id,
      details: {
        number: room.number,
        floor: room.floor,
        buildingId: room.buildingId,
      },
    });
    return room;
  }

  findAll() {
    return this.prisma.room
      .findMany({
        orderBy: [{ building: { code: 'asc' } }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          floor: true,
          status: true,
          pricePerMonth: true,
          waterOverrideAmount: true,
          electricOverrideAmount: true,
          buildingId: true,
          contracts: {
            where: { isActive: true },
            orderBy: { startDate: 'desc' },
            take: 1,
            select: {
              id: true,
              tenantId: true,
              roomId: true,
              startDate: true,
              endDate: true,
              deposit: true,
              currentRent: true,
              occupantCount: true,
              isActive: true,
              contractImageUrl: true,
              tenant: {
                select: {
                  id: true,
                  name: true,
                  nickname: true,
                  phone: true,
                  lineUserId: true,
                  status: true,
                },
              },
            },
          },
          meterReadings: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              roomId: true,
              month: true,
              year: true,
              waterReading: true,
              electricReading: true,
              createdAt: true,
            },
          },
          maintenanceRequests: {
            where: { OR: [{ status: 'PENDING' }, { status: 'IN_PROGRESS' }] },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              roomId: true,
              title: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          building: {
            select: {
              id: true,
              name: true,
              code: true,
              floors: true,
            },
          },
        },
      })
      .then((list) => {
        const store = readDeletedStore();
        const removed = new Set<string>(store['Room']?.ids || []);
        return list.filter((r) => !removed.has(r.id));
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

    const updated = await this.prisma.room.update({
      where: { id },
      data: {
        number: nextNumber,
        floor: updateRoomDto.floor ?? undefined,
        status: updateRoomDto.status ?? undefined,
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
    appendLog({
      action: 'UPDATE',
      entityType: 'Room',
      entityId: id,
      details: updateRoomDto,
    });
    return updated;
  }

  async remove(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (room) {
      softDeleteRecord('Room', id, {
        number: room.number,
        floor: room.floor,
        buildingId: room.buildingId,
      });
      appendLog({
        action: 'DELETE',
        entityType: 'Room',
        entityId: id,
        details: { number: room.number, floor: room.floor },
      });
    }
    return { ok: true };
  }

  getRoomPaymentSchedule(roomId: string) {
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
      const day = d.getDate();
      store[roomId] = { monthlyDay: day, oneTimeDate: undefined, updatedAt };
    } else {
      store[roomId] = {
        oneTimeDate: d.toISOString(),
        monthlyDay: undefined,
        updatedAt,
      };
    }
    this.writeSchedulesStore(store);
    return store[roomId];
  }

  listRoomPaymentSchedules() {
    return this.readSchedulesStore() || {};
  }
}
