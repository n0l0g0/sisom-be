import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const OWNER_API = process.env.OWNER_API_URL || 'http://owner13rent-backend:3000';

interface TenantConfig {
  url: string;
}

const tenantClients = new Map<string, PrismaClient>();
let defaultClient: PrismaClient | null = null;

@Injectable()
export class TenantDbService implements OnModuleDestroy {
  async ensureClient(tenantId: string): Promise<PrismaClient> {
    if (tenantClients.has(tenantId)) {
      return tenantClients.get(tenantId)!;
    }
    const res = await fetch(`${OWNER_API}/api/tenants/${tenantId}/connection-url`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get tenant config: ${res.status} ${text}`);
    }
    const data = (await res.json()) as TenantConfig;
    const client = new PrismaClient({
      datasources: { db: { url: data.url } },
    });
    await client.$connect();
    tenantClients.set(tenantId, client);
    return client;
  }

  getClient(tenantId: string | undefined): PrismaClient {
    if (!tenantId) return this.getDefaultClient();
    const c = tenantClients.get(tenantId);
    if (!c) {
      throw new Error(
        `Tenant client not loaded for ${tenantId}. Ensure middleware ran and X-Tenant-Id is set.`,
      );
    }
    return c;
  }

  getDefaultClient(): PrismaClient {
    if (!defaultClient) {
      defaultClient = new PrismaClient({
        log: ['query', 'info', 'warn', 'error'],
      });
      defaultClient.$connect().catch(() => {});
    }
    return defaultClient;
  }

  async onModuleDestroy() {
    for (const client of tenantClients.values()) {
      await client.$disconnect();
    }
    tenantClients.clear();
    if (defaultClient) {
      await defaultClient.$disconnect();
      defaultClient = null;
    }
  }
}
