import { Injectable } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from '../line/line.service';
import { InvoiceStatus } from '@prisma/client';
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
    // If includeHistory is true, we want ALL tenants (including those with only inactive contracts)
    // If includeHistory is false, we want only tenants with at least one active contract
    
    // However, the previous implementation was filtering contracts, not tenants.
    // "where: includeHistory ? undefined : { isActive: true }" inside contracts include 
    // means "fetch tenant, and include their contracts (only active ones if flag is false)".
    
    // To support "Former Tenants" page which presumably calls this with includeHistory=true (or a different flag?),
    // we need to make sure we return tenants who HAVE contracts but ALL are inactive.
    
    return this.prisma.tenant
      .findMany({
        orderBy: { name: 'asc' },
        where: includeHistory ? undefined : {
          contracts: {
            some: { isActive: true }
          }
        },
        include: {
          contracts: {
            // When including history, we want ALL contracts. 
            // When not, we usually want only active ones? 
            // Actually, usually fetching a tenant should show their contract history anyway if we click details.
            // But the list view usually filters tenants.
            // Let's keep fetching all contracts for the tenant so we can see history.
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
        await this.cancelTenantInvoices(id);
      } catch (e) {
        console.error(`Failed to handle move out for tenant ${id}:`, e);
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
      // Cancel active invoices before soft deleting
      await this.cancelTenantInvoices(id);
      
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

  private async cancelTenantInvoices(tenantId: string) {
    // Find active contracts for this tenant
    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, isActive: true },
      select: { id: true },
    });
    const contractIds = contracts.map((c) => c.id);

    if (contractIds.length > 0) {
      // Cancel DRAFT and SENT invoices
      await this.prisma.invoice.updateMany({
        where: {
          contractId: { in: contractIds },
          status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.SENT] },
        },
        data: { status: InvoiceStatus.CANCELLED },
      });
    }
  }
}
