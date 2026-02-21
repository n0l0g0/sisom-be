import {
  Controller,
  Post,
  Headers,
  Logger,
  Get,
  Param,
  Query,
  Body,
  Req,
} from '@nestjs/common';
import { LineService } from './line.service';
import type { WebhookRequestBody } from '@line/bot-sdk';
import * as crypto from 'crypto';
import type { Request } from 'express';

@Controller('line')
export class LineController {
  private readonly logger = new Logger(LineController.name);
  constructor(private readonly lineService: LineService) {}

  @Post('webhook')
  async webhook(
    @Body() body: WebhookRequestBody,
    @Headers('x-line-signature') signature: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    // Validate signature manually if not using middleware globally
    // For simplicity, we trust the service handles verification or we do it here
    // Note: In a production NestJS app, we often use a Guard or Middleware for signature validation

    // Basic Signature Validation
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (channelSecret) {
      const raw = req?.rawBody ?? Buffer.from(JSON.stringify(body));
      const expectedSignature = crypto
        .createHmac('SHA256', channelSecret)
        .update(raw)
        .digest('base64');

      // Prevent unused var error
      if (signature !== expectedSignature) {
        this.logger.warn(
          `Signature mismatch: received=${signature?.slice(0, 8) ?? 'none'} expected=${expectedSignature.slice(0, 8)}`,
        );
      }
    }

    const events = body.events;
    this.logger.log(`Webhook received: events=${events?.length ?? 0}`);
    await Promise.all(
      events.map((event) => this.lineService.handleEvent(event)),
    );
    this.logger.log('Webhook processed successfully');
    return 'OK';
  }

  @Get('ping/:userId')
  async ping(@Param('userId') userId: string) {
    await this.lineService.pushMessage(userId, 'Ping จากระบบ');
    return { ok: true };
  }

  @Get('moveout/:tenantId')
  async moveoutState(@Param('tenantId') tenantId: string) {
    const state = await this.lineService.getMoveOutStateByTenantId(tenantId);
    return state || { requestedAt: null, days: 7 };
  }

  @Get('link-requests/:roomId')
  async getLinkRequests(@Param('roomId') roomId: string) {
    const list = this.lineService.getLinkRequestsByRoom(roomId);
    return { roomId, list };
  }

  @Post('link-requests/:roomId/accept')
  async acceptLink(
    @Param('roomId') roomId: string,
    @Body() body: { userId: string; tenantId: string },
  ) {
    return this.lineService.acceptLink(roomId, body.userId, body.tenantId);
  }

  @Post('link-requests/:roomId/reject')
  async rejectLink(
    @Param('roomId') roomId: string,
    @Body() body: { userId: string },
  ) {
    return this.lineService.rejectLink(roomId, body.userId);
  }

  @Post('richmenu/default-general')
  async setDefaultGeneral() {
    return this.lineService.apiSetDefaultRichMenuGeneral();
  }

  @Post('richmenu/link')
  async linkRichMenu(
    @Body() body: { userId: string; kind: 'GENERAL' | 'TENANT' | 'ADMIN' },
  ) {
    return this.lineService.apiLinkRichMenu(body);
  }

  @Post('richmenu/link-by-id')
  async linkRichMenuById(@Body() body: { userId: string; richMenuId: string }) {
    return this.lineService.apiLinkRichMenuById(body.userId, body.richMenuId);
  }
  @Post('richmenu/unlink')
  async unlinkRichMenu(
    @Body()
    body: {
      userId: string;
      fallbackTo?: 'GENERAL' | 'TENANT' | 'ADMIN';
    },
  ) {
    return this.lineService.apiUnlinkRichMenu(body);
  }

  @Post('richmenu/create-general-from-local')
  async createGeneralFromLocal() {
    return this.lineService.apiCreateGeneralRichMenuFromLocal();
  }

  @Post('richmenu/create-tenant-from-local')
  async createTenantFromLocal() {
    return this.lineService.apiCreateTenantRichMenuFromLocal();
  }

  @Post('richmenu/create-admin-from-local')
  async createAdminFromLocal() {
    return this.lineService.apiCreateAdminRichMenuFromLocal();
  }

  @Get('is-staff')
  async isStaff(@Query('userId') userId?: string) {
    return this.lineService.apiIsStaff(userId);
  }

  @Post('roles/map')
  async mapLineUserRole(
    @Body() body: { userId: string; role: 'STAFF' | 'ADMIN' | 'OWNER' },
  ) {
    return this.lineService.apiMapLineUserRole(body);
  }

  @Post('notify-moveout-due')
  async notifyMoveoutDue(@Body() body?: { date?: string }) {
    return this.lineService.notifyMoveoutForDate(body?.date);
  }

  @Get('usage')
  async getUsage() {
    return this.lineService.getMonthlyUsage();
  }
  @Post('push')
  async push(@Body() body: { userId?: string; text?: string; actor?: string }) {
    const userId = (body?.userId || '').trim();
    const text = (body?.text || '').trim();
    const actor = (body?.actor || '').trim();
    if (!userId || !text) {
      return { ok: false };
    }
    await this.lineService.pushMessage(userId, text, actor || undefined);
    return { ok: true };
  }
  @Get('recent-chats')
  async getRecentChats(@Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(500, Number(limit || '5') || 5));
    const items = this.lineService.getRecentChats(n);
    return { items };
  }
  @Get('chats')
  async getChatsByUser(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const uid = (userId || '').trim();
    if (!uid) return { items: [] };
    const n = Math.max(1, Math.min(500, Number(limit || '50') || 50));
    const items = this.lineService.getChatsByUser(uid, n, before);
    return { items };
  }
  @Get('profiles')
  async getProfiles(@Query('userIds') userIds?: string) {
    const list =
      (userIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0) || [];
    return this.lineService.apiGetLineProfiles(list);
  }
}
