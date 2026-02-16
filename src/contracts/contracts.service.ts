import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { RoomStatus, Prisma } from '@prisma/client';

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

    // Update room status to OCCUPIED
    if (contract.isActive) {
      await this.prisma.room.update({
        where: { id: createContractDto.roomId },
        data: { status: RoomStatus.OCCUPIED },
      });
    }

    return contract;
  }

  findAll() {
    return this.prisma.contract.findMany({
      include: {
        tenant: true,
        room: {
          include: {
            building: true,
          },
        },
      },
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
    }

    return contract;
  }

  async remove(id: string) {
    const contract = await this.prisma.contract.delete({
      where: { id },
    });

    if (contract.isActive) {
      await this.prisma.room.update({
        where: { id: contract.roomId },
        data: { status: RoomStatus.VACANT },
      });
    }

    return contract;
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

    await this.prisma.room.update({
      where: { id: contract.roomId },
      data: { status: RoomStatus.VACANT },
    });

    return updated;
  }
}
