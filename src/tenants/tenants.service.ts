import { Injectable } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
import { appendLog, readDeletedStore, softDeleteRecord } from '../activity/logger';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  create(createTenantDto: CreateTenantDto) {
    return this.prisma.tenant
      .create({
        data: createTenantDto,
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
            include: { room: true },
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

  update(id: string, updateTenantDto: UpdateTenantDto) {
    return this.prisma.tenant
      .update({
        where: { id },
        data: updateTenantDto,
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
