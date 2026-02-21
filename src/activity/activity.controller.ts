import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { appendLog, readLogs, queryLogs } from './logger';

@Controller('activity-logs')
export class ActivityController {
  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('user') user?: string,
    @Query('action') action?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const hasPaging = page || pageSize || user || action || start || end;
    if (hasPaging) {
      const res = queryLogs({
        page: Number(page || 1),
        pageSize: Number(pageSize || 50),
        user,
        action,
        start,
        end,
      });
      return res;
    }
    const n = Math.max(1, Math.min(1000, Number(limit || 500)));
    const items = readLogs(n);
    return { items, total: items.length, page: 1, pageSize: n };
  }

  @Post()
  create(
    @Body()
    body: {
      userId?: string;
      username?: string;
      action: string;
      path?: string;
      entityType?: string;
      entityId?: string;
      details?: any;
    },
  ) {
    appendLog({
      userId: body.userId,
      username: body.username,
      action: String(body.action || '').toUpperCase(),
      path: body.path,
      entityType: body.entityType,
      entityId: body.entityId,
      details: body.details,
    });
    return { ok: true };
  }
}
