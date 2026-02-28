import { Injectable } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from '../line/line.service';
import {
  appendLog,
  readDeletedStore,
  softDeleteRecord,
} from '../activity/logger';

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private lineService: LineService,
  ) {}

  create(createTenantDto: CreateTenantDto) {
    const data = { ...createTenantDto };
    if (data.lineUserId === '') {
      data.lineUserId = undefined; // let prisma treat it as null/undefined
    }
    return this.prisma.tenant
      .create({
        data,
      })
      .then((t) => {
        appendLog({
          action: 'CREATE',
          entityType: 'Tenant',
          entityId: t.id,
          details: { name: t.name, phone: t.phone },
        });
        return t;
      });
  }

  findAll(includeHistory: boolean = false) {
    return this.prisma.tenant
      .findMany({
        orderBy: { name: 'asc' },
        include: {
          contracts: {
            where: includeHistory ? undefined : { isActive: true },
            include: {
              room: true,
              invoices: {
                select: { status: true, totalAmount: true },
              },
            },
            orderBy: { startDate: 'desc' },
          },
        },
      })
      .then((list) => {
        const store = readDeletedStore();
        const removed = new Set<string>(store['Tenant']?.ids || []);
        return list.filter((t) => !removed.has(t.id));
      });
  }

  findOne(id: string) {
    return this.prisma.tenant.findUnique({
      where: { id },
      include: {
        contracts: {
          include: { room: true },
        },
      },
    });
  }

  async update(id: string, updateTenantDto: UpdateTenantDto) {
    const data = { ...updateTenantDto };
    
    if (data.status === 'MOVED_OUT') {
      try {
        await this.lineService.disconnectTenant(id);
      } catch (e) {
        console.error(`Failed to disconnect tenant ${id}:`, e);
      }
      data.lineUserId = null as any;
    }

    if (data.lineUserId === '') {
      data.lineUserId = null as any; // force null
    }
    return this.prisma.tenant
      .update({
        where: { id },
        data,
      })
      .then((t) => {
        appendLog({
          action: 'UPDATE',
          entityType: 'Tenant',
          entityId: id,
          details: updateTenantDto,
        });
        return t;
      });
  }

  async remove(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (t) {
      softDeleteRecord('Tenant', id, { name: t.name, phone: t.phone });
      appendLog({
        action: 'DELETE',
        entityType: 'Tenant',
        entityId: id,
        details: { name: t.name, phone: t.phone },
      });
    }
    return { ok: true };
  }
}
