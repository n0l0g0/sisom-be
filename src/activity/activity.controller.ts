import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { appendLog, readLogs } from './logger';

@Controller('activity-logs')
export class ActivityController {
  @Get()
  list(@Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(1000, Number(limit || 500)));
    const items = readLogs(n);
    return { items };
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
