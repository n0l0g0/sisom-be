import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantDbService } from './tenant-db.service';
import { tenantContext } from './tenant-context';

@Injectable()
export class TenantDbMiddleware implements NestMiddleware {
  constructor(private readonly tenantDb: TenantDbService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    if (tenantId) {
      await this.tenantDb.ensureClient(tenantId);
    }
    tenantContext.run({ tenantId }, () => next());
  }
}
