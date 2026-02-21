import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import {
  appendLog,
  readDeletedStore,
  softDeleteRecord,
} from '../activity/logger';

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  create(createAssetDto: CreateAssetDto) {
    return this.prisma.asset
      .create({
        data: {
          ...createAssetDto,
          status: createAssetDto.status || 'GOOD',
        },
      })
      .then((a) => {
        appendLog({
          action: 'CREATE',
          entityType: 'Asset',
          entityId: a.id,
          details: { roomId: a.roomId, name: a.name },
        });
        return a;
      });
  }

  findAll() {
    return this.prisma.asset.findMany().then((list) => {
      const store = readDeletedStore();
      const removed = new Set<string>(store['Asset']?.ids || []);
      return list.filter((a) => !removed.has(a.id));
    });
  }

  findByRoom(roomId: string) {
    return this.prisma.asset
      .findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
      })
      .then((list) => {
        const store = readDeletedStore();
        const removed = new Set<string>(store['Asset']?.ids || []);
        return list.filter((a) => !removed.has(a.id));
      });
  }

  findOne(id: string) {
    return this.prisma.asset.findUnique({
      where: { id },
    });
  }

  update(id: string, updateAssetDto: UpdateAssetDto) {
    return this.prisma.asset
      .update({
        where: { id },
        data: updateAssetDto,
      })
      .then((a) => {
        appendLog({
          action: 'UPDATE',
          entityType: 'Asset',
          entityId: id,
          details: updateAssetDto,
        });
        return a;
      });
  }

  async remove(id: string) {
    const a = await this.prisma.asset.findUnique({ where: { id } });
    if (a) {
      softDeleteRecord('Asset', id, { roomId: a.roomId, name: a.name });
      appendLog({
        action: 'DELETE',
        entityType: 'Asset',
        entityId: id,
        details: { roomId: a.roomId, name: a.name },
      });
    }
    return { ok: true };
  }
}
