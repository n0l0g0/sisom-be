import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { MaintenanceStatus, RoomStatus } from '@prisma/client';
import { LineService } from '../line/line.service';

@Injectable()
export class MaintenanceService {
  constructor(
    private prisma: PrismaService,
    private lineService: LineService,
  ) {}

  async create(createMaintenanceDto: CreateMaintenanceDto) {
    const maintenanceRequest = await this.prisma.maintenanceRequest.create({
      data: createMaintenanceDto,
    });

    if (createMaintenanceDto.roomId) {
      console.log(
        `Auto-updating room ${createMaintenanceDto.roomId} status to MAINTENANCE`,
      );
      await this.prisma.room.update({
        where: { id: createMaintenanceDto.roomId },
        data: { status: RoomStatus.MAINTENANCE },
      });
    }

    return maintenanceRequest;
  }

  findAll() {
    return this.prisma.maintenanceRequest.findMany({
      include: {
        room: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  findByRoom(roomId: string) {
    return this.prisma.maintenanceRequest.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: {
        room: true,
      },
    });
  }

  async update(id: string, updateMaintenanceDto: UpdateMaintenanceDto) {
    const prev = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      select: { status: true },
    });

    const { resolvedAt, ...rest } = updateMaintenanceDto;
    const data = {
      ...rest,
      ...(resolvedAt ? { resolvedAt: new Date(resolvedAt) } : {}),
      ...(updateMaintenanceDto.status === MaintenanceStatus.COMPLETED &&
      !resolvedAt
        ? { resolvedAt: new Date() }
        : {}),
    };

    const updated = await this.prisma.maintenanceRequest.update({
      where: { id },
      data,
    });

    if (
      prev &&
      prev.status !== MaintenanceStatus.COMPLETED &&
      updated.status === MaintenanceStatus.COMPLETED
    ) {
      this.lineService
        .notifyTenantMaintenanceCompleted(updated.id)
        .catch((err) => {
          console.error(
            '[maintenance] Failed to notify tenant maintenance completed',
            err,
          );
        });
    }

    return updated;
  }

  remove(id: string) {
    return this.prisma.maintenanceRequest.delete({
      where: { id },
    });
  }
}
