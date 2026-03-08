import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantDbService } from './tenant-db.service';
import { tenantContext } from './tenant-context';

@Injectable()
export class TenantDbMiddleware implements NestMiddleware {
  constructor(private readonly tenantDb: TenantDbService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    let tenantId = req.headers['x-tenant-id'] as string | undefined;
    // LINE webhook ไม่ส่ง X-Tenant-Id — ใช้ tenant จาก config เพื่อโหลด DormConfig (Channel Token, Secret)
    if (!tenantId && req.path?.startsWith('/api/line') && process.env.LINE_TENANT_ID) {
      tenantId = process.env.LINE_TENANT_ID.trim();
    }
    if (tenantId) {
      await this.tenantDb.ensureClient(tenantId);
    }
    tenantContext.run({ tenantId }, () => next());
  }
}
