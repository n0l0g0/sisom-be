import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { Room, RoomStatus } from '@prisma/client';

@Injectable()
export class BuildingsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateBuildingDto) {
    return this.prisma.building.create({
      data: {
        name: dto.name,
        code: dto.code,
        floors: dto.floors,
      },
    });
  }

  findAll() {
    return this.prisma.building.findMany({
      orderBy: { name: 'asc' },
      include: { rooms: true },
    });
  }

  async generateRooms(
    buildingId: string,
    params: {
      floors: Array<{
        floor: number;
        rooms: number;
        pricePerMonth?: number;
      }>;
      format?: {
        digits?: 3 | 4;
        buildingDigit?: string;
        prefix?: string;
      };
    },
  ) {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, code: true, name: true },
    });
    if (!building) {
      throw new BadRequestException('building not found');
    }

    const digits = params.format?.digits === 4 ? 4 : 3;
    const prefix = params.format?.prefix?.trim() || '';
    const fallbackDigit =
      (building.code || building.name || '').match(/\d/)?.[0] || '1';
    const buildingDigit =
      (params.format?.buildingDigit || fallbackDigit).match(/\d/)?.[0] || '1';

    const results: Room[] = [];
    for (const f of params.floors) {
      for (let i = 1; i <= f.rooms; i++) {
        const base =
          digits === 4
            ? `${buildingDigit}${f.floor}${String(i).padStart(2, '0')}`
            : `${f.floor}${String(i).padStart(2, '0')}`;
        const number = `${prefix}${base}`;

        const exists = await this.prisma.room.findFirst({
          where: { buildingId, number },
          select: { id: true },
        });

        if (exists) {
          results.push(
            await this.prisma.room.update({
              where: { id: exists.id },
              data: {
                floor: f.floor,
                ...(f.pricePerMonth !== undefined
                  ? { pricePerMonth: f.pricePerMonth }
                  : {}),
              },
            }),
          );
          continue;
        }

        results.push(
          await this.prisma.room.create({
            data: {
              number,
              floor: f.floor,
              status: RoomStatus.VACANT,
              buildingId,
              ...(f.pricePerMonth !== undefined
                ? { pricePerMonth: f.pricePerMonth }
                : {}),
            },
          }),
        );
      }
    }
    return results;
  }

  async mapFloorsToBuildings() {
    const rooms = await this.prisma.room.findMany({
      orderBy: { floor: 'asc' },
    });
    const floors = Array.from(new Set(rooms.map((r) => r.floor)));
    for (const f of floors) {
      const code = `B${f}`;
      const building = await this.prisma.building.upsert({
        where: { code },
        update: { name: `ตึก ${f}`, floors: 1 },
        create: { name: `ตึก ${f}`, code, floors: 1 },
      });
      const rs = rooms.filter((r) => r.floor === f);
      for (const r of rs) {
        await this.prisma.room.update({
          where: { id: r.id },
          data: { buildingId: building.id },
        });
      }
    }
    return { updatedFloors: floors.length };
  }
}
