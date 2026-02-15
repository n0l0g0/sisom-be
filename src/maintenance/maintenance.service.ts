import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { RoomStatus } from '@prisma/client';

@Injectable()
export class MaintenanceService {
  constructor(private prisma: PrismaService) {}

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

  update(id: string, updateMaintenanceDto: UpdateMaintenanceDto) {
    const { resolvedAt, ...rest } = updateMaintenanceDto;
    const data = {
      ...rest,
      ...(resolvedAt ? { resolvedAt: new Date(resolvedAt) } : {}),
    };
    return this.prisma.maintenanceRequest.update({
      where: { id },
      data,
    });
  }

  remove(id: string) {
    return this.prisma.maintenanceRequest.delete({
      where: { id },
    });
  }
}
