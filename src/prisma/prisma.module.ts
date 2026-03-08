import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { TenantDbModule } from '../tenant-db/tenant-db.module';
import { TenantDbService } from '../tenant-db/tenant-db.service';
import { tenantContext } from '../tenant-db/tenant-context';

@Global()
@Module({
  imports: [TenantDbModule],
  providers: [
    {
      provide: PrismaService,
      useFactory: (tenantDb: TenantDbService) => {
        return new Proxy({} as PrismaClient, {
          get(_target, prop) {
            const store = tenantContext.getStore();
            const client = tenantDb.getClient(store?.tenantId);
            return (client as unknown as Record<string, unknown>)[prop as string];
          },
        }) as PrismaService;
      },
      inject: [TenantDbService],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
