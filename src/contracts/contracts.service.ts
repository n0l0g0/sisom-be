import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { RoomStatus, Prisma } from '@prisma/client';
import {
  appendLog,
  readDeletedStore,
  softDeleteRecord,
} from '../activity/logger';

@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  async create(createContractDto: CreateContractDto) {
    const contract = await this.prisma.contract.create({
      data: {
        ...createContractDto,
        startDate: new Date(createContractDto.startDate),
        endDate: createContractDto.endDate
          ? new Date(createContractDto.endDate)
          : null,
      },
    });
    appendLog({
      action: 'CREATE',
      entityType: 'Contract',
      entityId: contract.id,
      details: {
        tenantId: contract.tenantId,
        roomId: contract.roomId,
        startDate: contract.startDate,
      },
    });

    // Update room status to OCCUPIED
    if (contract.isActive) {
      await this.prisma.room.update({
        where: { id: createContractDto.roomId },
        data: { status: RoomStatus.OCCUPIED },
      });
    }

    try {
      const start = new Date(createContractDto.startDate);
      const month = start.getMonth() + 1;
      const year = start.getFullYear();
      const rentAmount = Math.max(
        0,
        Number(createContractDto.currentRent || 0),
      );
      const depositAmount = Math.max(0, Number(createContractDto.deposit || 0));

      // Create initial move-in invoice: rent + deposit, no utilities
      const invoice = await this.prisma.invoice.create({
        data: {
          contractId: contract.id,
          month,
          year,
          rentAmount,
          waterAmount: 0,
          electricAmount: 0,
          otherFees: 0,
          discount: 0,
          totalAmount: rentAmount + depositAmount,
          status: 'DRAFT',
          dueDate: start,
        },
      });

      if (depositAmount > 0) {
        await this.prisma.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            description: 'ค่าประกัน',
            amount: depositAmount,
          },
        });
        // Ensure total matches base + items
        const base = rentAmount; // water/electric/otherFees are 0
        const nextTotal = Math.max(0, base + depositAmount);
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { totalAmount: nextTotal },
        });
      }
    } catch (e) {
      // swallow invoice creation error to not block contract creation
      void e;
    }

    return contract;
  }

  findAll(filters?: { isActive?: boolean }) {
    const where: Prisma.ContractWhereInput = {};
    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    return this.prisma.contract
      .findMany({
        where,
        include: {
          tenant: true,
          room: {
            include: {
              building: true,
            },
          },
        },
      })
      .then((list) => {
        const store = readDeletedStore();
        const removed = new Set<string>(store['Contract']?.ids || []);
        return list.filter((c) => !removed.has(c.id));
      });
  }

  findOne(id: string) {
    return this.prisma.contract.findUnique({
      where: { id },
      include: {
        tenant: true,
        room: true,
      },
    });
  }

  async update(id: string, updateContractDto: UpdateContractDto) {
    const { startDate, endDate, ...rest } = updateContractDto;
    const data: Prisma.ContractUpdateInput = { ...rest };

    if (startDate) {
      data.startDate = new Date(startDate);
    }
    if (endDate) {
      data.endDate = new Date(endDate);
    }

    const existing = await this.prisma.contract.findUnique({
      where: { id },
    });

    const contract = await this.prisma.contract.update({
      where: { id },
      data,
    });
    appendLog({
      action: 'UPDATE',
      entityType: 'Contract',
      entityId: id,
      details: updateContractDto,
    });

    if (
      updateContractDto.roomId &&
      existing &&
      updateContractDto.roomId !== existing.roomId
    ) {
      if (existing.isActive) {
        await this.prisma.room.update({
          where: { id: existing.roomId },
          data: { status: RoomStatus.VACANT },
        });
      }

      await this.prisma.room.update({
        where: { id: updateContractDto.roomId },
        data: {
          status: contract.isActive ? RoomStatus.OCCUPIED : RoomStatus.VACANT,
        },
      });
    }

    if (updateContractDto.isActive !== undefined) {
      await this.prisma.room.update({
        where: { id: contract.roomId },
        data: {
          status: updateContractDto.isActive
            ? RoomStatus.OCCUPIED
            : RoomStatus.VACANT,
        },
      });

      // If contract is set to inactive (Move Out), clear all room contacts for this room
      if (!updateContractDto.isActive) {
        // Find contacts with lineUserId to unlink rich menu
        const contacts = await this.prisma.roomContact.findMany({
          where: { roomId: contract.roomId },
        });
        
        // Delete all contacts
        await this.prisma.roomContact.deleteMany({
          where: { roomId: contract.roomId },
        });
        
        // Note: Rich Menu unlinking is handled by a separate service usually, 
        // or we could emit an event. For now, we just ensure data is clean.
      }
    }

    return contract;
  }

  async remove(id: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) {
      return { ok: true };
    }
    softDeleteRecord('Contract', id, {
      tenantId: contract.tenantId,
      roomId: contract.roomId,
      startDate: contract.startDate,
    });
    appendLog({
      action: 'DELETE',
      entityType: 'Contract',
      entityId: id,
      details: { tenantId: contract.tenantId, roomId: contract.roomId },
    });

    if (contract.isActive) {
      await this.prisma.room.update({
        where: { id: contract.roomId },
        data: { status: RoomStatus.VACANT },
      });
    }

    return { ok: true };
  }

  async syncDepositsGlobal() {
    const contracts = await this.prisma.contract.findMany({
      where: { isActive: true },
      include: { room: true },
    });
    let updated = 0;
    for (const c of contracts) {
      const rent =
        Number(c.currentRent ?? 0) || Number(c.room?.pricePerMonth ?? 0);
      const target = rent === 3000 ? 3000 : 1000;
      if (Number(c.deposit ?? 0) !== target) {
        await this.prisma.contract.update({
          where: { id: c.id },
          data: { deposit: target },
        });
        updated++;
      }
    }
    return { ok: true, total: contracts.length, updated };
  }

  async syncRentFromRoom() {
    const contracts = await this.prisma.contract.findMany({
      where: { isActive: true },
      include: { room: true },
    });
    let updated = 0;
    for (const c of contracts) {
      const price = Number(c.room?.pricePerMonth ?? 0);
      if (
        Number.isFinite(price) &&
        price > 0 &&
        Number(c.currentRent ?? 0) !== price
      ) {
        await this.prisma.contract.update({
          where: { id: c.id },
          data: { currentRent: price },
        });
        updated++;
      }
    }
    return { ok: true, total: contracts.length, updated };
  }

  async moveOut(id: string, moveOutDate?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
    });
    if (!contract) {
      throw new BadRequestException('contract not found');
    }

    const unpaidCount = await this.prisma.invoice.count({
      where: {
        contractId: id,
        status: {
          not: 'PAID',
        },
      },
    });

    if (unpaidCount > 0) {
      throw new BadRequestException('ยังมีใบแจ้งหนี้ที่ยังไม่เคลียร์');
    }

    const endDate = moveOutDate ? new Date(moveOutDate) : new Date();

    const updated = await this.update(id, {
      isActive: false,
      endDate: endDate.toISOString(),
    } as any);

    // Ensure room is vacant and contacts are cleared (update method handles contact clearing)
    await this.prisma.room.update({
      where: { id: contract.roomId },
      data: { status: RoomStatus.VACANT },
    });

    return updated;
  }
}
