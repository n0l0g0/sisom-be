import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { messagingApi, WebhookEvent } from '@line/bot-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { SlipOkService } from '../slipok/slipok.service';
import * as fs from 'fs';
import * as path from 'path';
import {
  createWriteStream,
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import {
  InvoiceStatus,
  MaintenanceStatus,
  PaymentStatus,
  Role,
} from '@prisma/client';
import Jimp from 'jimp';

type LineMessageEvent = Extract<WebhookEvent, { type: 'message' }>;
type LineImageEvent = LineMessageEvent & {
  replyToken: string;
  message: { id: string; type: 'image' };
};

type RoomContact = {
  id: string;
  name: string;
  phone: string;
  lineUserId?: string;
  createdAt?: string;
  updatedAt?: string;
};

@Injectable()
export class LineService implements OnModuleInit {
  private client: messagingApi.MessagingApiClient;
  private blobClient: messagingApi.MessagingApiBlobClient | undefined;
  private readonly logger = new Logger(LineService.name);
  private readonly channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  private readonly richMenuGeneralId =
    process.env.LINE_RICHMENU_GENERAL_ID || '';
  private readonly richMenuTenantId = process.env.LINE_RICHMENU_TENANT_ID || '';
  private readonly richMenuAdminId = process.env.LINE_RICHMENU_ADMIN_ID || '';
  private readonly adminUserIds = (process.env.LINE_ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  private readonly staffUserIds = (process.env.LINE_STAFF_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  private readonly liffId =
    process.env.NEXT_PUBLIC_LIFF_ID || process.env.LIFF_ID || '';
  private readonly projectRoot = process.cwd();
  private readonly moveOutRequests = new Map<
    string,
    {
      requestedAt: Date;
      days?: number;
      bankInfo?: {
        name?: string;
        phone?: string;
        accountNo?: string;
        bank?: string;
      };
    }
  >();
  private readonly linkRequests = new Map<
    string,
    Array<{ userId: string; phone: string; tenantId: string; createdAt: Date }>
  >();
  private readonly paymentContext = new Map<string, string>(); // userId -> invoiceId
  private readonly staffVerifyRequests = new Map<string, string>(); // line userId -> user.id
  private readonly registerPhoneContext = new Map<string, boolean>(); // line userId -> waiting for phone after REGISTERSISOM
  private readonly staffPaymentState = new Map<
    string,
    {
      buildingId?: string;
      floor?: number;
      roomId?: string;
      contractId?: string;
    }
  >(); // staff flow state
  private readonly moveoutState = new Map<
    string,
    {
      buildingId?: string;
      floor?: number;
      roomId?: string;
      contractId?: string;
      step?: 'WATER' | 'ELECTRIC';
      waterImageUrl?: string;
      electricImageUrl?: string;
    }
  >(); // move-out flow
  private readonly tenantMaintenanceState = new Map<
    string,
    {
      roomId: string;
      contractId?: string;
      tenantName?: string;
      phone?: string;
      detail?: string;
      images: string[];
      step?: 'WAIT_DETAIL' | 'ASK_IMAGE' | 'WAIT_IMAGES';
    }
  >();
  private readonly tenantMoveoutRequests = new Map<
    string,
    {
      roomId: string;
      contractId?: string;
      tenantName?: string;
      phone?: string;
      step?: 'WAIT_PLAN' | 'WAIT_REASON';
      moveoutPlan?: string;
      moveoutDate?: string;
    }
  >();
  private readonly recentChats: Array<{
    id: string;
    userId: string;
    type: 'received_text' | 'received_image' | 'sent_text' | 'sent_flex';
    text?: string;
    altText?: string;
    timestamp: string;
  }> = [];

  private async getLineNotifyTargets(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.OWNER] },
        lineUserId: { not: null },
      },
      select: { lineUserId: true, permissions: true },
    });
    const targets = users
      .filter((u) => {
        const perms = Array.isArray(u.permissions)
          ? (u.permissions as any[])
          : [];
        return perms.includes('line_notifications');
      })
      .map((u) => u.lineUserId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return Array.from(new Set(targets));
  }
  private getUsageFilePath(): string {
    const dir = path.resolve('/app/uploads');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}
    }
    return path.join(dir, 'line-usage.json');
  }
  private readUsageStore(): Record<string, any> {
    try {
      const file = this.getUsageFilePath();
      if (!fs.existsSync(file)) return {};
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trim()) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return {};
      return obj;
    } catch {
      return {};
    }
  }
  private writeUsageStore(store: Record<string, any>) {
    try {
      const file = this.getUsageFilePath();
      fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
    } catch {}
  }
  private recordMessage(kind: 'push_text' | 'push_flex') {
    const store = this.readUsageStore();
    const key = new Date().toISOString().slice(0, 7);
    const month = (store[key] || {}) as {
      push_text?: number;
      push_flex?: number;
    };
    month.push_text =
      Number(month.push_text || 0) + (kind === 'push_text' ? 1 : 0);
    month.push_flex =
      Number(month.push_flex || 0) + (kind === 'push_flex' ? 1 : 0);
    store[key] = month;
    this.writeUsageStore(store);
  }
  async getMonthlyUsage() {
    const store = this.readUsageStore();
    const key = new Date().toISOString().slice(0, 7);
    const month = (store[key] || {}) as {
      push_text?: number;
      push_flex?: number;
    };
    const pushText = Number(month.push_text || 0);
    const pushFlex = Number(month.push_flex || 0);
    const sentLocal = pushText + pushFlex;
    const limitLocal =
      Number(
        process.env.LINE_MONTHLY_FREE_LIMIT ||
          process.env.LINE_FREE_LIMIT ||
          300,
      ) || 300;
    let sentOfficial: number | undefined;
    let limitOfficial: number | undefined;
    try {
      if (this.channelAccessToken) {
        const quotaRes = await fetch(
          'https://api.line.me/v2/bot/message/quota',
          {
            headers: { Authorization: `Bearer ${this.channelAccessToken}` },
          },
        );
        if (quotaRes.ok) {
          const q = (await quotaRes.json()) as {
            type?: string;
            value?: number;
          };
          if (q?.type === 'limited' && typeof q?.value === 'number') {
            limitOfficial = q.value;
          } else if (q?.type === 'unlimited') {
            limitOfficial = 999999;
          }
        }
        const consRes = await fetch(
          'https://api.line.me/v2/bot/message/quota/consumption',
          { headers: { Authorization: `Bearer ${this.channelAccessToken}` } },
        );
        if (consRes.ok) {
          const c = (await consRes.json()) as { totalUsage?: number };
          if (typeof c?.totalUsage === 'number') {
            sentOfficial = c.totalUsage;
          }
        }
      }
    } catch {}
    const sent = typeof sentOfficial === 'number' ? sentOfficial : sentLocal;
    const limit =
      typeof limitOfficial === 'number' ? limitOfficial : limitLocal;
    const remaining = Math.max(0, limit - sent);
    const percent =
      limit > 0 ? Math.min(100, Math.round((sent / limit) * 100)) : 0;
    return {
      month: key,
      sent,
      limit,
      remaining,
      percent,
      breakdown: { pushText, pushFlex },
    };
  }
  private addRecentChat(entry: {
    userId: string;
    type: 'received_text' | 'received_image' | 'sent_text' | 'sent_flex';
    text?: string;
    altText?: string;
  }) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: entry.userId,
      type: entry.type,
      text: entry.text,
      altText: entry.altText,
      timestamp: new Date().toISOString(),
    };
    this.recentChats.push(item);
    if (this.recentChats.length > 50) {
      this.recentChats.splice(0, this.recentChats.length - 50);
    }
  }
  getRecentChats(count = 5) {
    const n = Math.max(1, Math.min(50, count || 5));
    return this.recentChats.slice(-n).reverse();
  }

  private readonly staffMaintenanceState = new Map<
    string,
    {
      maintenanceId: string;
    }
  >();

  private getGeneralRichMenuIdFromStore(): string | null {
    try {
      const metaPath = join(
        this.mediaService.getUploadDir(),
        'richmenu-general.json',
      );
      if (!existsSync(metaPath)) return null;
      const raw = readFileSync(metaPath, 'utf8');
      if (!raw.trim()) return null;
      const parsed = JSON.parse(raw);
      const id =
        parsed && typeof parsed.richMenuId === 'string'
          ? parsed.richMenuId.trim()
          : '';
      return id || null;
    } catch {
      return null;
    }
  }

  private getGeneralRichMenuId(): string | null {
    const stored = this.getGeneralRichMenuIdFromStore();
    if (stored) return stored;
    const envId = (this.richMenuGeneralId || '').trim();
    return envId || null;
  }

  private readonly paymentContextTimers = new Map<string, NodeJS.Timeout>();
  private readonly moveoutTimers = new Map<string, NodeJS.Timeout>();
  private readonly tenantMoveoutTimers = new Map<string, NodeJS.Timeout>();
  private readonly staffPaymentTimers = new Map<string, NodeJS.Timeout>();
  private readonly registerPhoneTimers = new Map<string, NodeJS.Timeout>();
  private readonly tenantMaintenanceTimers = new Map<string, NodeJS.Timeout>();
  private readonly staffMaintenanceTimers = new Map<string, NodeJS.Timeout>();

  private setPaymentContextWithTimeout(userId: string, invoiceId: string) {
    this.paymentContext.set(userId, invoiceId);
    const prev = this.paymentContextTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.paymentContextTimers.delete(userId);
    }
    const t = setTimeout(() => {
      this.paymentContext.delete(userId);
      this.paymentContextTimers.delete(userId);
      this.pushMessage(userId, 'หมดเวลาส่งสลิป กรุณาเลือกห้องอีกครั้ง').catch(
        () => {},
      );
    }, 180_000);
    this.paymentContextTimers.set(userId, t);
  }

  private startMoveoutTimer(userId: string) {
    const prev = this.moveoutTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.moveoutTimers.delete(userId);
    }
    const t = setTimeout(() => {
      this.moveoutState.delete(userId);
      this.moveoutTimers.delete(userId);
      this.pushMessage(userId, 'หมดเวลาส่งรูป กรุณาเริ่มแจ้งย้ายออกใหม่').catch(
        () => {},
      );
    }, 180_000);
    this.moveoutTimers.set(userId, t);
  }

  private clearMoveoutTimer(userId: string) {
    const prev = this.moveoutTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.moveoutTimers.delete(userId);
    }
  }

  private startTenantMoveoutTimer(userId: string) {
    const prev = this.tenantMoveoutTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.tenantMoveoutTimers.delete(userId);
    }
    const t = setTimeout(() => {
      this.tenantMoveoutRequests.delete(userId);
      this.tenantMoveoutTimers.delete(userId);
      this.pushMessage(
        userId,
        'หมดเวลาทำรายการแจ้งย้ายออก กรุณาเริ่มแจ้งย้ายออกใหม่อีกครั้ง',
      ).catch(() => {});
    }, 180_000);
    this.tenantMoveoutTimers.set(userId, t);
  }

  private clearTenantMoveoutTimer(userId: string) {
    const prev = this.tenantMoveoutTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.tenantMoveoutTimers.delete(userId);
    }
  }

  private startStaffPaymentTimer(userId: string) {
    const prev = this.staffPaymentTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.staffPaymentTimers.delete(userId);
    }
    const t = setTimeout(() => {
      this.staffPaymentState.delete(userId);
      this.staffPaymentTimers.delete(userId);
      this.pushMessage(
        userId,
        'หมดเวลาทำรายการชำระบิล กรุณาเริ่มใหม่จากเมนูชำระเงิน',
      ).catch(() => {});
    }, 180_000);
    this.staffPaymentTimers.set(userId, t);
  }

  private clearStaffPaymentTimer(userId: string) {
    const prev = this.staffPaymentTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.staffPaymentTimers.delete(userId);
    }
  }

  private startRegisterPhoneTimer(userId: string) {
    const prev = this.registerPhoneTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.registerPhoneTimers.delete(userId);
    }
    const t = setTimeout(() => {
      this.registerPhoneContext.delete(userId);
      this.registerPhoneTimers.delete(userId);
      this.pushMessage(
        userId,
        'หมดเวลาส่งเบอร์โทร กรุณาเริ่มคำสั่ง REGISTERSISOM ใหม่อีกครั้ง',
      ).catch(() => {});
    }, 180_000);
    this.registerPhoneTimers.set(userId, t);
  }

  private clearRegisterPhoneTimer(userId: string) {
    const prev = this.registerPhoneTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.registerPhoneTimers.delete(userId);
    }
  }

  private startTenantMaintenanceTimer(userId: string) {
    const prev = this.tenantMaintenanceTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.tenantMaintenanceTimers.delete(userId);
    }
    const t = setTimeout(() => {
      this.tenantMaintenanceState.delete(userId);
      this.tenantMaintenanceTimers.delete(userId);
      this.pushMessage(
        userId,
        'หมดเวลาทำรายการแจ้งซ่อม กรุณาเริ่มแจ้งซ่อมใหม่อีกครั้ง',
      ).catch(() => {});
    }, 180_000);
    this.tenantMaintenanceTimers.set(userId, t);
  }

  private clearTenantMaintenanceTimer(userId: string) {
    const prev = this.tenantMaintenanceTimers.get(userId);
    if (prev) {
      clearTimeout(prev);
      this.tenantMaintenanceTimers.delete(userId);
    }
  }

  private async notifyStaffMaintenanceCreated(maintenanceId: string) {
    const maintenance = await this.prisma.maintenanceRequest.findUnique({
      where: { id: maintenanceId },
      include: {
        room: {
          include: {
            building: true,
          },
        },
      },
    });
    if (!maintenance || !maintenance.room) return;
    const room = maintenance.room;
    const buildingName = room.building?.name || room.building?.code || '-';
    const locationLine = `ตึก ${buildingName} ชั้น ${room.floor} ห้อง ${room.number}`;
    const descText = maintenance.description || '';
    const bodyLines = [
      'มีรายการแจ้งซ่อมใหม่',
      locationLine,
      descText,
      'กรุณาเลือกสถานะปิดงานภายใน 2 นาที',
    ].filter((v) => v && v.trim().length > 0);
    const flex: any = {
      type: 'flex',
      altText: 'มีรายการแจ้งซ่อมใหม่',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: bodyLines.map((t) => ({
            type: 'text',
            text: t,
            wrap: true,
          })),
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#00B900',
              action: {
                type: 'postback',
                label: 'เสร็จแล้ว',
                data: `MAINT_DONE=${maintenance.id}`,
                displayText: 'ปิดงานแจ้งซ่อม: เสร็จแล้ว',
              },
            },
            {
              type: 'button',
              style: 'secondary',
              color: '#666666',
              action: {
                type: 'postback',
                label: 'ยังไม่เสร็จ',
                data: `MAINT_NOT_DONE=${maintenance.id}`,
                displayText: 'ปิดงานแจ้งซ่อม: ยังไม่เสร็จ',
              },
            },
          ],
        },
      },
    };
    const targets = await this.getLineNotifyTargets();
    for (const uid of targets) {
      if (!uid) continue;
      this.setStaffMaintenanceState(uid, maintenance.id);
      await this.pushFlex(uid, flex);
    }
  }

  private setStaffMaintenanceState(userId: string, maintenanceId: string) {
    const key = `${userId}:${maintenanceId}`;
    this.staffMaintenanceState.set(key, { maintenanceId });
    const prev = this.staffMaintenanceTimers.get(key);
    if (prev) {
      clearTimeout(prev);
      this.staffMaintenanceTimers.delete(key);
    }
    const t = setTimeout(() => {
      this.staffMaintenanceState.delete(key);
      this.staffMaintenanceTimers.delete(key);
      this.pushMessage(
        userId,
        'หมดเวลาทำรายการปิดงานสำหรับแจ้งซ่อมนี้แล้ว',
      ).catch(() => {});
    }, 120_000);
    this.staffMaintenanceTimers.set(key, t);
  }

  private clearStaffMaintenanceStateForMaintenance(maintenanceId: string) {
    const entries = Array.from(this.staffMaintenanceState.entries());
    for (const [key, value] of entries) {
      if (value.maintenanceId === maintenanceId) {
        const prev = this.staffMaintenanceTimers.get(key);
        if (prev) {
          clearTimeout(prev);
          this.staffMaintenanceTimers.delete(key);
        }
        this.staffMaintenanceState.delete(key);
      }
    }
  }

  createInvoiceFlexMessage(invoice: any, room: any, tenant: any) {
    const liffUrl = `https://liff.line.me/${this.liffId}/bills/${invoice.id}`;
    const monthName = new Date(invoice.year, invoice.month - 1).toLocaleString(
      'th-TH',
      { month: 'long', year: 'numeric' },
    );

    return {
      type: 'flex',
      altText: `แจ้งยอดค่าห้องประจำเดือน ${monthName}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'แจ้งยอดค่าห้อง',
              weight: 'bold',
              size: 'xl',
              color: '#FFFFFF',
            },
            {
              type: 'text',
              text: monthName,
              size: 'sm',
              color: '#FFFFFFCC',
            },
          ],
          backgroundColor: '#FF6413',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: `ห้อง ${room.number}`,
                  size: 'lg',
                  weight: 'bold',
                },
                {
                  type: 'text',
                  text: `ผู้เช่า: ${tenant.name}`,
                  size: 'sm',
                  color: '#555555',
                },
              ],
            },
            {
              type: 'separator',
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                this.createDetailRow('ค่าเช่า', invoice.rentAmount),
                this.createDetailRow('ค่าน้ำ', invoice.waterAmount),
                this.createDetailRow('ค่าไฟ', invoice.electricAmount),
                this.createDetailRow('ค่าส่วนกลาง', invoice.otherFees),
              ],
            },
            {
              type: 'separator',
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'ยอดรวม',
                  weight: 'bold',
                  size: 'lg',
                },
                {
                  type: 'text',
                  text: `฿${Number(invoice.totalAmount).toLocaleString()}`,
                  weight: 'bold',
                  size: 'lg',
                  align: 'end',
                },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: {
                type: 'uri',
                label: 'ดูรายละเอียดและชำระเงิน',
                uri: liffUrl,
              },
              style: 'primary',
              color: '#FF6413',
            },
          ],
        },
      },
    };
  }

  private createDetailRow(label: string, amount: number) {
    return {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: label,
          size: 'sm',
          color: '#555555',
        },
        {
          type: 'text',
          text: `฿${Number(amount).toLocaleString()}`,
          size: 'sm',
          color: '#111111',
          align: 'end',
        },
      ],
    };
  }

  logError(message: string, meta?: any) {
    this.logger.error(message, meta);
  }

  async notifyTenantMaintenanceCompleted(maintenanceId: string) {
    const maintenance = await this.prisma.maintenanceRequest.findUnique({
      where: { id: maintenanceId },
      include: {
        room: {
          include: {
            building: true,
            contracts: {
              where: { isActive: true },
              include: { tenant: true },
              orderBy: { startDate: 'desc' },
            },
          },
        },
      },
    });
    if (!maintenance || !maintenance.room) return;
    const room: any = maintenance.room;
    const contracts: any[] = Array.isArray(room.contracts)
      ? room.contracts
      : [];
    const active =
      contracts.find((c) => c.isActive && c.tenant?.lineUserId) || contracts[0];
    const tenant = active?.tenant;
    const lineUserId: string | undefined = tenant?.lineUserId || undefined;
    if (!lineUserId) return;

    const buildingName = room.building?.name || room.building?.code || '';
    const locationLine = buildingName
      ? `ตึก ${buildingName} ชั้น ${room.floor} ห้อง ${room.number}`
      : `ห้อง ${room.number}`;
    const title = maintenance.title || 'แจ้งซ่อม';
    const descFirstLine = (maintenance.description || '')
      .split('\n')
      .find((s) => s.trim().length > 0);

    const flex: any = {
      type: 'flex',
      altText: 'งานแจ้งซ่อมเสร็จเรียบร้อยแล้ว',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: '🔧 งานแจ้งซ่อมเสร็จแล้ว',
                  weight: 'bold',
                  size: 'md',
                  color: '#00B900',
                  wrap: true,
                },
              ],
            },
            {
              type: 'text',
              text: locationLine,
              size: 'sm',
              color: '#555555',
              wrap: true,
              margin: 'md',
            },
            {
              type: 'text',
              text: `รายการ: ${title}`,
              size: 'sm',
              color: '#333333',
              wrap: true,
              margin: 'sm',
            },
            ...(descFirstLine
              ? [
                  {
                    type: 'text',
                    text: descFirstLine,
                    size: 'sm',
                    color: '#555555',
                    wrap: true,
                    margin: 'sm',
                  },
                ]
              : []),
            {
              type: 'separator',
              margin: 'md',
            },
            {
              type: 'text',
              text: 'หากยังพบปัญหาเดิม สามารถกดเมนู “แจ้งซ่อม” เพื่อส่งคำขอใหม่ได้ทุกเมื่อครับ',
              size: 'xs',
              color: '#888888',
              wrap: true,
              margin: 'md',
            },
          ],
        },
      },
    };

    await this.pushFlex(lineUserId, flex);
  }

  private hasBlockingFlow(userId: string): boolean {
    if (!userId) return false;
    if (this.paymentContext.get(userId)) return true;
    if (this.moveoutState.get(userId)) return true;
    if (this.tenantMoveoutRequests.get(userId)) return true;
    if (this.registerPhoneContext.get(userId)) return true;
    if (this.tenantMaintenanceState.get(userId)) return true;
    const staffPay = this.staffPaymentState.get(userId);
    if (staffPay && (staffPay.buildingId || staffPay.floor || staffPay.roomId))
      return true;
    return false;
  }

  private async handlePhoneRegistration(
    variants: string[],
    userId: string | null | undefined,
    replyToken: string,
  ) {
    const contactMatch = this.findRoomContactByPhones(variants);
    if (contactMatch && userId) {
      const store = this.readRoomContactsStore() || {};
      const list = store[contactMatch.roomId] || [];
      const idx = list.findIndex((c) => c.id === contactMatch.contact.id);
      if (idx >= 0) {
        const existing = list[idx];
        if (existing.lineUserId) {
          if (existing.lineUserId === userId) {
            return this.replyText(
              replyToken,
              'บัญชี LINE นี้เชื่อมกับห้องพักเรียบร้อยแล้ว',
            );
          }
          return this.replyText(
            replyToken,
            'เบอร์นี้ถูกใช้เชื่อมกับ LINE บัญชีอื่นแล้ว หากต้องการเปลี่ยน กรุณาติดต่อผู้ดูแล',
          );
        }
        const now = new Date().toISOString();
        const updated: RoomContact = {
          ...existing,
          lineUserId: userId,
          updatedAt: now,
        };
        const nextList = [...list];
        nextList[idx] = updated;
        store[contactMatch.roomId] = nextList;
        this.writeRoomContactsStore(store);
        if (this.isStaffUser(userId)) {
          await this.linkMenuForUser(userId, 'ADMIN');
        } else {
          await this.linkMenuForUser(userId, 'TENANT');
        }
        return this.replyText(
          replyToken,
          `เชื่อมบัญชี LINE กับห้องพักเรียบร้อยแล้ว (${updated.name || updated.phone})`,
        );
      }
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: {
        OR: variants.map((p) => ({ phone: p })),
      },
    });

    if (!tenant) {
      const message = [
        'ไม่พบข้อมูลในระบบ',
        '',
        'หากมีการเปลี่ยนเบอร์โทร กรุณาเขียนเบอร์ใหม่ลงบนบิลค่าเช่า แล้วถ่ายรูปส่งกลับทางไลน์',
        '',
        'หากต้องการเพิ่มผู้เชื่อมต่อ กรุณาเขียนชื่อ–เบอร์โทร ลงบนบิล แล้วถ่ายรูปส่งมาอีกครั้ง',
      ].join('\n');
      return this.replyText(replyToken, message);
    }

    if (tenant.lineUserId) {
      if (tenant.lineUserId === userId) {
        const msg = [
          'เชื่อมต่อสำเร็จ 🎉',
          'ยินดีต้อนรับสู่ หอพักสีส้ม 🧡',
          'บัญชี LINE ของคุณเชื่อมต่อเรียบร้อยแล้ว',
          'สามารถใช้งานบริการต่าง ๆ ผ่านไลน์ได้ทันทีค่ะ/ครับ',
        ].join('\n');
        return this.replyText(replyToken, msg);
      }
      return this.replyText(
        replyToken,
        'เบอร์นี้ถูกใช้เชื่อมกับ LINE บัญชีอื่นแล้ว หากต้องการเปลี่ยน กรุณาติดต่อผู้ดูแล',
      );
    }

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { lineUserId: userId || undefined },
    });
    if (userId) {
      if (this.isStaffUser(userId)) {
        await this.linkMenuForUser(userId, 'ADMIN');
      } else {
        await this.linkMenuForUser(userId, 'TENANT');
      }
    }

    const msg = [
      'เชื่อมต่อสำเร็จ 🎉',
      'ยินดีต้อนรับสู่ หอพักสีส้ม 🧡',
      'บัญชี LINE ของคุณเชื่อมต่อเรียบร้อยแล้ว',
      'สามารถใช้งานบริการต่าง ๆ ผ่านไลน์ได้ทันทีค่ะ/ครับ',
    ].join('\n');
    return this.replyText(replyToken, msg);
  }

  private getRoomContactsFilePath() {
    const uploadsDir = resolve('/app/uploads');
    if (!existsSync(uploadsDir)) {
      try {
        mkdirSync(uploadsDir, { recursive: true });
      } catch {}
    }
    return join(uploadsDir, 'room-contacts.json');
  }

  private readRoomContactsStore(): Record<string, RoomContact[]> | null {
    try {
      const p = this.getRoomContactsFilePath();
      if (!existsSync(p)) return {};
      const raw = readFileSync(p, 'utf8');
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Record<string, RoomContact[]>;
    } catch {
      return {};
    }
  }

  private writeRoomContactsStore(store: Record<string, RoomContact[]>) {
    try {
      const p = this.getRoomContactsFilePath();
      writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
    } catch {}
  }

  private findRoomContactByPhones(variants: string[]) {
    const store = this.readRoomContactsStore() || {};
    for (const [roomId, list] of Object.entries(store)) {
      for (const c of list) {
        if (variants.includes(c.phone)) {
          return { roomId, contact: c };
        }
      }
    }
    return null;
  }

  private findRoomContactsByLineUserId(userId: string) {
    if (!userId) return [];
    const store = this.readRoomContactsStore() || {};
    const results: Array<{ roomId: string; contact: RoomContact }> = [];
    for (const [roomId, list] of Object.entries(store)) {
      for (const c of list || []) {
        if (c.lineUserId === userId) {
          results.push({ roomId, contact: c });
        }
      }
    }
    return results;
  }

  constructor(
    private prisma: PrismaService,
    private mediaService: MediaService,
    private slipOk: SlipOkService,
  ) {
    if (this.channelAccessToken) {
      this.client = new messagingApi.MessagingApiClient({
        channelAccessToken: this.channelAccessToken,
      });
      this.blobClient = new messagingApi.MessagingApiBlobClient({
        channelAccessToken: this.channelAccessToken,
      });
    } else {
      this.logger.warn('LINE_CHANNEL_ACCESS_TOKEN is not set');
    }
  }

  async onModuleInit() {
    const users = await this.prisma.user.findMany({
      where: {
        lineUserId: { not: null },
        role: { in: [Role.ADMIN, Role.OWNER] },
      },
    });
    for (const u of users) {
      if (u.lineUserId) {
        if (!this.adminUserIds.includes(u.lineUserId)) {
          this.adminUserIds.push(u.lineUserId);
        }
        if (!this.staffUserIds.includes(u.lineUserId)) {
          this.staffUserIds.push(u.lineUserId);
        }
      }
    }
    this.logger.log(`Loaded ${users.length} admin/owner users from DB`);
  }

  private async setDefaultRichMenuGeneral() {
    if (!this.client) return;
    const generalId = this.getGeneralRichMenuId();
    if (!generalId) return;
    try {
      await this.client.setDefaultRichMenu(generalId);
      this.logger.log('Default Rich Menu set to GENERAL');
    } catch (e) {
      this.logger.warn(
        `setDefaultRichMenu error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async setDefaultRichMenu(richMenuId: string) {
    if (!this.client || !richMenuId) return;
    try {
      await this.client.setDefaultRichMenu(richMenuId);
    } catch (e) {
      this.logger.warn(
        `setDefaultRichMenu(id) error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async linkRichMenu(userId: string, richMenuId: string) {
    if (!this.client || !userId || !richMenuId) return;
    try {
      await this.client.linkRichMenuIdToUser(userId, richMenuId);
    } catch (e) {
      this.logger.warn(
        `linkRichMenu error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async unlinkRichMenu(userId: string) {
    if (!this.client || !userId) return;
    try {
      await this.client.unlinkRichMenuIdFromUser(userId);
    } catch (e) {
      this.logger.warn(
        `unlinkRichMenu error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async linkMenuForUser(
    userId: string,
    kind: 'GENERAL' | 'TENANT' | 'ADMIN',
  ) {
    if (kind === 'ADMIN' && this.richMenuAdminId) {
      return this.linkRichMenu(userId, this.richMenuAdminId);
    }
    if (kind === 'TENANT' && this.richMenuTenantId) {
      return this.linkRichMenu(userId, this.richMenuTenantId);
    }
    if (kind === 'GENERAL') {
      const generalId = this.getGeneralRichMenuId();
      if (generalId) {
        return this.linkRichMenu(userId, generalId);
      }
    }
  }

  private normalizeUserIdForCompare(userId: string): string {
    return userId.trim().toLowerCase().replace(/^u/, '');
  }
  private isAdminUser(userId?: string | null): boolean {
    if (!userId) return false;
    const target = this.normalizeUserIdForCompare(userId);
    return this.adminUserIds.some(
      (id) => this.normalizeUserIdForCompare(id) === target,
    );
  }
  private isStaffUser(userId?: string | null): boolean {
    if (!userId) return false;
    const target = this.normalizeUserIdForCompare(userId);
    const inStaff = this.staffUserIds.some(
      (id) => this.normalizeUserIdForCompare(id) === target,
    );
    if (inStaff) return true;
    return this.isAdminUser(userId);
  }

  isStaff(userId?: string | null): boolean {
    return this.isStaffUser(userId);
  }

  async handleEvent(event: WebhookEvent) {
    if (event.type === 'postback') {
      const userId = event.source.userId;
      const data = (event.postback?.data || '').trim();
      const params = event.postback?.params as
        | { date?: string; time?: string; datetime?: string }
        | undefined;
      if (userId && data.startsWith('MAINT_DONE=')) {
        if (!this.isStaffUser(userId)) return null;
        const maintenanceId = data.split('=')[1] || '';
        if (!maintenanceId) return null;
        const key = `${userId}:${maintenanceId}`;
        const state = this.staffMaintenanceState.get(key);
        if (!state) {
          await this.replyText(
            event.replyToken,
            'หมดเวลาทำรายการปิดงานสำหรับแจ้งซ่อมนี้แล้ว หรือรายการนี้ถูกดำเนินการไปแล้ว',
          );
          return null;
        }
        this.clearStaffMaintenanceStateForMaintenance(maintenanceId);
        await this.prisma.maintenanceRequest.update({
          where: { id: maintenanceId },
          data: {
            status: MaintenanceStatus.COMPLETED,
            resolvedAt: new Date(),
          },
        });
        await this.replyText(
          event.replyToken,
          'บันทึกสถานะงานแจ้งซ่อมเป็น เสร็จแล้ว เรียบร้อย',
        );
        return null;
      }
      if (userId && data.startsWith('MAINT_NOT_DONE=')) {
        if (!this.isStaffUser(userId)) return null;
        const maintenanceId = data.split('=')[1] || '';
        if (!maintenanceId) return null;
        const key = `${userId}:${maintenanceId}`;
        const state = this.staffMaintenanceState.get(key);
        if (!state) {
          await this.replyText(
            event.replyToken,
            'หมดเวลาทำรายการปิดงานสำหรับแจ้งซ่อมนี้แล้ว หรือรายการนี้ถูกดำเนินการไปแล้ว',
          );
          return null;
        }
        this.clearStaffMaintenanceStateForMaintenance(maintenanceId);
        await this.prisma.maintenanceRequest.update({
          where: { id: maintenanceId },
          data: {
            status: MaintenanceStatus.IN_PROGRESS,
          },
        });
        await this.replyText(
          event.replyToken,
          'บันทึกสถานะงานแจ้งซ่อมเป็น ยังไม่เสร็จ เรียบร้อย',
        );
        return null;
      }
      if (userId && data === 'TENANT_MOVEOUT_DATE') {
        const date = params?.date;
        if (!date) {
          return null;
        }
        const pending = this.tenantMoveoutRequests.get(userId || '');
        if (!pending) {
          return null;
        }
        pending.moveoutDate = date;
        pending.moveoutPlan = `วันที่ ${date}`;
        pending.step = 'WAIT_REASON';
        this.tenantMoveoutRequests.set(userId || '', pending);
        await this.replyText(
          event.replyToken,
          'บันทึกวันที่ย้ายออกจากปฏิทินแล้ว กรุณาพิมพ์เหตุผลการย้ายออก เช่น ย้ายที่ทำงาน ย้ายที่เรียน หรืออื่น ๆ',
        );
        return null;
      }
      if (userId && data.startsWith('MOVEOUT_DAYS=')) {
        const days = Number(data.split('=')[1] || '7') || 7;
        const prev = this.moveOutRequests.get(userId) || {
          requestedAt: new Date(),
        };
        this.moveOutRequests.set(userId, { ...prev, days });
        await this.pushMessage(
          userId,
          `บันทึกกำหนดโอนคืนเงินประกันภายใน ${days} วันเรียบร้อย\nกรุณาส่งข้อมูลบัญชีเพื่อรับเงินคืนในรูปแบบ:\nชื่อ-นามสกุล: ...\nเบอร์โทรศัพท์: ...\nเลขบัญชี: ...\nธนาคาร: ...`,
        );
        return null;
      }
      if (userId && data.startsWith('LINK_ACCEPT=')) {
        const payload = data.split('=')[1] || '';
        const [roomId, tenantId] = payload.split(':');
        if (roomId && tenantId) {
          await this.acceptLink(roomId, userId, tenantId);
        }
        return null;
      }
      if (userId && data.startsWith('LINK_REJECT=')) {
        const roomId = data.split('=')[1] || '';
        if (roomId) {
          await this.rejectLink(roomId, userId);
        }
        return null;
      }
      if (userId && data.startsWith('PAY_BUILDING=')) {
        if (!this.isStaffUser(userId)) return null;
        const buildingId = data.split('=')[1] || '';
        const prevB = this.staffPaymentState.get(userId || '') || {};
        this.staffPaymentState.set(userId || '', { ...prevB, buildingId });
        this.startStaffPaymentTimer(userId || '');
        const invoices = await this.prisma.invoice.findMany({
          where: {
            status: {
              in: [
                InvoiceStatus.SENT,
                InvoiceStatus.DRAFT,
                InvoiceStatus.OVERDUE,
              ],
            },
            contract: { room: { buildingId } },
          },
          include: { contract: { include: { room: true } } },
        });
        const floors = Array.from(
          new Set(
            invoices
              .map((inv) => inv.contract?.room?.floor)
              .filter((f) => typeof f === 'number'),
          ),
        ).sort((a, b) => a - b);
        if (floors.length === 0) {
          await this.replyText(event.replyToken, 'ไม่มีห้องค้างชำระในตึกนี้');
          return null;
        }
        const message: any = {
          type: 'flex',
          altText: 'เลือกชั้น',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                { type: 'text', text: 'เลือกชั้น', weight: 'bold', size: 'lg' },
                ...floors.map((f) => ({
                  type: 'button',
                  style: 'primary',
                  color: '#00B900',
                  action: {
                    type: 'postback',
                    label: `ชั้น ${f}`,
                    data: `PAY_FLOOR=${buildingId}:${f}`,
                    displayText: `ชั้น ${f}`,
                  },
                })),
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  style: 'secondary',
                  color: '#666666',
                  action: {
                    type: 'postback',
                    label: 'ย้อนกลับ',
                    data: 'PAY_BACK=BUILDINGS',
                    displayText: 'ย้อนกลับ',
                  },
                },
              ],
            },
          },
        };
        await this.pushFlex(userId, message);
        return null;
      }
      if (userId && data.startsWith('PAY_FLOOR=')) {
        if (!this.isStaffUser(userId)) return null;
        const payload = data.split('=')[1] || '';
        const [buildingId, floorStr] = payload.split(':');
        const floor = Number(floorStr || '0');
        const prevF = this.staffPaymentState.get(userId || '') || {};
        if (!prevF.buildingId || prevF.buildingId !== buildingId) {
          await this.replyText(
            event.replyToken,
            'หมดเวลาทำรายการชำระบิล หรือข้อมูลตึกไม่ถูกต้อง กรุณาเริ่มใหม่จากเมนูรับชำระเงิน',
          );
          return null;
        }
        this.staffPaymentState.set(userId || '', {
          ...prevF,
          buildingId,
          floor,
        });
        this.startStaffPaymentTimer(userId || '');
        const invoices = await this.prisma.invoice.findMany({
          where: {
            status: {
              in: [
                InvoiceStatus.SENT,
                InvoiceStatus.DRAFT,
                InvoiceStatus.OVERDUE,
              ],
            },
            contract: { room: { buildingId, floor } },
          },
          include: { contract: { include: { room: true } } },
          orderBy: { createdAt: 'asc' },
        });
        const roomList = Array.from(
          new Map(
            invoices
              .map((inv) => inv.contract?.room)
              .filter((r) => !!r)
              .map((r) => [r.id, r]),
          ).values(),
        ).sort((a, b) => (a.number || '').localeCompare(b.number || ''));
        if (roomList.length === 0) {
          await this.replyText(
            event.replyToken,
            `ไม่มีห้องค้างชำระในชั้น ${floor}`,
          );
          return null;
        }
        const message: any = {
          type: 'flex',
          altText: 'เลือกห้อง',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: `เลือกห้อง ชั้น ${floor}`,
                  weight: 'bold',
                  size: 'lg',
                },
                ...roomList.slice(0, 12).map((r) => ({
                  type: 'button',
                  style: 'primary',
                  color: '#FF6413',
                  action: {
                    type: 'postback',
                    label: `ห้อง ${r.number}`,
                    data: `PAY_ROOM=${r.id}`,
                    displayText: `ห้อง ${r.number}`,
                  },
                })),
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  style: 'secondary',
                  color: '#666666',
                  action: {
                    type: 'postback',
                    label: 'ย้อนกลับ',
                    data: `PAY_BACK=FLOORS:${buildingId}`,
                    displayText: 'ย้อนกลับ',
                  },
                },
              ],
            },
          },
        };
        await this.pushFlex(userId, message);
        return null;
      }
      if (userId && data.startsWith('PAY_BACK=')) {
        if (!this.isStaffUser(userId)) return null;
        const payload = data.split('=')[1] || '';
        if (payload === 'BUILDINGS') {
          const buildings = await this.prisma.building.findMany({
            orderBy: { name: 'asc' },
          });
          if (buildings.length === 0) {
            await this.replyText(event.replyToken, 'ยังไม่มีข้อมูลตึก');
            return null;
          }
          const message: any = {
            type: 'flex',
            altText: 'เลือกตึก',
            contents: {
              type: 'bubble',
              body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: 'เลือกตึก',
                    weight: 'bold',
                    size: 'lg',
                  },
                  ...buildings.slice(0, 12).map((b) => ({
                    type: 'button',
                    style: 'primary',
                    color: '#00B900',
                    action: {
                      type: 'postback',
                      label: b.name,
                      data: `PAY_BUILDING=${b.id}`,
                      displayText: b.name,
                    },
                  })),
                ],
              },
            },
          };
          await this.pushFlex(userId, message);
          return null;
        }
        if (payload.startsWith('FLOORS:')) {
          const buildingId = payload.split(':')[1] || '';
          const invoices = await this.prisma.invoice.findMany({
            where: {
              status: {
                in: [
                  InvoiceStatus.SENT,
                  InvoiceStatus.DRAFT,
                  InvoiceStatus.OVERDUE,
                ],
              },
              contract: { room: { buildingId } },
            },
            include: { contract: { include: { room: true } } },
          });
          const floors = Array.from(
            new Set(
              invoices
                .map((inv) => inv.contract?.room?.floor)
                .filter((f) => typeof f === 'number'),
            ),
          ).sort((a, b) => a - b);
          if (floors.length === 0) {
            await this.replyText(event.replyToken, 'ไม่มีห้องค้างชำระในตึกนี้');
            return null;
          }
          const message: any = {
            type: 'flex',
            altText: 'เลือกชั้น',
            contents: {
              type: 'bubble',
              body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: 'เลือกชั้น',
                    weight: 'bold',
                    size: 'lg',
                  },
                  ...floors.map((f) => ({
                    type: 'button',
                    style: 'primary',
                    color: '#00B900',
                    action: {
                      type: 'postback',
                      label: `ชั้น ${f}`,
                      data: `PAY_FLOOR=${buildingId}:${f}`,
                      displayText: `ชั้น ${f}`,
                    },
                  })),
                ],
              },
            },
          };
          await this.pushFlex(userId, message);
          return null;
        }
        return null;
      }
      if (userId && data.startsWith('PAY_ROOM=')) {
        if (!this.isStaffUser(userId)) return null;
        const currentState = this.staffPaymentState.get(userId || '');
        if (
          !currentState?.buildingId ||
          typeof currentState.floor !== 'number'
        ) {
          await this.replyText(
            event.replyToken,
            'หมดเวลาทำรายการชำระบิล หรือยังไม่ได้เลือกตึก/ชั้น กรุณาเริ่มใหม่จากเมนูรับชำระเงิน',
          );
          return null;
        }
        const roomId = data.split('=')[1] || '';
        const prev = this.staffPaymentState.get(userId || '') || {};
        this.staffPaymentState.set(userId || '', { ...prev, roomId });
        this.startStaffPaymentTimer(userId || '');
        const contract = await this.prisma.contract.findFirst({
          where: { roomId, isActive: true },
          include: { room: true },
        });
        if (!contract) {
          await this.pushMessage(
            userId,
            'ไม่พบสัญญาที่ใช้งานอยู่สำหรับห้องนี้',
          );
          return null;
        }
        this.staffPaymentState.set(userId || '', {
          ...prev,
          roomId,
          contractId: contract.id,
        });
        const invoice = await this.prisma.invoice.findFirst({
          where: {
            contractId: contract.id,
            status: {
              in: [
                InvoiceStatus.SENT,
                InvoiceStatus.DRAFT,
                InvoiceStatus.OVERDUE,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!invoice) {
          await this.pushMessage(userId, 'ไม่มีบิลค้างชำระสำหรับห้องนี้');
          return null;
        }
        this.setPaymentContextWithTimeout(userId, invoice.id);
        const monthLabel = `${this.thaiMonth(invoice.month)} ${invoice.year}`;
        const amount = Number(invoice.totalAmount).toLocaleString();
        const flex = this.buildPayInfoFlex({
          room: contract.room.number,
          period: monthLabel,
          amount,
          bankName: 'ธนาคารไทยพาณิชย์',
          accountName: 'นาง สุนีย์ วงษ์จะบก',
          accountNo: '800-253388-7',
        });
        await this.pushFlex(userId, flex);
        return null;
      }
      // Move-out flow
      if (userId && data.startsWith('MO_BUILDING=')) {
        if (!this.isStaffUser(userId)) return null;
        const buildingId = data.split('=')[1] || '';
        const prev = this.moveoutState.get(userId || '') || {};
        this.moveoutState.set(userId || '', {
          ...prev,
          buildingId,
          step: undefined,
          waterImageUrl: undefined,
          electricImageUrl: undefined,
        });
        const contracts = await this.prisma.contract.findMany({
          where: { isActive: true, room: { buildingId } },
          include: { room: true },
        });
        const floors = Array.from(
          new Set(
            contracts
              .map((c) => c.room?.floor)
              .filter((f) => typeof f === 'number'),
          ),
        ).sort((a, b) => a - b);
        if (floors.length === 0) {
          await this.replyText(
            event.replyToken,
            'ไม่พบชั้นที่มีผู้เช่าปัจจุบันในตึกนี้',
          );
          return null;
        }
        const message: any = {
          type: 'flex',
          altText: 'เลือกชั้น (ย้ายออก)',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'แจ้งย้ายออก: เลือกชั้น',
                  weight: 'bold',
                  size: 'lg',
                },
                ...floors.map((f) => ({
                  type: 'button',
                  style: 'primary',
                  color: '#d35400',
                  action: {
                    type: 'postback',
                    label: `ชั้น ${f}`,
                    data: `MO_FLOOR=${buildingId}:${f}`,
                    displayText: `ชั้น ${f}`,
                  },
                })),
              ],
            },
          },
        };
        await this.pushFlex(userId, message);
        return null;
      }
      if (userId && data.startsWith('MO_FLOOR=')) {
        if (!this.isStaffUser(userId)) return null;
        const payload = data.split('=')[1] || '';
        const [buildingId, floorStr] = payload.split(':');
        const floor = Number(floorStr || '0');
        const prev = this.moveoutState.get(userId || '') || {};
        this.moveoutState.set(userId || '', {
          ...prev,
          buildingId,
          floor,
          step: undefined,
          waterImageUrl: undefined,
          electricImageUrl: undefined,
        });
        const contracts = await this.prisma.contract.findMany({
          where: { isActive: true, room: { buildingId, floor } },
          include: { room: true, tenant: true },
          orderBy: { startDate: 'asc' },
        });
        const roomList = Array.from(
          new Map(
            contracts
              .map((c) => c.room)
              .filter((r) => !!r)
              .map((r) => [r.id, r]),
          ).values(),
        ).sort((a, b) =>
          (a.number || '').localeCompare(b.number || '', undefined, {
            numeric: true,
          }),
        );
        if (roomList.length === 0) {
          await this.replyText(
            event.replyToken,
            `ไม่พบห้องที่มีผู้เช่าในชั้น ${floor}`,
          );
          return null;
        }
        const message: any = {
          type: 'flex',
          altText: 'เลือกห้อง (ย้ายออก)',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: `แจ้งย้ายออก: ชั้น ${floor}`,
                  weight: 'bold',
                  size: 'lg',
                },
                ...roomList.slice(0, 12).map((r) => ({
                  type: 'button',
                  style: 'primary',
                  color: '#e67e22',
                  action: {
                    type: 'postback',
                    label: `ห้อง ${r.number}`,
                    data: `MO_ROOM=${r.id}`,
                    displayText: `ห้อง ${r.number}`,
                  },
                })),
              ],
            },
          },
        };
        await this.pushFlex(userId, message);
        return null;
      }
      if (userId && data.startsWith('MO_ROOM=')) {
        if (!this.isStaffUser(userId)) return null;
        const currentState = this.moveoutState.get(userId || '');
        if (
          !currentState?.buildingId ||
          typeof currentState.floor !== 'number'
        ) {
          await this.replyText(
            event.replyToken,
            'หมดเวลาทำรายการย้ายออก หรือยังไม่ได้เลือกตึก/ชั้น กรุณาพิมพ์ แจ้งย้าย แล้วเลือกตึกและชั้นใหม่อีกครั้ง',
          );
          return null;
        }
        const roomId = data.split('=')[1] || '';
        const contract = await this.prisma.contract.findFirst({
          where: { roomId, isActive: true },
          include: { room: { include: { building: true } }, tenant: true },
        });
        if (!contract) {
          await this.replyText(
            event.replyToken,
            'ไม่พบผู้เช่าปัจจุบันสำหรับห้องนี้',
          );
          return null;
        }
        this.moveoutState.set(userId || '', {
          buildingId: contract.room?.buildingId || undefined,
          floor: contract.room?.floor,
          roomId,
          contractId: contract.id,
          step: 'WATER',
        });
        const infoText = `แจ้งย้ายออก ห้อง ${contract.room?.number} ${contract.room?.building?.name || contract.room?.building?.code || '-'} ชั้น ${contract.room?.floor}\nผู้เช่า: ${contract.tenant?.name || '-'} โทร ${contract.tenant?.phone || '-'}`;
        await this.pushMessage(userId, infoText);
        const bankText = 'กรุณากรอกข้อมูลบัญชีธนาคารของผู้เช่า';
        await this.pushMessage(userId, bankText);
        return null;
      }
      return Promise.resolve(null);
    }
    if (event.type !== 'message') {
      return Promise.resolve(null);
    }

    if (event.message.type === 'image') {
      const uid = (event as LineImageEvent).source.userId || '';
      if (uid) {
        this.addRecentChat({ userId: uid, type: 'received_image' });
      }
      const mo = this.moveoutState.get(uid);
      if (mo?.step) {
        return this.handleMoveOutImage(event as LineImageEvent);
      }
      const maint = this.tenantMaintenanceState.get(uid);
      if (maint?.step === 'WAIT_IMAGES') {
        return this.handleMaintenanceImage(event as LineImageEvent);
      }
      return this.handleSlipImage(event as LineImageEvent);
    }

    if (event.message.type !== 'text') {
      return Promise.resolve(null);
    }

    const userId = event.source.userId || '';
    const text = event.message.text.trim();
    if (userId) {
      this.addRecentChat({ userId, type: 'received_text', text });
    }

    if (text.toLowerCase() === 'whoami') {
      if (!userId) {
        await this.replyText(
          event.replyToken,
          'ไม่พบ LINE userId ของคุณ กรุณาลองใหม่อีกครั้ง',
        );
        return;
      }
      await this.replyText(
        event.replyToken,
        `LINE userId ของคุณคือ:\n${userId}`,
      );
      return;
    }

    if (text === 'จดมิเตอร์' || text === 'จดน้ำไฟ') {
      if (!userId) {
        await this.replyText(
          event.replyToken,
          'ไม่พบ LINE userId ของคุณ กรุณาลองใหม่อีกครั้ง',
        );
        return;
      }
      const baseUrl =
        process.env.PUBLIC_API_URL ||
        process.env.INTERNAL_API_URL ||
        process.env.API_URL ||
        'https://line-sisom.washqueue.com';
      const appBase = baseUrl.replace(/\/+$/, '');
      const meterUrl = `${appBase}/meter?uid=${encodeURIComponent(userId)}`;
      await this.replyText(
        event.replyToken,
        `เปิดหน้าจดมิเตอร์ได้ที่\n${meterUrl}`,
      );
      return;
    }

    const staffMoveoutState = this.moveoutState.get(userId);
    if (this.isStaffUser(userId) && staffMoveoutState?.step === 'WATER') {
      const userId2 = userId;
      if (userId2) {
        const prev = this.moveOutRequests.get(userId2) || {
          requestedAt: new Date(),
        };
        const bankInfo = {
          name: undefined,
          phone: undefined,
          accountNo: text,
          bank: undefined,
        };
        this.moveOutRequests.set(userId2, { ...prev, bankInfo });
        await this.pushMessage(
          userId2,
          'รับข้อมูลบัญชีเรียบร้อย ขอบคุณค่ะ/ครับ\nจากนั้นกรุณาส่งรูปมิเตอร์น้ำ',
        );
        this.startMoveoutTimer(userId2);
      }
      return Promise.resolve(null);
    }

    const pendingMoveout = this.tenantMoveoutRequests.get(userId);
    if (pendingMoveout) {
      if (!pendingMoveout.step || pendingMoveout.step === 'WAIT_PLAN') {
        let plan: string | null = null;
        const m = text.match(/ย้ายออกอีก\s+(\d{1,2})\s*วัน/);
        if (m) {
          plan = `${m[1]} วัน`;
        } else if (/ออกสิ้นเดือน|ย้ายออกสิ้นเดือน/.test(text)) {
          plan = 'สิ้นเดือน';
        }
        if (!plan) {
          await this.replyText(
            event.replyToken,
            'กรุณาเลือกจำนวนวันที่จะย้ายออกจากปุ่มที่ให้ไว้ หรือพิมพ์เช่น ย้ายออกอีก 15 วัน หรือ ออกสิ้นเดือน',
          );
          return;
        }
        pendingMoveout.moveoutPlan = plan;
        pendingMoveout.step = 'WAIT_REASON';
        this.tenantMoveoutRequests.set(userId, pendingMoveout);
        this.startTenantMoveoutTimer(userId);
        await this.replyText(
          event.replyToken,
          'กรุณาพิมพ์เหตุผลการย้ายออก เช่น ย้ายที่ทำงาน ย้ายที่เรียน หรืออื่น ๆ',
        );
        return;
      }
      if (pendingMoveout.step === 'WAIT_REASON') {
        this.tenantMoveoutRequests.delete(userId);
        this.clearTenantMoveoutTimer(userId);
        const reason = text;
        const room = await this.prisma.room.findUnique({
          where: { id: pendingMoveout.roomId },
          include: { building: true },
        });
        const descParts: string[] = [];
        if (pendingMoveout.moveoutDate)
          descParts.push(`วันที่ย้ายออก: ${pendingMoveout.moveoutDate}`);
        if (pendingMoveout.moveoutPlan)
          descParts.push(`ย้ายออกภายใน: ${pendingMoveout.moveoutPlan}`);
        if (reason) descParts.push(`เหตุผล: ${reason}`);
        if (pendingMoveout.tenantName)
          descParts.push(`TENANT: ${pendingMoveout.tenantName}`);
        if (pendingMoveout.phone)
          descParts.push(`PHONE: ${pendingMoveout.phone}`);
        const description =
          descParts.length > 0 ? descParts.join('\n') : undefined;
        await this.prisma.maintenanceRequest.create({
          data: {
            roomId: pendingMoveout.roomId,
            title: 'แจ้งย้ายออก',
            description,
            reportedBy:
              pendingMoveout.tenantName ||
              pendingMoveout.phone ||
              userId ||
              undefined,
          },
        });
        await this.replyText(
          event.replyToken,
          'รับเรื่องแจ้งย้ายออกเรียบร้อย ขอบคุณที่ใช้บริการ',
        );
        return;
      }
    }

    if (text === 'แจ้งซ่อม') {
      if (userId && this.hasBlockingFlow(userId)) {
        return this.replyText(
          event.replyToken,
          'คุณมีรายการที่ยังไม่เสร็จ กรุณาทำรายการเดิมให้เสร็จก่อน หรือรอ 3 นาทีให้หมดเวลา',
        );
      }
      if (this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งแจ้งซ่อมสำหรับผู้เช่าเท่านั้น',
        );
      }
      if (!userId) {
        return this.replyText(
          event.replyToken,
          'ไม่พบข้อมูลผู้ใช้ LINE กรุณาลงทะเบียนใหม่',
        );
      }
      const tenant = await this.prisma.tenant.findFirst({
        where: { lineUserId: userId },
      });
      const contactMatches = this.findRoomContactsByLineUserId(userId) || [];
      let contract: any = null;
      if (tenant) {
        contract = await this.prisma.contract.findFirst({
          where: { tenantId: tenant.id, isActive: true },
          include: { room: { include: { building: true } } },
        });
      } else if (!tenant && contactMatches.length > 0) {
        const roomIds = Array.from(
          new Set(contactMatches.map((m) => m.roomId)),
        );
        contract = await this.prisma.contract.findFirst({
          where: { roomId: { in: roomIds }, isActive: true },
          include: { room: { include: { building: true } }, tenant: true },
          orderBy: { startDate: 'desc' },
        });
      }
      if (!contract || !contract.room) {
        return this.replyText(
          event.replyToken,
          'ไม่พบสัญญาที่ใช้งานอยู่สำหรับบัญชีนี้ กรุณาติดต่อเจ้าหน้าที่',
        );
      }
      this.tenantMaintenanceState.set(userId, {
        roomId: contract.room.id,
        contractId: contract.id,
        tenantName:
          contract.tenant?.name ||
          tenant?.name ||
          contactMatches[0]?.contact?.name,
        phone:
          contract.tenant?.phone ||
          tenant?.phone ||
          contactMatches[0]?.contact?.phone,
        detail: undefined,
        images: [],
        step: 'WAIT_DETAIL',
      });
      this.startTenantMaintenanceTimer(userId);
      return this.replyText(
        event.replyToken,
        'กรุณาพิมพ์สิ่งของที่ชำรุด หรือปัญหาที่ต้องการให้ซ่อม',
      );
    }

    const maintState = this.tenantMaintenanceState.get(userId);
    if (maintState) {
      if (!maintState.step || maintState.step === 'WAIT_DETAIL') {
        const next = {
          ...maintState,
          detail: text,
          step: 'ASK_IMAGE' as const,
        };
        this.tenantMaintenanceState.set(userId, next);
        this.startTenantMaintenanceTimer(userId);
        const msg: any = {
          type: 'text',
          text: 'ต้องการแนบรูปประกอบการแจ้งซ่อมหรือไม่',
          quickReply: {
            items: [
              {
                type: 'action',
                action: {
                  type: 'message',
                  label: 'ส่งรูป',
                  text: 'ส่งรูปแจ้งซ่อม',
                },
              },
              {
                type: 'action',
                action: {
                  type: 'message',
                  label: 'ไม่ส่งรูป',
                  text: 'ไม่ส่งรูปแจ้งซ่อม',
                },
              },
            ],
          },
        };
        await this.replyFlex(event.replyToken, msg);
        return;
      }
      if (maintState.step === 'ASK_IMAGE') {
        if (text === 'ไม่ส่งรูปแจ้งซ่อม') {
          this.tenantMaintenanceState.delete(userId);
          this.clearTenantMaintenanceTimer(userId);
          const descParts: string[] = [];
          if (maintState.detail)
            descParts.push(`รายละเอียด: ${maintState.detail}`);
          if (maintState.tenantName)
            descParts.push(`TENANT: ${maintState.tenantName}`);
          if (maintState.phone) descParts.push(`PHONE: ${maintState.phone}`);
          const description =
            descParts.length > 0 ? descParts.join('\n') : undefined;
          const req = await this.prisma.maintenanceRequest.create({
            data: {
              roomId: maintState.roomId,
              title: 'แจ้งซ่อม',
              description,
              reportedBy:
                maintState.tenantName ||
                maintState.phone ||
                userId ||
                undefined,
            },
          });
          await this.notifyStaffMaintenanceCreated(req.id);
          await this.replyText(
            event.replyToken,
            'รับเรื่องแจ้งซ่อมเรียบร้อย ระบบจะแจ้งเจ้าหน้าที่ให้ดำเนินการต่อ',
          );
          return;
        }
        if (text === 'ส่งรูปแจ้งซ่อม') {
          const next = { ...maintState, step: 'WAIT_IMAGES' as const };
          this.tenantMaintenanceState.set(userId, next);
          this.startTenantMaintenanceTimer(userId);
          await this.replyText(
            event.replyToken,
            'กรุณาส่งรูปสิ่งของที่ชำรุด สามารถส่งได้หลายรูป หากส่งครบแล้วให้พิมพ์ว่า เสร็จสิ้น',
          );
          return;
        }
        await this.replyText(
          event.replyToken,
          'กรุณาเลือกจากตัวเลือกที่ให้ไว้ หรือพิมพ์ ส่งรูปแจ้งซ่อม หรือ ไม่ส่งรูปแจ้งซ่อม',
        );
        return;
      }
      if (maintState.step === 'WAIT_IMAGES') {
        if (
          text === 'เสร็จสิ้น' ||
          text === 'ไม่มีรูปเพิ่ม' ||
          text === 'ไม่มีรูปเพิ่มเติม'
        ) {
          this.tenantMaintenanceState.delete(userId);
          this.clearTenantMaintenanceTimer(userId);
          const descParts: string[] = [];
          if (maintState.detail)
            descParts.push(`รายละเอียด: ${maintState.detail}`);
          if (maintState.images && maintState.images.length > 0) {
            maintState.images.forEach((u, idx) => {
              descParts.push(`IMAGE${idx + 1}: ${u}`);
            });
          }
          if (maintState.tenantName)
            descParts.push(`TENANT: ${maintState.tenantName}`);
          if (maintState.phone) descParts.push(`PHONE: ${maintState.phone}`);
          const description =
            descParts.length > 0 ? descParts.join('\n') : undefined;
          const req = await this.prisma.maintenanceRequest.create({
            data: {
              roomId: maintState.roomId,
              title: 'แจ้งซ่อม',
              description,
              reportedBy:
                maintState.tenantName ||
                maintState.phone ||
                userId ||
                undefined,
            },
          });
          await this.notifyStaffMaintenanceCreated(req.id);
          await this.replyText(
            event.replyToken,
            'รับเรื่องแจ้งซ่อมเรียบร้อย ระบบจะแจ้งเจ้าหน้าที่ให้ดำเนินการต่อ',
          );
          return;
        }
      }
    }

    await this.setDefaultRichMenuGeneral();

    if (/รายละเอียดห้องพัก/.test(text)) {
      const fallbackImg =
        'https://line-sisom.washqueue.com/api/media/1771215544820-tz1nsd1tlin.png';
      const logoUrl = (() => {
        try {
          const p = join(resolve('/app/uploads'), 'dorm-extra.json');
          if (!existsSync(p)) return undefined;
          const raw = readFileSync(p, 'utf8');
          const parsed = JSON.parse(raw);
          const u =
            typeof parsed.logoUrl === 'string' ? parsed.logoUrl : undefined;
          return u && /^https?:\/\//.test(u) ? u : undefined;
        } catch {
          return undefined;
        }
      })();
      const heroUrl = logoUrl || fallbackImg;
      const getStatusLabel = async (price: number) => {
        const total = await this.prisma.room.count({
          where: { pricePerMonth: price },
        });
        const vacant = await this.prisma.room.count({
          where: { pricePerMonth: price, status: 'VACANT' },
        });
        return { label: vacant > 0 ? 'ว่าง' : 'ไม่ว่าง', total, vacant };
      };
      const fan = await getStatusLabel(2100);
      const fanFurnished = await getStatusLabel(2500);
      const airFurnished = await getStatusLabel(3000);
      const header = logoUrl
        ? {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            alignItems: 'center',
            contents: [
              { type: 'image', url: logoUrl, size: 'sm', aspectMode: 'cover' },
            ],
          }
        : undefined;
      const carouselContents: any = {
        type: 'carousel',
        contents: [
          {
            type: 'bubble',
            ...(header ? { header } : {}),
            hero: {
              type: 'image',
              url: heroUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'ห้องพัดลม',
                  weight: 'bold',
                  size: 'xl',
                  wrap: true,
                },
                {
                  type: 'box',
                  layout: 'baseline',
                  contents: [
                    {
                      type: 'text',
                      text: '2,100บาท',
                      weight: 'bold',
                      size: 'xl',
                      flex: 0,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: 'text',
                  text: fan.label,
                  color: fan.label === 'ว่าง' ? '#09A92FFF' : '#FA0000FF',
                },
              ],
            },
          },
          {
            type: 'bubble',
            ...(header ? { header } : {}),
            hero: {
              type: 'image',
              url: heroUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'ห้องพัดลม + เฟอร์นิเจอร์ ',
                  weight: 'bold',
                  size: 'xl',
                  wrap: true,
                },
                {
                  type: 'box',
                  layout: 'baseline',
                  contents: [
                    {
                      type: 'text',
                      text: '2,500 บาท',
                      weight: 'bold',
                      size: 'xl',
                      flex: 0,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: 'text',
                  text: fanFurnished.label,
                  color:
                    fanFurnished.label === 'ว่าง' ? '#09A92FFF' : '#FA0000FF',
                  flex: 0,
                  margin: 'md',
                  wrap: true,
                },
              ],
            },
          },
          {
            type: 'bubble',
            ...(header ? { header } : {}),
            hero: {
              type: 'image',
              url: heroUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'ห้องแอร์ + เฟอร์นิเจอร์ ',
                  weight: 'bold',
                  size: 'xl',
                  wrap: true,
                },
                {
                  type: 'box',
                  layout: 'baseline',
                  contents: [
                    {
                      type: 'text',
                      text: '3000 บาท',
                      weight: 'bold',
                      size: 'xl',
                      flex: 0,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: 'text',
                  text: airFurnished.label,
                  color:
                    airFurnished.label === 'ว่าง' ? '#09A92FFF' : '#FA0000FF',
                },
              ],
            },
          },
        ],
      };
      const priceMessage: any = {
        type: 'flex',
        altText: 'รายละเอียดห้องพัก',
        contents: carouselContents,
      };
      const ratesBubble: any = {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'อัตราค่าน้ำ ค่าไฟ',
              weight: 'bold',
              size: 'sm',
              color: '#AAAAAA',
            },
          ],
        },
        hero: {
          type: 'image',
          url: heroUrl,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
          action: {
            type: 'uri',
            label: 'Action',
            uri: 'https://linecorp.com/',
          },
        },
        body: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              flex: 2,
              contents: [
                {
                  type: 'text',
                  text: 'ค่าน้ำ 0-5 หน่วย คิดราคาเหมา 35 บาท',
                  flex: 1,
                  gravity: 'top',
                },
                {
                  type: 'text',
                  text: 'เกิน 5 หน่วยคิดหน่วยละ 7 บาท',
                  flex: 2,
                  gravity: 'center',
                },
                { type: 'separator', margin: 'md', color: '#000000FF' },
                { type: 'separator', margin: 'xl', color: '#FFFFFFFF' },
                {
                  type: 'text',
                  text: 'ค่าไฟ คิด หน่วยละ 7 บาท ตั้งแต่เริ่ม',
                  flex: 2,
                  gravity: 'center',
                },
                { type: 'separator' },
              ],
            },
          ],
        },
      };
      const ratesMessage: any = {
        type: 'flex',
        altText: 'อัตราค่าน้ำ ค่าไฟ',
        contents: ratesBubble,
      };
      await this.replyFlex(event.replyToken, priceMessage);
      if (userId) await this.pushFlex(userId, ratesMessage);
      return null;
    }
    if (text.includes('รูปห้องพัก')) {
      const galleryUrl =
        process.env.CMS_GALLERY_URL ||
        process.env.ROOM_GALLERY_URL ||
        'https://cms.washqueue.com/gallery';
      return this.replyText(
        event.replyToken,
        `ดูรูปห้องพักได้ที่\n${galleryUrl}`,
      );
    }
    if (text.toUpperCase().startsWith('REGISTERSTAFFSISOM')) {
      const parts = text.trim().split(/\s+/);
      if (parts.length < 2) {
        return this.replyText(
          event.replyToken,
          'กรุณาระบุเบอร์โทรศัพท์ เช่น REGISTERSTAFFSISOM 0812345678',
        );
      }
      const phoneInput = parts[1];
      const variants = this.phoneVariants(phoneInput);

      const user = await this.prisma.user.findFirst({
        where: {
          OR: variants.map((p) => ({ phone: p })),
        },
      });

      if (!user) {
        return this.replyText(
          event.replyToken,
          'ไม่พบเบอร์โทรศัพท์ในระบบเจ้าหน้าที่',
        );
      }
      if (user.lineUserId) {
        return this.replyText(
          event.replyToken,
          'คุณลงทะเบียนแล้ว กรุณาแจ้งผู้ดูแล',
        );
      }
      this.staffVerifyRequests.set(userId || '', user.id);
      return this.replyText(
        event.replyToken,
        `กรุณาพิมพ์รหัสยืนยัน 6 หลักที่ได้จากหน้าเว็บ`,
      );
    }

    if (text.toUpperCase() === 'REGISTERSISOM') {
      if (userId && this.hasBlockingFlow(userId)) {
        return this.replyText(
          event.replyToken,
          'คุณมีรายการที่ยังไม่เสร็จ กรุณาทำรายการเดิมให้เสร็จก่อน หรือรอ 3 นาทีให้หมดเวลา',
        );
      }
      if (userId) {
        const store = this.readRoomContactsStore() || {};
        for (const list of Object.values(store)) {
          const found = (list || []).find((c) => c.lineUserId === userId);
          if (found) {
            return this.replyText(
              event.replyToken,
              'บัญชี LINE นี้เชื่อมกับห้องพักเรียบร้อยแล้ว',
            );
          }
        }
        const tenant = await this.prisma.tenant.findFirst({
          where: { lineUserId: userId },
        });
        if (tenant) {
          return this.replyText(
            event.replyToken,
            'บัญชี LINE นี้เชื่อมกับหอพักเรียบร้อยแล้ว',
          );
        }
        this.registerPhoneContext.set(userId, true);
        this.startRegisterPhoneTimer(userId);
      }
      return this.replyText(
        event.replyToken,
        'กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนกับหอพัก',
      );
    }

    if (/^\d{6}$/.test(text)) {
      const pending = this.staffVerifyRequests.get(userId || '');
      if (pending) {
        const u = await this.prisma.user.findUnique({ where: { id: pending } });
        if (!u?.verifyCode) {
          this.staffVerifyRequests.delete(userId || '');
          return this.replyText(
            event.replyToken,
            'ยังไม่มีรหัสยืนยัน กรุณาขอรหัสจากหน้าเว็บ',
          );
        }
        if (u.verifyCode !== text) {
          return this.replyText(event.replyToken, 'รหัสยืนยันไม่ถูกต้อง');
        }
        await this.prisma.user.update({
          where: { id: pending },
          data: { lineUserId: userId, verifyCode: null },
        });
        this.staffVerifyRequests.delete(userId || '');
        if (userId) {
          if (!this.staffUserIds.includes(userId)) {
            this.staffUserIds.push(userId);
          }
          await this.linkMenuForUser(userId, 'ADMIN');
        }
        return this.replyText(event.replyToken, 'เชื่อมต่อสำเร็จ');
      }
    }

    if (text.toUpperCase().startsWith('REGISTER')) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        return this.replyText(
          event.replyToken,
          'Invalid format. Use: REGISTER <PHONE>',
        );
      }
      const phoneInput = parts[1];
      const variants = this.phoneVariants(phoneInput);
      return this.handlePhoneRegistration(variants, userId, event.replyToken);
    }

    if (text === 'รับชำระเงิน') {
      if (userId && this.hasBlockingFlow(userId)) {
        return this.replyText(
          event.replyToken,
          'คุณมีรายการที่ยังไม่เสร็จ กรุณาทำรายการเดิมให้เสร็จก่อน หรือรอ 3 นาทีให้หมดเวลา',
        );
      }
      if (!this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งนี้สำหรับเจ้าหน้าที่เท่านั้น',
        );
      }
      this.staffPaymentState.set(userId || '', {});
      this.startStaffPaymentTimer(userId || '');
      const buildings = await this.prisma.building.findMany({
        orderBy: { name: 'asc' },
      });
      if (buildings.length === 0) {
        return this.replyText(event.replyToken, 'ยังไม่มีข้อมูลตึก');
      }
      const message: any = {
        type: 'flex',
        altText: 'เลือกตึก',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              { type: 'text', text: 'เลือกตึก', weight: 'bold', size: 'lg' },
              ...buildings.slice(0, 12).map((b) => ({
                type: 'button',
                style: 'primary',
                color: '#00B900',
                action: {
                  type: 'postback',
                  label: b.name,
                  data: `PAY_BUILDING=${b.id}`,
                  displayText: b.name,
                },
              })),
            ],
          },
        },
      };
      return this.replyFlex(event.replyToken, message);
    }

    if (text === 'แจ้งย้ายออก') {
      if (userId && this.hasBlockingFlow(userId)) {
        return this.replyText(
          event.replyToken,
          'คุณมีรายการที่ยังไม่เสร็จ กรุณาทำรายการเดิมให้เสร็จก่อน หรือรอ 3 นาทีให้หมดเวลา',
        );
      }
      if (this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งแจ้งย้ายออกสำหรับผู้เช่า เจ้าหน้าที่ให้ใช้คำสั่ง แจ้งย้าย',
        );
      }
      if (!userId) {
        return this.replyText(
          event.replyToken,
          'ไม่พบข้อมูลผู้ใช้ LINE กรุณาลงทะเบียนใหม่',
        );
      }
      const tenant = await this.prisma.tenant.findFirst({
        where: { lineUserId: userId },
      });
      const contactMatches = this.findRoomContactsByLineUserId(userId) || [];
      let contract: any = null;
      if (tenant) {
        contract = await this.prisma.contract.findFirst({
          where: { tenantId: tenant.id, isActive: true },
          include: { room: { include: { building: true } } },
        });
      } else if (!tenant && contactMatches.length > 0) {
        const roomIds = Array.from(
          new Set(contactMatches.map((m) => m.roomId)),
        );
        contract = await this.prisma.contract.findFirst({
          where: { roomId: { in: roomIds }, isActive: true },
          include: { room: { include: { building: true } }, tenant: true },
          orderBy: { startDate: 'desc' },
        });
      }
      if (!contract || !contract.room) {
        return this.replyText(
          event.replyToken,
          'ไม่พบสัญญาที่ใช้งานอยู่สำหรับบัญชีนี้ กรุณาติดต่อเจ้าหน้าที่',
        );
      }
      this.tenantMoveoutRequests.set(userId, {
        roomId: contract.room.id,
        contractId: contract.id,
        tenantName:
          contract.tenant?.name ||
          tenant?.name ||
          contactMatches[0]?.contact?.name,
        phone:
          contract.tenant?.phone ||
          tenant?.phone ||
          contactMatches[0]?.contact?.phone,
        step: 'WAIT_PLAN',
        moveoutPlan: undefined,
        moveoutDate: undefined,
      });
      this.startTenantMoveoutTimer(userId);
      const buildingLabel =
        contract.room.building?.name || contract.room.building?.code || '';
      const today = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const todayStr = `${today.getFullYear()}-${pad(
        today.getMonth() + 1,
      )}-${pad(today.getDate())}`;
      const maxDate = new Date(today);
      maxDate.setMonth(maxDate.getMonth() + 2);
      const maxStr = `${maxDate.getFullYear()}-${pad(
        maxDate.getMonth() + 1,
      )}-${pad(maxDate.getDate())}`;
      const choices = [10, 15, 20, 25, 30];
      const buttons = choices.slice(0, 5).map((d) => ({
        type: 'button',
        style: 'primary',
        color: '#FF6413',
        action: {
          type: 'message',
          label: `${d} วัน`,
          text: `ย้ายออกอีก ${d} วัน`,
        },
      }));
      buttons.push({
        type: 'button',
        style: 'secondary',
        color: '#888888',
        action: {
          type: 'message',
          label: 'ออกสิ้นเดือน',
          text: 'ออกสิ้นเดือน',
        },
      });
      buttons.push({
        type: 'button',
        style: 'secondary',
        color: '#4b6584',
        action: {
          type: 'datetimepicker',
          label: 'เลือกวันที่จากปฏิทิน',
          data: 'TENANT_MOVEOUT_DATE',
          mode: 'date',
          initial: todayStr,
          min: todayStr,
          max: maxStr,
        } as any,
      });
      const msg: any = {
        type: 'flex',
        altText: 'แจ้งย้ายออก',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            contents: [
              {
                type: 'text',
                text: `แจ้งย้ายออก ห้อง ${contract.room.number} ตึก ${buildingLabel} ชั้น ${contract.room.floor}`,
                wrap: true,
              },
              {
                type: 'text',
                text: 'ต้องการย้ายออกอีกกี่วัน?',
                weight: 'bold',
                size: 'md',
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: buttons,
          },
        },
      };
      await this.replyFlex(event.replyToken, msg);
      return;
    }

    if (text.includes('แจ้งย้าย')) {
      if (!this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งนี้สำหรับเจ้าหน้าที่เท่านั้น',
        );
      }
      if (userId && this.hasBlockingFlow(userId)) {
        return this.replyText(
          event.replyToken,
          'คุณมีรายการที่ยังไม่เสร็จ กรุณาทำรายการเดิมให้เสร็จก่อน หรือรอ 3 นาทีให้หมดเวลา',
        );
      }
      const activeContracts = await this.prisma.contract.findMany({
        where: { isActive: true },
        include: { room: { include: { building: true } } },
      });
      const buildings = Array.from(
        new Map(
          activeContracts
            .map((c) => c.room?.building)
            .filter((b) => !!b)
            .map((b) => [b.id, b]),
        ).values(),
      ).sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        if (nameA === 'บ้านน้อย' && nameB !== 'บ้านน้อย') return 1;
        if (nameB === 'บ้านน้อย' && nameA !== 'บ้านน้อย') return -1;
        return nameA.localeCompare(nameB, undefined, { numeric: true });
      });
      if (buildings.length === 0) {
        return this.replyText(event.replyToken, 'ไม่พบตึกที่มีผู้เช่าปัจจุบัน');
      }
      const message: any = {
        type: 'flex',
        altText: 'เลือกตึก (ย้ายออก)',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: 'แจ้งย้ายออก: เลือกตึก',
                weight: 'bold',
                size: 'lg',
              },
              ...buildings.slice(0, 12).map((b) => ({
                type: 'button',
                style: 'primary',
                color: '#d35400',
                action: {
                  type: 'postback',
                  label: b.name,
                  data: `MO_BUILDING=${b.id}`,
                  displayText: b.name,
                },
              })),
            ],
          },
        },
      };
      return this.replyFlex(event.replyToken, message);
    }

    if (
      userId &&
      text.startsWith('ตึก ') &&
      this.isStaffUser(userId) &&
      this.moveoutState.get(userId || '')
    ) {
      // Optional text-based flow, skip for now
    }

    // Move-out postbacks
    // (postback handlers for move-out are implemented earlier in the postback section)

    if (/^ตึก\s+/i.test(text)) {
      if (!this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งนี้สำหรับเจ้าหน้าที่เท่านั้น',
        );
      }
      const token = text.replace(/^ตึก\s+/i, '').trim();
      const building = await this.prisma.building.findFirst({
        where: {
          OR: [
            { name: { contains: token } },
            { code: token },
            { code: { contains: token } },
          ],
        },
      });
      if (!building) {
        return this.replyText(event.replyToken, `ไม่พบตึกที่ตรงกับ "${token}"`);
      }
      this.staffPaymentState.set(userId || '', { buildingId: building.id });
      const rooms = await this.prisma.room.findMany({
        where: { buildingId: building.id },
        select: { floor: true },
      });
      const floors = Array.from(new Set(rooms.map((r) => r.floor))).sort(
        (a, b) => a - b,
      );
      const message: any = {
        type: 'flex',
        altText: 'เลือกชั้น',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: `เลือกชั้น (${building.name})`,
                weight: 'bold',
                size: 'lg',
              },
              ...floors.map((f) => ({
                type: 'button',
                style: 'primary',
                color: '#00B900',
                action: {
                  type: 'postback',
                  label: `ชั้น ${f}`,
                  data: `PAY_FLOOR=${building.id}:${f}`,
                  displayText: `ชั้น ${f}`,
                },
              })),
            ],
          },
        },
      };
      return this.replyFlex(event.replyToken, message);
    }

    if (/^ชั้น\s+\d+/i.test(text)) {
      if (!this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งนี้สำหรับเจ้าหน้าที่เท่านั้น',
        );
      }
      const state = this.staffPaymentState.get(userId || '');
      if (!state?.buildingId) {
        return this.replyText(
          event.replyToken,
          'กรุณาเลือกตึกก่อน (พิมพ์: ตึก <ชื่อ/รหัส>)',
        );
      }
      const floor = Number(text.replace(/^ชั้น\s+/i, '').trim());
      if (!Number.isFinite(floor)) {
        return this.replyText(event.replyToken, 'รูปแบบชั้นไม่ถูกต้อง');
      }
      this.staffPaymentState.set(userId || '', { ...state, floor });
      const rooms = await this.prisma.room.findMany({
        where: { buildingId: state.buildingId, floor },
        orderBy: { number: 'asc' },
      });
      if (rooms.length === 0) {
        return this.replyText(event.replyToken, `ไม่มีห้องในชั้น ${floor}`);
      }
      const message: any = {
        type: 'flex',
        altText: 'เลือกห้อง',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: `เลือกห้อง ชั้น ${floor}`,
                weight: 'bold',
                size: 'lg',
              },
              ...rooms.slice(0, 12).map((r) => ({
                type: 'button',
                style: 'primary',
                color: '#FF6413',
                action: {
                  type: 'postback',
                  label: `ห้อง ${r.number}`,
                  data: `PAY_ROOM=${r.id}`,
                  displayText: `ห้อง ${r.number}`,
                },
              })),
            ],
          },
        },
      };
      return this.replyFlex(event.replyToken, message);
    }

    if (/^ห้อง\s+/i.test(text)) {
      if (!this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งนี้สำหรับเจ้าหน้าที่เท่านั้น',
        );
      }
      const state = this.staffPaymentState.get(userId || '');
      if (!state?.buildingId || !state?.floor) {
        return this.replyText(
          event.replyToken,
          'กรุณาเลือกตึกและชั้นก่อน (พิมพ์: ตึก ..., ชั้น ...)',
        );
      }
      const roomNumber = text.replace(/^ห้อง\s+/i, '').trim();
      const room = await this.prisma.room.findFirst({
        where: {
          buildingId: state.buildingId,
          floor: state.floor,
          number: roomNumber,
        },
      });
      if (!room) {
        return this.replyText(
          event.replyToken,
          `ไม่พบห้อง ${roomNumber} ในชั้น ${state.floor}`,
        );
      }
      this.staffPaymentState.set(userId || '', { ...state, roomId: room.id });
      const contract = await this.prisma.contract.findFirst({
        where: { roomId: room.id, isActive: true },
        include: { room: true },
      });
      if (!contract) {
        return this.replyText(
          event.replyToken,
          'ไม่พบสัญญาที่ใช้งานอยู่สำหรับห้องนี้',
        );
      }
      this.staffPaymentState.set(userId || '', {
        ...state,
        roomId: room.id,
        contractId: contract.id,
      });
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          contractId: contract.id,
          status: {
            in: [
              InvoiceStatus.SENT,
              InvoiceStatus.DRAFT,
              InvoiceStatus.OVERDUE,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!invoice) {
        return this.replyText(
          event.replyToken,
          'ไม่มีบิลค้างชำระสำหรับห้องนี้',
        );
      }
      this.setPaymentContextWithTimeout(userId || '', invoice.id);
      const monthLabel = `${this.thaiMonth(invoice.month)} ${invoice.year}`;
      const amount = Number(invoice.totalAmount).toLocaleString();
      const flex = this.buildPayInfoFlex({
        room: contract.room.number,
        period: monthLabel,
        amount,
        bankName: 'ธนาคารไทยพาณิชย์',
        accountName: 'นาง สุนีย์ วงษ์จะบก',
        accountNo: '800-253388-7',
      });
      await this.pushFlex(userId, flex);
      return null;
    }

    if (/รายละเอียดหอ(ง)?พัก/.test(text)) {
      const imgUrl = 'https://img2.pic.in.th/imagef8d247a8c00bfa80.png';
      const logoUrl = this.getDormLogoUrl();
      const getStatusLabel = async (price: number) => {
        const total = await this.prisma.room.count({
          where: { pricePerMonth: price },
        });
        const vacant = await this.prisma.room.count({
          where: { pricePerMonth: price, status: 'VACANT' },
        });
        return { label: vacant > 0 ? 'ว่าง' : 'ไม่ว่าง', total, vacant };
      };
      const fan = await getStatusLabel(2100);
      const fanFurnished = await getStatusLabel(2500);
      const airFurnished = await getStatusLabel(3000);
      const header = logoUrl
        ? {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            alignItems: 'center',
            contents: [
              { type: 'image', url: logoUrl, size: 'sm', aspectMode: 'cover' },
            ],
          }
        : undefined;
      const carouselContents: any = {
        type: 'carousel',
        contents: [
          {
            type: 'bubble',
            ...(header ? { header } : {}),
            hero: {
              type: 'image',
              url: imgUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'ห้องพัดลม',
                  weight: 'bold',
                  size: 'xl',
                  wrap: true,
                },
                {
                  type: 'box',
                  layout: 'baseline',
                  contents: [
                    {
                      type: 'text',
                      text: '2,100บาท',
                      weight: 'bold',
                      size: 'xl',
                      flex: 0,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: 'text',
                  text: fan.label,
                  color: fan.label === 'ว่าง' ? '#09A92FFF' : '#FA0000FF',
                },
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'button',
                  action: {
                    type: 'message',
                    label: 'รายละเอียด',
                    text: 'ภายในจะมีเพียงพัดลมเพดาน ห้องพัดลมค่าประกัน 1,000 บาท',
                  },
                  style: 'primary',
                },
              ],
            },
          },
          {
            type: 'bubble',
            ...(header ? { header } : {}),
            hero: {
              type: 'image',
              url: imgUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'ห้องพัดลม + เฟอร์นิเจอร์ ',
                  weight: 'bold',
                  size: 'xl',
                  wrap: true,
                },
                {
                  type: 'box',
                  layout: 'baseline',
                  contents: [
                    {
                      type: 'text',
                      text: '2,500 บาท',
                      weight: 'bold',
                      size: 'xl',
                      flex: 0,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: 'text',
                  text: fanFurnished.label,
                  color:
                    fanFurnished.label === 'ว่าง' ? '#09A92FFF' : '#FA0000FF',
                  flex: 0,
                  margin: 'md',
                  wrap: true,
                },
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'button',
                  action: {
                    type: 'message',
                    label: 'Add to Cart',
                    text: 'ในห้องจะมีโต๊ะกินข้าว ตู้เสื้อผ้า โต๊ะเครื่องแป้ง เตียง แล้วก็ราวตากผ้า ห้องพัดลม + เฟอร์นิเจอร์ค่าประกัน 1,000 บาท',
                  },
                  flex: 2,
                  style: 'primary',
                },
              ],
            },
          },
          {
            type: 'bubble',
            ...(header ? { header } : {}),
            hero: {
              type: 'image',
              url: imgUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            },
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'ห้องแอร์ + เฟอร์นิเจอร์ ',
                  weight: 'bold',
                  size: 'xl',
                  wrap: true,
                },
                {
                  type: 'box',
                  layout: 'baseline',
                  contents: [
                    {
                      type: 'text',
                      text: '3000 บาท',
                      weight: 'bold',
                      size: 'xl',
                      flex: 0,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: 'text',
                  text: airFurnished.label,
                  color:
                    airFurnished.label === 'ว่าง' ? '#09A92FFF' : '#FA0000FF',
                },
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'button',
                  action: {
                    type: 'message',
                    label: 'รายละเอียด',
                    text: 'ภายในห้องจะมีโต๊ะกินข้าว ตู้เสื้อผ้า โต๊ะเครื่องแป้ง เตียง ราวตากผ้า และก็แอร์ ห้องแอร์ค่าประกัน 3,000 บาท',
                  },
                  style: 'primary',
                },
              ],
            },
          },
        ],
      };
      const ratesBubble: any = {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'อัตราค่าน้ำ ค่าไฟ',
              weight: 'bold',
              size: 'sm',
              color: '#AAAAAA',
            },
          ],
        },
        hero: {
          type: 'image',
          url: imgUrl,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
          action: {
            type: 'uri',
            label: 'Action',
            uri: 'https://linecorp.com/',
          },
        },
        body: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              flex: 2,
              contents: [
                {
                  type: 'text',
                  text: 'ค่าน้ำ 0-5 หน่วย คิดราคาเหมา 35 บาท',
                  flex: 1,
                  gravity: 'top',
                },
                {
                  type: 'text',
                  text: 'เกิน 5 หน่วยคิดหน่วยละ 7 บาท',
                  flex: 2,
                  gravity: 'center',
                },
                { type: 'separator', margin: 'md', color: '#000000FF' },
                { type: 'separator', margin: 'xl', color: '#FFFFFFFF' },
                {
                  type: 'text',
                  text: 'ค่าไฟ คิด หน่วยละ 7 บาท ตั้งแต่เริ่ม',
                  flex: 2,
                  gravity: 'center',
                },
                { type: 'separator' },
              ],
            },
          ],
        },
      };
      const priceMessage: any = {
        type: 'flex',
        altText: 'รายละเอียดห้องพัก',
        contents: carouselContents,
      };
      const ratesMessage: any = {
        type: 'flex',
        altText: 'อัตราค่าน้ำ ค่าไฟ',
        contents: ratesBubble,
      };
      await this.replyFlex(event.replyToken, priceMessage);
      if (userId) await this.pushFlex(userId, ratesMessage);
      return null;
    }
    if (/^(\+66\d{9}|66\d{9}|0\d{9})$/.test(text)) {
      const variants = this.phoneVariants(text);

      if (userId && this.registerPhoneContext.get(userId)) {
        this.registerPhoneContext.delete(userId);
        this.clearRegisterPhoneTimer(userId);
        return this.handlePhoneRegistration(variants, userId, event.replyToken);
      }

      const tenant = await this.prisma.tenant.findFirst({
        where: { OR: variants.map((p) => ({ phone: p })) },
      });
      if (!tenant) {
        return this.replyText(
          event.replyToken,
          'ไม่พบเบอร์ในระบบ กรุณาติดต่อผู้ดูแล',
        );
      }
      const contract = await this.prisma.contract.findFirst({
        where: { tenantId: tenant.id, isActive: true },
        include: { room: { include: { building: true } } },
      });
      if (!contract?.room) {
        return this.replyText(event.replyToken, 'ไม่พบสัญญาที่ใช้งานอยู่');
      }
      const buildingLabel =
        contract.room.building?.name || contract.room.building?.code || '-';
      const roomId = contract.room.id;
      const list = this.linkRequests.get(roomId) || [];
      this.linkRequests.set(roomId, [
        ...list.filter((r) => r.userId !== (userId || '')),
        {
          userId: userId || '',
          phone: tenant.phone,
          tenantId: tenant.id,
          createdAt: new Date(),
        },
      ]);
      const msg: any = {
        type: 'text',
        text: `ตรวจพบข้อมูลหอพักที่ ${buildingLabel} ชั้น ${contract.room.floor} ห้อง ${contract.room.number} ถูกต้องหรือไม่?`,
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'postback',
                label: 'ยืนยันเชื่อม',
                data: `LINK_ACCEPT=${roomId}:${tenant.id}`,
                displayText: 'ยืนยันเชื่อม',
              },
            },
            {
              type: 'action',
              action: {
                type: 'postback',
                label: 'ปฏิเสธ',
                data: `LINK_REJECT=${roomId}`,
                displayText: 'ปฏิเสธ',
              },
            },
          ],
        },
      };
      return this.replyFlex(event.replyToken, msg);
    }

    if (text.includes('แจ้งย้าย')) {
      const now = new Date();
      if (userId) {
        this.moveOutRequests.set(userId, { requestedAt: now });
      }
      const message: any = {
        type: 'text',
        text: 'โปรดเลือกกำหนดวันโอนเงินคืนประกัน',
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'postback',
                label: '7 วัน',
                data: 'MOVEOUT_DAYS=7',
                displayText: 'โอนคืนภายใน 7 วัน',
              },
            },
            {
              type: 'action',
              action: {
                type: 'postback',
                label: '15 วัน',
                data: 'MOVEOUT_DAYS=15',
                displayText: 'โอนคืนภายใน 15 วัน',
              },
            },
            {
              type: 'action',
              action: {
                type: 'postback',
                label: '30 วัน',
                data: 'MOVEOUT_DAYS=30',
                displayText: 'โอนคืนภายใน 30 วัน',
              },
            },
          ],
        },
      };
      const r = await this.replyFlex(event.replyToken, message);
      if (userId) {
        await this.pushMessage(
          userId,
          'โปรดส่งสลิปเพื่อให้ระบบตรวจสอบและตัดยอด',
        );
      }
      return r;
    }

    if (/ชื่อ-นามสกุล\s*:/i.test(text) && /เลขบัญชี\s*:/i.test(text)) {
      const userId2 = userId;
      const parse = (label: string) => {
        const m = text.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'));
        return m ? m[1].trim() : undefined;
      };
      const bankInfo = {
        name: parse('ชื่อ-นามสกุล'),
        phone: parse('เบอร์โทรศัพท์') || parse('เบอร์โทร'),
        accountNo: parse('เลขบัญชี'),
        bank: parse('ธนาคาร'),
      };
      if (userId2) {
        const prev = this.moveOutRequests.get(userId2) || {
          requestedAt: new Date(),
        };
        this.moveOutRequests.set(userId2, { ...prev, bankInfo });
        const staffMoveout = this.moveoutState.get(userId2);
        if (staffMoveout?.step) {
          await this.pushMessage(
            userId2,
            'รับข้อมูลบัญชีเรียบร้อย ขอบคุณค่ะ/ครับ\nจากนั้นกรุณาส่งรูปมิเตอร์น้ำ',
          );
          this.startMoveoutTimer(userId2);
        } else {
          await this.pushMessage(
            userId2,
            'รับข้อมูลบัญชีเรียบร้อย ขอบคุณค่ะ/ครับ',
          );
        }
      }
      return Promise.resolve(null);
    }

    if (text === 'ตรวจสอบยอดรายเดือน' || text === 'บิลคงค้าง') {
      const tenant = await this.prisma.tenant.findFirst({
        where: { lineUserId: userId },
      });
      if (!tenant) {
        return this.replyText(
          event.replyToken,
          'ยังไม่พบข้อมูลผู้เช่า กรุณาลงทะเบียนด้วยคำสั่ง REGISTER <เบอร์โทร>',
        );
      }
      const contract = await this.prisma.contract.findFirst({
        where: { tenantId: tenant.id, isActive: true },
        include: { room: true },
      });
      if (!contract) {
        return this.replyText(event.replyToken, 'ไม่พบสัญญาที่ใช้งานอยู่');
      }

      const invoices = await this.prisma.invoice.findMany({
        where: {
          contractId: contract.id,
          status: {
            in: [
              InvoiceStatus.SENT,
              InvoiceStatus.DRAFT,
              InvoiceStatus.OVERDUE,
            ],
          },
        },
        orderBy: { createdAt: 'asc' }, // Oldest first
        take: 10, // Max carousel size
      });

      if (invoices.length === 0) {
        return this.replyText(event.replyToken, 'ไม่พบยอดค้างชำระ');
      }

      const carousel = this.buildUnpaidCarousel(invoices, contract.room.number);
      return this.replyFlex(event.replyToken, carousel);
    }

    if (text === 'ห้องค้างชำระ') {
      const userId = event.source.userId;
      if (!this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งนี้สำหรับเจ้าหน้าที่เท่านั้น',
        );
      }
      const invoices = await this.prisma.invoice.findMany({
        where: {
          status: {
            in: [
              InvoiceStatus.SENT,
              InvoiceStatus.DRAFT,
              InvoiceStatus.OVERDUE,
            ] as InvoiceStatus[],
          },
        },
        include: {
          contract: {
            include: { room: { include: { building: true } }, tenant: true },
          },
        },
        orderBy: [{ year: 'asc' }, { month: 'asc' }, { createdAt: 'asc' }],
        take: 10,
      });
      if (invoices.length === 0) {
        return this.replyText(event.replyToken, 'ตอนนี้ไม่มีห้องค้างชำระ');
      }
      const carousel = this.buildUnpaidCarouselForStaff(invoices);
      return this.replyFlex(event.replyToken, carousel);
    }

    if (text === 'รายการแจ้งซ่อม') {
      const userId = event.source.userId;
      if (!this.isStaffUser(userId)) {
        return this.replyText(
          event.replyToken,
          'คำสั่งนี้สำหรับเจ้าหน้าที่เท่านั้น',
        );
      }
      const requests = await this.prisma.maintenanceRequest.findMany({
        where: { status: 'PENDING' as any },
        include: { room: { include: { building: true } } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      if (requests.length === 0) {
        return this.replyText(
          event.replyToken,
          'ไม่มีรายการแจ้งซ่อมที่รอดำเนินการ',
        );
      }
      if (userId) {
        for (const r of requests) {
          this.setStaffMaintenanceState(userId, r.id);
        }
      }
      const carousel = this.buildMaintenanceCarouselForStaff(requests);
      return this.replyFlex(event.replyToken, carousel);
    }

    if (text.startsWith('ชำระค่าห้อง')) {
      if (!userId) {
        return this.replyText(
          event.replyToken,
          'ไม่พบข้อมูลผู้ใช้ LINE กรุณาลงทะเบียนใหม่',
        );
      }

      const parsed = this.parsePayRentText(text);
      const contracts: any[] = [];

      const tenant = await this.prisma.tenant.findFirst({
        where: { lineUserId: userId },
      });
      if (tenant) {
        const tenantContracts = await this.prisma.contract.findMany({
          where: { tenantId: tenant.id },
          include: { room: true },
          orderBy: { startDate: 'desc' },
        });
        contracts.push(...tenantContracts);
      }

      const contactMatches = this.findRoomContactsByLineUserId(userId);
      if (contactMatches.length > 0) {
        const roomIds = Array.from(
          new Set(contactMatches.map((m) => m.roomId)),
        );
        const contactContracts = await this.prisma.contract.findMany({
          where: { roomId: { in: roomIds } },
          include: { room: true },
          orderBy: { startDate: 'desc' },
        });
        const existingIds = new Set(contracts.map((c) => c.id));
        for (const c of contactContracts) {
          if (!existingIds.has(c.id)) {
            contracts.push(c);
          }
        }
      }

      if (contracts.length === 0) {
        return this.replyText(
          event.replyToken,
          'ยังไม่พบข้อมูลผู้เช่าหรือผู้เข้าพัก กรุณาลงทะเบียนด้วยคำสั่ง REGISTER <เบอร์โทร>',
        );
      }

      const contractIds = contracts.map((c) => c.id);
      let invoice = null as Awaited<
        ReturnType<typeof this.prisma.invoice.findFirst>
      > | null;

      if (parsed) {
        invoice = await this.prisma.invoice.findFirst({
          where: {
            contractId: { in: contractIds },
            month: parsed.month,
            year: parsed.year,
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (!invoice) {
        invoice = await this.prisma.invoice.findFirst({
          where: {
            contractId: { in: contractIds },
            status: {
              in: [
                InvoiceStatus.SENT,
                InvoiceStatus.DRAFT,
                InvoiceStatus.OVERDUE,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (!invoice) {
        return this.replyText(event.replyToken, 'ไม่พบใบแจ้งหนี้ที่ต้องชำระ');
      }

      const contract =
        contracts.find((c) => c.id === invoice.contractId) ||
        (await this.prisma.contract.findUnique({
          where: { id: invoice.contractId },
          include: { room: true },
        }));
      if (!contract?.room) {
        return this.replyText(
          event.replyToken,
          'ไม่พบข้อมูลห้องของใบแจ้งหนี้นี้',
        );
      }

      if (userId) {
        this.setPaymentContextWithTimeout(userId, invoice.id);
      }

      const monthLabel = `${this.thaiMonth(invoice.month)} ${invoice.year}`;
      const amount = Number(invoice.totalAmount).toLocaleString();
      const flex = this.buildPayInfoFlex({
        room: contract.room.number,
        period: monthLabel,
        amount,
        bankName: 'ธนาคารไทยพาณิชย์',
        accountName: 'นาง สุนีย์ วงษ์จะบก',
        accountNo: '800-253388-7',
      });
      await this.replyFlex(event.replyToken, flex);
      if (userId) {
        await this.pushMessage(
          userId,
          'โปรดส่งสลิปเพื่อให้ระบบตรวจสอบและตัดยอด',
        );
      }
      return null;
    }

    if (text === 'ตรวจสอบค่าเช่า') {
      if (!userId) {
        return this.replyText(
          event.replyToken,
          'ไม่พบข้อมูลผู้ใช้ LINE กรุณาลงทะเบียนใหม่',
        );
      }
      const contracts: any[] = [];
      const tenant = await this.prisma.tenant.findFirst({
        where: { lineUserId: userId },
      });
      if (tenant) {
        const tenantContracts = await this.prisma.contract.findMany({
          where: { tenantId: tenant.id },
          include: {
            room: {
              include: { building: true },
            },
            invoices: true,
          },
          orderBy: { startDate: 'desc' },
        });
        contracts.push(...tenantContracts);
      }
      const contactMatches = this.findRoomContactsByLineUserId(userId);
      if (contactMatches.length > 0) {
        const roomIds = Array.from(
          new Set(contactMatches.map((m) => m.roomId)),
        );
        const contactContracts = await this.prisma.contract.findMany({
          where: { roomId: { in: roomIds } },
          include: {
            room: {
              include: { building: true },
            },
            invoices: true,
          },
          orderBy: { startDate: 'desc' },
        });
        const existingIds = new Set(contracts.map((c) => c.id));
        for (const c of contactContracts) {
          if (!existingIds.has(c.id)) {
            contracts.push(c);
          }
        }
      }
      if (contracts.length === 0) {
        return this.replyText(
          event.replyToken,
          'ยังไม่พบข้อมูลผู้เช่า กรุณาลงทะเบียนก่อน',
        );
      }
      const allInvoices: any[] = [];
      for (const c of contracts) {
        for (const inv of c.invoices || []) {
          allInvoices.push(inv);
        }
      }
      if (allInvoices.length === 0) {
        return this.replyText(
          event.replyToken,
          'ยังไม่มีใบแจ้งหนี้สำหรับห้องของคุณ',
        );
      }
      const unpaidInvoices = allInvoices.filter((inv) =>
        [
          InvoiceStatus.SENT,
          InvoiceStatus.DRAFT,
          InvoiceStatus.OVERDUE,
        ].includes(inv.status),
      );
      if (unpaidInvoices.length === 0) {
        return this.replyText(
          event.replyToken,
          'ไม่พบยอดค้างชำระสำหรับห้องของคุณ',
        );
      }
      const carousel = this.buildUnpaidCarousel(unpaidInvoices, '');
      await this.replyFlex(event.replyToken, carousel);
      return null;
    }

    if (text === 'ส่งสลิป') {
      if (this.isStaffUser(userId)) {
        const state = this.staffPaymentState.get(userId || '');
        let invoice: any = null;
        if (state?.contractId) {
          invoice =
            (await this.prisma.invoice.findFirst({
              where: {
                contractId: state.contractId,
                status: {
                  in: [
                    InvoiceStatus.SENT,
                    InvoiceStatus.DRAFT,
                    InvoiceStatus.OVERDUE,
                  ],
                },
              },
              orderBy: { createdAt: 'desc' },
            })) ||
            (await this.prisma.invoice.findFirst({
              where: { contractId: state.contractId },
              orderBy: { createdAt: 'desc' },
            }));
        } else if (state?.roomId) {
          const contract = await this.prisma.contract.findFirst({
            where: { roomId: state.roomId, isActive: true },
          });
          if (contract) {
            invoice =
              (await this.prisma.invoice.findFirst({
                where: {
                  contractId: contract.id,
                  status: {
                    in: [
                      InvoiceStatus.SENT,
                      InvoiceStatus.DRAFT,
                      InvoiceStatus.OVERDUE,
                    ],
                  },
                },
                orderBy: { createdAt: 'desc' },
              })) ||
              (await this.prisma.invoice.findFirst({
                where: { contractId: contract.id },
                orderBy: { createdAt: 'desc' },
              }));
          }
        }
        if (invoice) {
          this.setPaymentContextWithTimeout(userId || '', invoice.id);
        } else {
          return this.replyText(
            event.replyToken,
            'กรุณาเลือกห้องที่จะรับชำระก่อน',
          );
        }
      }
      return this.replyText(
        event.replyToken,
        'กรุณาส่งรูปสลิปเป็นไฟล์รูปภาพเพื่อให้ระบบตรวจสอบและตัดยอด',
      );
    }

    if (text === 'เลขบัญชีหอพัก') {
      const dorm = await this.prisma.dormConfig.findFirst({
        orderBy: { updatedAt: 'desc' },
      });
      const bankAccountRaw = (dorm?.bankAccount || '').trim();

      if (!bankAccountRaw) {
        return this.replyText(
          event.replyToken,
          'ยังไม่ได้ตั้งค่าเลขบัญชีหอพักในระบบ',
        );
      }

      const parsed = (() => {
        const result: {
          bankName: string;
          accountNo: string;
          accountName: string;
          branch: string;
        } = { bankName: '', accountNo: '', accountName: '', branch: '' };

        const txt = bankAccountRaw;
        const nameIdx = txt.indexOf('ชื่อบัญชี');
        const accIdx = txt.indexOf('เลขที่บัญชี');
        const branchIdx = txt.indexOf('สาขา');

        if (nameIdx !== -1 || accIdx !== -1) {
          const beforeName =
            nameIdx !== -1
              ? txt.slice(0, nameIdx).trim()
              : txt.slice(0, accIdx).trim();
          if (beforeName) result.bankName = beforeName;

          let afterName =
            nameIdx !== -1
              ? txt.slice(nameIdx + 'ชื่อบัญชี'.length).trim()
              : txt.slice(accIdx).trim();
          if (nameIdx !== -1) {
            const nextIdx = afterName.indexOf('เลขที่บัญชี');
            if (nextIdx !== -1) {
              result.accountName = afterName.slice(0, nextIdx).trim();
              afterName = afterName
                .slice(nextIdx + 'เลขที่บัญชี'.length)
                .trim();
            }
          }

          const accPart =
            nameIdx !== -1
              ? afterName
              : txt.slice(accIdx + 'เลขที่บัญชี'.length).trim();
          const branchSplit = accPart.split('สาขา');
          result.accountNo = (branchSplit[0] || '').trim();
          if (branchSplit[1]) {
            result.branch = branchSplit[1].trim();
          }
        } else {
          const parts = txt.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            result.bankName = parts[0];
            result.accountNo = parts.slice(1).join(' ');
          } else {
            result.accountNo = txt;
          }
        }

        return result;
      })();

      const name = dorm?.dormName || 'หอพัก';
      const accountNameFromConfig = dorm?.lineId || '';
      const finalAccountName = parsed.accountName || accountNameFromConfig;
      const bankName = parsed.bankName;
      const accountNo = parsed.accountNo || bankAccountRaw;
      const branch = parsed.branch;

      const contents: any[] = [
        {
          type: 'text',
          text: name,
          weight: 'bold',
          size: 'xl',
          wrap: true,
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          spacing: 'sm',
          contents: [
            ...(bankName
              ? [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      {
                        type: 'text',
                        text: 'ธนาคาร',
                        size: 'sm',
                        color: '#555555',
                        flex: 0,
                      },
                      {
                        type: 'text',
                        text: bankName,
                        size: 'sm',
                        weight: 'bold',
                        align: 'end',
                      },
                    ],
                  },
                ]
              : []),
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'เลขที่บัญชี',
                  size: 'sm',
                  color: '#555555',
                  flex: 0,
                },
                {
                  type: 'text',
                  text: accountNo,
                  size: 'md',
                  weight: 'bold',
                  align: 'end',
                },
              ],
            },
            ...(finalAccountName
              ? [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      {
                        type: 'text',
                        text: 'ชื่อบัญชี',
                        size: 'sm',
                        color: '#555555',
                        flex: 0,
                      },
                      {
                        type: 'text',
                        text: finalAccountName,
                        size: 'sm',
                        weight: 'bold',
                        align: 'end',
                        wrap: true,
                      },
                    ],
                  },
                ]
              : []),
            ...(branch
              ? [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      {
                        type: 'text',
                        text: 'สาขา',
                        size: 'sm',
                        color: '#555555',
                        flex: 0,
                      },
                      {
                        type: 'text',
                        text: branch,
                        size: 'sm',
                        weight: 'bold',
                        align: 'end',
                        wrap: true,
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        {
          type: 'text',
          text: 'แตะค้างที่เลขที่บัญชีเพื่อคัดลอก',
          size: 'xs',
          color: '#aaaaaa',
          margin: 'md',
        },
      ];

      const bubble: any = {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents,
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#FF6413',
              action: {
                type: 'message',
                label: 'คัดลอกเลขที่บัญชี',
                text: `เลขที่บัญชี ${accountNo}`,
              },
            },
          ],
        },
      };

      const message: any = {
        type: 'flex',
        altText: 'เลขบัญชีหอพัก',
        contents: bubble,
      };

      return this.replyFlex(event.replyToken, message);
    }

    if (text.includes('ติดต่อสอบถาม')) {
      const dorm = await this.prisma.dormConfig.findFirst({
        orderBy: { updatedAt: 'desc' },
      });
      const logoUrl = this.getDormLogoUrl();
      const base =
        process.env.PUBLIC_API_URL || process.env.INTERNAL_API_URL || '';
      const extra = (() => {
        try {
          const uploadsDir = resolve('/app/uploads');
          const p = join(uploadsDir, 'dorm-extra.json');
          if (!existsSync(p)) return {};
          const raw = readFileSync(p, 'utf8');
          const parsed = JSON.parse(raw);
          const mapUrl =
            typeof parsed.mapUrl === 'string' ? parsed.mapUrl : undefined;
          return { mapUrl };
        } catch {
          return {};
        }
      })() as { mapUrl?: string };
      const name = dorm?.dormName || 'หอพัก';
      const phone = dorm?.phone || '';
      const phoneDigits = phone.replace(/[^\d+]/g, '');
      const telUri = phoneDigits ? `tel:${phoneDigits}` : undefined;
      const mapUri = extra.mapUrl;
      const heroUrl =
        logoUrl ||
        (base
          ? `${String(base).replace(/\/+$/, '')}/api/media/logo.png`
          : undefined);
      const bodyContents: any[] = [
        {
          type: 'text',
          text: name,
          weight: 'bold',
          size: 'xl',
          wrap: true,
        },
      ];
      if (phone) {
        bodyContents.push({
          type: 'text',
          text: `โทร: ${phone}`,
          size: 'md',
          margin: 'md',
          wrap: true,
        });
      }
      const footerButtons: any[] = [];
      if (telUri) {
        footerButtons.push({
          type: 'button',
          style: 'primary',
          action: {
            type: 'uri',
            label: 'โทรเลย',
            uri: telUri,
          },
        });
      }
      if (mapUri) {
        footerButtons.push({
          type: 'button',
          style: 'secondary',
          action: {
            type: 'uri',
            label: 'เปิดแผนที่',
            uri: mapUri,
          },
        });
      }
      const bubble: any = {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: bodyContents,
        },
      };
      if (heroUrl) {
        bubble.hero = {
          type: 'image',
          url: heroUrl,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
        };
      }
      if (footerButtons.length > 0) {
        bubble.footer = {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: footerButtons,
        };
      }
      const flex: any = {
        type: 'flex',
        altText: 'ข้อมูลการติดต่อหอพัก',
        contents: bubble,
      };
      return this.replyFlex(event.replyToken, flex);
    }

    // Default: ไม่ตอบอะไรเพื่อหลีกเลี่ยงความสับสนของผู้ใช้
    return;
  }

  private async handleMoveOutImage(event: LineImageEvent) {
    const userId = event.source.userId || '';
    const state = this.moveoutState.get(userId);
    if (!state?.roomId || !state.step) {
      return this.replyText(
        event.replyToken,
        'กรุณาเลือกตึก/ชั้น/ห้องสำหรับย้ายออกก่อน',
      );
    }
    this.clearMoveoutTimer(userId);
    // Save image similar to slip
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filepath = join(this.mediaService.getUploadDir(), filename);
    let imgUrl: string | null = null;
    try {
      const apiUrl = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
      const res = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      });
      if (!res.ok)
        throw new Error(`LINE fetch failed: ${res.status} ${res.statusText}`);
      const body = res.body;
      if (!body) throw new Error('LINE response has no body');
      const stream = Readable.fromWeb(
        body as unknown as NodeReadableStream<Uint8Array>,
      );
      await pipeline(stream, createWriteStream(filepath));
      try {
        const img = await Jimp.read(filepath);
        const maxW = 1200;
        if (img.getWidth() > maxW) img.resize(maxW, Jimp.AUTO);
        img.quality(80);
        await img.writeAsync(filepath);
      } catch {}
      const baseUrl =
        process.env.PUBLIC_API_URL ||
        process.env.INTERNAL_API_URL ||
        process.env.API_URL ||
        'https://line-sisom.washqueue.com';
      imgUrl = this.mediaService.buildUrlFromBase(baseUrl, filename);
    } catch (e) {
      this.logger.warn(
        `Failed to save move-out image: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!imgUrl) {
      return this.replyText(
        event.replyToken,
        'ระบบไม่สามารถบันทึกรูปได้ กรุณาส่งใหม่อีกครั้ง',
      );
    }
    if (state.step === 'WATER') {
      this.moveoutState.set(userId, {
        ...state,
        waterImageUrl: imgUrl,
        step: 'ELECTRIC',
      });
      await this.replyText(
        event.replyToken,
        'รับรูปมิเตอร์น้ำแล้ว กรุณาส่งรูปมิเตอร์ไฟ',
      );
      this.startMoveoutTimer(userId);
      return;
    }
    if (state.step === 'ELECTRIC') {
      const next = { ...state, electricImageUrl: imgUrl };
      this.moveoutState.set(userId, { ...next, step: undefined });
      this.clearMoveoutTimer(userId);
      // Persist record (using maintenanceRequest as storage with title "แจ้งย้ายออก")
      const room = await this.prisma.room.findUnique({
        where: { id: state.roomId },
        include: { building: true },
      });
      const contract = state.contractId
        ? await this.prisma.contract.findUnique({
            where: { id: state.contractId },
            include: { tenant: true },
          })
        : null;
      const desc = [
        `WATER_IMG: ${next.waterImageUrl || '-'}`,
        `ELECTRIC_IMG: ${next.electricImageUrl || '-'}`,
        `TENANT: ${contract?.tenant?.name || '-'}`,
        `PHONE: ${contract?.tenant?.phone || '-'}`,
      ].join('\n');
      await this.prisma.maintenanceRequest.create({
        data: {
          roomId: state.roomId,
          title: 'แจ้งย้ายออก',
          description: desc,
          reportedBy: 'STAFF',
        },
      });
      const summaryFlex = {
        type: 'flex',
        altText: 'บันทึกแจ้งย้ายออก',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: 'บันทึกแจ้งย้ายออก',
                weight: 'bold',
                size: 'lg',
              },
              {
                type: 'text',
                text: `ตึก ${room?.building?.name || room?.building?.code || '-'}`,
                size: 'sm',
                color: '#666666',
              },
              {
                type: 'text',
                text: `ชั้น ${room?.floor} ห้อง ${room?.number}`,
                size: 'sm',
                color: '#666666',
              },
              { type: 'separator', margin: 'md' },
              {
                type: 'text',
                text: `ผู้เช่า: ${contract?.tenant?.name || '-'}`,
                size: 'sm',
              },
              {
                type: 'text',
                text: `เบอร์: ${contract?.tenant?.phone || '-'}`,
                size: 'sm',
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                style: 'link',
                action: {
                  type: 'uri',
                  label: 'รูปมิเตอร์น้ำ',
                  uri: next.waterImageUrl!,
                },
              },
              {
                type: 'button',
                style: 'link',
                action: {
                  type: 'uri',
                  label: 'รูปมิเตอร์ไฟ',
                  uri: next.electricImageUrl,
                },
              },
            ],
          },
        },
      };
      await this.pushFlex(userId, summaryFlex);
      await this.replyText(
        event.replyToken,
        'บันทึกรูปมิเตอร์น้ำ/ไฟ เรียบร้อย',
      );
      return;
    }
    return this.replyText(event.replyToken, 'ขั้นตอนไม่ถูกต้อง กรุณาเริ่มใหม่');
  }

  private async handleMaintenanceImage(event: LineImageEvent) {
    const userId = event.source.userId || '';
    const state = this.tenantMaintenanceState.get(userId);
    if (!state || state.step !== 'WAIT_IMAGES' || !state.roomId) {
      return this.replyText(
        event.replyToken,
        'กรุณาเริ่มคำสั่ง แจ้งซ่อม ก่อนส่งรูป',
      );
    }
    this.clearTenantMaintenanceTimer(userId);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filepath = join(this.mediaService.getUploadDir(), filename);
    let imgUrl: string | null = null;
    try {
      const apiUrl = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
      const res = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      });
      if (!res.ok)
        throw new Error(`LINE fetch failed: ${res.status} ${res.statusText}`);
      const body = res.body;
      if (!body) throw new Error('LINE response has no body');
      const stream = Readable.fromWeb(
        body as unknown as NodeReadableStream<Uint8Array>,
      );
      await pipeline(stream, createWriteStream(filepath));
      try {
        const img = await Jimp.read(filepath);
        const maxW = 1200;
        if (img.getWidth() > maxW) img.resize(maxW, Jimp.AUTO);
        img.quality(80);
        await img.writeAsync(filepath);
      } catch {}
      const baseUrl =
        process.env.PUBLIC_API_URL ||
        process.env.INTERNAL_API_URL ||
        process.env.API_URL ||
        'https://line-sisom.washqueue.com';
      imgUrl = this.mediaService.buildUrlFromBase(baseUrl, filename);
    } catch (e) {
      this.logger.warn(
        `Failed to save maintenance image: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    if (!imgUrl) {
      this.startTenantMaintenanceTimer(userId);
      return this.replyText(
        event.replyToken,
        'ระบบไม่สามารถบันทึกรูปได้ กรุณาส่งใหม่อีกครั้ง',
      );
    }
    const currentImages = Array.isArray(state.images)
      ? state.images.slice()
      : [];
    currentImages.push(imgUrl);
    this.tenantMaintenanceState.set(userId, {
      ...state,
      images: currentImages,
      step: 'WAIT_IMAGES',
    });
    this.startTenantMaintenanceTimer(userId);
    await this.replyText(
      event.replyToken,
      'บันทึกรูปแจ้งซ่อมแล้ว หากมีรูปเพิ่มเติมให้ส่งต่อได้เลย หากไม่มีให้พิมพ์ว่า เสร็จสิ้น',
    );
  }

  private phoneVariants(input: string): string[] {
    const raw = (input || '').replace(/\s|-/g, '');
    const list = new Set<string>();
    list.add(raw);
    if (/^\+66\d{9}$/.test(raw)) {
      list.add('0' + raw.slice(3));
      list.add(raw.replace(/^\+/, ''));
    } else if (/^0\d{9}$/.test(raw)) {
      list.add('+66' + raw.slice(1));
      list.add('66' + raw.slice(1));
    } else if (/^66\d{9}$/.test(raw)) {
      list.add('+66' + raw.slice(2));
      list.add('0' + raw.slice(2));
    }
    return Array.from(list);
  }

  private async replyText(replyToken: string, text: string) {
    if (!this.client) return;
    this.logger.log(`replyText: ${text.slice(0, 60)}`);
    return this.client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text }],
    });
  }

  private thaiMonth(m: number): string {
    const names = [
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม',
    ];
    return names[Math.max(0, Math.min(11, (m || 1) - 1))];
  }

  private async replyFlex(replyToken: string, message: any) {
    if (!this.client) return;
    try {
      this.logger.log(`replyFlex: altText=${message?.altText ?? 'n/a'}`);
    } catch {}
    return this.client.replyMessage({
      replyToken,
      messages: [message] as any,
    });
  }

  private parsePayRentText(
    text: string,
  ): { month: number; year: number } | null {
    const raw = text.replace(/\s+/g, ' ').trim();
    const parts = raw.split(' ');
    // Expect patterns like: "ชำระค่าห้อง <เดือน> <ปี>" or "ชำระค่าห้อง <เดือน>"
    if (parts.length < 2) return null;
    const monthMap: Record<string, number> = {
      มกราคม: 1,
      กุมภาพันธ์: 2,
      มีนาคม: 3,
      เมษายน: 4,
      พฤษภาคม: 5,
      มิถุนายน: 6,
      กรกฎาคม: 7,
      สิงหาคม: 8,
      กันยายน: 9,
      ตุลาคม: 10,
      พฤศจิกายน: 11,
      ธันวาคม: 12,
    };
    let mNum: number | null = null;
    let yNum: number | null = null;
    for (let i = 1; i < parts.length; i++) {
      const token = parts[i];
      if (mNum === null) {
        if (monthMap[token] !== undefined) {
          mNum = monthMap[token];
          continue;
        }
        const asNum = Number(token);
        if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 12) {
          mNum = asNum;
          continue;
        }
      } else if (yNum === null) {
        const asYear = Number(token);
        if (Number.isFinite(asYear) && asYear >= 2000 && asYear <= 3000) {
          yNum = asYear;
          continue;
        }
      }
    }
    const now = new Date();
    const currentYear = now.getFullYear();
    if (mNum !== null) {
      return { month: mNum, year: yNum ?? currentYear };
    }
    return null;
  }

  private buildUnpaidCarousel(invoices: any[], roomNumber: string) {
    const bubbles = invoices.map((inv) => {
      const monthLabel = `${this.thaiMonth(inv.month)} ${inv.year}`;
      const total = Number(inv.totalAmount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const [intPart, decPart] = total.split('.');

      return {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: `บิลเดือน ${monthLabel}`,
              weight: 'bold',
              size: 'xl',
              wrap: true,
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'xs',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ค่าเช่า',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: `${Number(inv.rentAmount).toLocaleString()} บ.`,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ค่าน้ำ',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: `${Number(inv.waterAmount).toLocaleString()} บ.`,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ค่าไฟ',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: `${Number(inv.electricAmount).toLocaleString()} บ.`,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
              ],
            },
            { type: 'separator', margin: 'md' },
            {
              type: 'box',
              layout: 'baseline',
              margin: 'md',
              contents: [
                {
                  type: 'text',
                  text: '฿',
                  weight: 'bold',
                  size: 'lg',
                  flex: 0,
                  margin: 'sm',
                },
                {
                  type: 'text',
                  text: intPart,
                  weight: 'bold',
                  size: 'xxl',
                  flex: 0,
                },
                {
                  type: 'text',
                  text: `.${decPart}`,
                  weight: 'bold',
                  size: 'lg',
                  flex: 0,
                },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#00B900',
              action: {
                type: 'message',
                label: 'ชำระค่าเช่า',
                text: `ชำระค่าห้อง ${this.thaiMonth(inv.month)} ${inv.year}`,
              },
            },
          ],
        },
      };
    });

    return {
      type: 'flex',
      altText: 'รายการบิลค้างชำระ',
      contents: {
        type: 'carousel',
        contents: bubbles,
      },
    };
  }

  private buildUnpaidCarouselForStaff(invoices: any[]) {
    const bubbles = invoices.map((inv) => {
      const monthLabel = `${this.thaiMonth(inv.month)} ${inv.year}`;
      const total = Number(inv.totalAmount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const [intPart, decPart] = total.split('.');
      const roomNo = inv.contract?.room?.number ?? '-';
      const buildingLabel =
        inv.contract?.room?.building?.name ||
        inv.contract?.room?.building?.code ||
        '-';
      const floor = inv.contract?.room?.floor ?? '-';
      const tenantName = inv.contract?.tenant?.name || '-';
      const tenantPhone = inv.contract?.tenant?.phone || '-';
      return {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: ` ${buildingLabel} ชั้น ${floor} ห้อง ${roomNo}`,
              size: 'sm',
              color: '#666666',
            },
            {
              type: 'text',
              text: `บิลเดือน ${monthLabel}`,
              weight: 'bold',
              size: 'xl',
              wrap: true,
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'xs',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ชื่อ',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: tenantName,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'เบอร์โทรศัพท์',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: tenantPhone,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ค่าเช่า',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: `${Number(inv.rentAmount).toLocaleString()} บ.`,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ค่าน้ำ',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: `${Number(inv.waterAmount).toLocaleString()} บ.`,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: 'ค่าไฟ',
                      size: 'sm',
                      color: '#555555',
                      flex: 1,
                    },
                    {
                      type: 'text',
                      text: `${Number(inv.electricAmount).toLocaleString()} บ.`,
                      size: 'sm',
                      color: '#111111',
                      flex: 0,
                      align: 'end',
                    },
                  ],
                },
              ],
            },
            { type: 'separator', margin: 'md' },
            {
              type: 'box',
              layout: 'baseline',
              margin: 'md',
              contents: [
                {
                  type: 'text',
                  text: '฿',
                  weight: 'bold',
                  size: 'lg',
                  flex: 0,
                  margin: 'sm',
                },
                {
                  type: 'text',
                  text: intPart,
                  weight: 'bold',
                  size: 'xxl',
                  flex: 0,
                },
                {
                  type: 'text',
                  text: `.${decPart}`,
                  weight: 'bold',
                  size: 'lg',
                  flex: 0,
                },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#00B900',
              action: {
                type: 'message',
                label: 'แจ้งเตือนผู้เช่า',
                text: `แจ้งเตือนห้อง ${roomNo} เดือน ${this.thaiMonth(inv.month)} ${inv.year}`,
              },
            },
          ],
        },
      };
    });
    return {
      type: 'flex',
      altText: 'รายการห้องค้างชำระ',
      contents: {
        type: 'carousel',
        contents: bubbles,
      },
    };
  }
  private buildPayInfoFlex(data: {
    room: string;
    period: string;
    amount: string;
    bankName: string;
    accountName: string;
    accountNo: string;
  }) {
    const logoUrl =
      process.env.SLIP_FLEX_LOGO_URL ||
      `${process.env.PUBLIC_API_URL || ''}/api/media/logo.png`;
    const iconMonth =
      'https://cdn-icons-png.freepik.com/512/10691/10691802.png';
    const headerContents: Array<Record<string, unknown>> = [];
    if (logoUrl && logoUrl.startsWith('http')) {
      headerContents.push({
        type: 'image',
        url: logoUrl,
        size: 'sm',
        aspectMode: 'cover',
      });
    }
    headerContents.push({
      type: 'text',
      text: 'ชำระค่าห้อง',
      weight: 'bold',
      color: '#ffffff',
      size: 'md',
      wrap: true,
      margin: logoUrl ? 'md' : 'none',
    });
    const header: Record<string, unknown> = {
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      alignItems: 'center',
      backgroundColor: '#FF6413',
      paddingAll: '12px',
      contents: headerContents,
    };
    const bodyContents: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `ห้อง ${data.room}`,
        size: 'sm',
        color: '#666666',
        wrap: true,
      },
      {
        type: 'box',
        layout: 'horizontal',
        justifyContent: 'space-between',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              { type: 'icon', url: iconMonth },
              { type: 'text', text: data.period, weight: 'bold', margin: 'sm' },
            ],
          },
          {
            type: 'text',
            text: `รวม ฿ ${data.amount}`,
            weight: 'bold',
            color: '#333333',
          },
        ],
      },
      { type: 'separator', margin: 'md' },
      {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        contents: [
          {
            type: 'text',
            text: data.bankName,
            color: '#e84e40',
            weight: 'bold',
          },
          { type: 'text', text: data.accountName, color: '#e84e40' },
          {
            type: 'text',
            text: data.accountNo,
            color: '#e84e40',
            action: {
              type: 'clipboard',
              label: 'Copy',
              clipboardText: data.accountNo,
            },
          },
        ],
      },
      {
        type: 'text',
        text: 'โอนแล้วส่งสลิปใน LINE นี้',
        wrap: true,
        size: 'xs',
        color: '#7f8c8d',
      },
    ];
    return {
      type: 'flex',
      altText: 'ข้อมูลชำระค่าห้อง',
      contents: {
        type: 'bubble',
        header,
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingAll: '12px',
          contents: bodyContents,
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'secondary',
              color: '#FF6413',
              action: {
                type: 'message',
                label: 'ส่งสลิป',
                text: 'ส่งสลิป',
              },
            },
          ],
        },
      },
    };
  }

  private buildMaintenanceCarouselForStaff(items: any[]) {
    const bubbles = items.map((it) => {
      const id = it.id;
      const buildingLabel =
        it.room?.building?.name || it.room?.building?.code || '-';
      const floor = it.room?.floor ?? '-';
      const roomNo = it.room?.number ?? '-';
      const title = it.title || 'แจ้งซ่อม';
      const desc = (it.description || '').slice(0, 120);
      const created = new Date(it.createdAt).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
      });
      const img =
        this.extractImageUrl(it.description) ||
        'https://img2.pic.in.th/imagef8d247a8c00bfa80.png';
      return {
        type: 'bubble',
        hero: {
          type: 'image',
          url: img,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: `ตึก ${buildingLabel} ชั้น ${floor} ห้อง ${roomNo}`,
              size: 'sm',
              color: '#666666',
            },
            {
              type: 'text',
              text: title,
              weight: 'bold',
              size: 'lg',
              wrap: true,
            },
            {
              type: 'text',
              text: desc || '-',
              size: 'sm',
              color: '#111111',
              wrap: true,
            },
            { type: 'separator', margin: 'md' },
            {
              type: 'text',
              text: `สร้างเมื่อ ${created}`,
              size: 'xs',
              color: '#888888',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#00B900',
              action: {
                type: 'postback',
                label: 'เสร็จแล้ว',
                data: `MAINT_DONE=${id}`,
                displayText: 'ปิดงานแจ้งซ่อม: เสร็จแล้ว',
              },
            },
            {
              type: 'button',
              style: 'secondary',
              color: '#666666',
              action: {
                type: 'postback',
                label: 'ยังไม่เสร็จ',
                data: `MAINT_NOT_DONE=${id}`,
                displayText: 'ปิดงานแจ้งซ่อม: ยังไม่เสร็จ',
              },
            },
          ],
        },
      };
    });
    return {
      type: 'flex',
      altText: 'รายการแจ้งซ่อมที่รอดำเนินการ',
      contents: { type: 'carousel', contents: bubbles },
    };
  }

  private extractImageUrl(text?: string): string | null {
    const raw = (text || '').trim();
    const m = raw.match(/https?:\/\/\\S+/g);
    if (!m || m.length === 0) return null;
    const first = m[0];
    if (/\.(png|jpg|jpeg|gif|webp)(\\?|$)/i.test(first)) return first;
    return first;
  }
  private async handleSlipImage(event: LineImageEvent) {
    if (!this.client) return;
    const userId = event.source.userId;
    if (!userId) {
      return this.replyText(
        event.replyToken,
        'กรุณาส่งสลิปในแชทส่วนตัวกับบอท เพื่อระบุตัวตนผู้เช่า',
      );
    }
    {
      const t = this.paymentContextTimers.get(userId);
      if (t) {
        clearTimeout(t);
        this.paymentContextTimers.delete(userId);
      }
    }

    const ctxInvoiceId = this.paymentContext.get(userId);

    const tenant = await this.prisma.tenant.findFirst({
      where: { lineUserId: userId },
    });
    const isStaff = this.isStaffUser(userId);
    const contactMatches = this.findRoomContactsByLineUserId(userId) || [];

    if (!tenant && !isStaff && !ctxInvoiceId && contactMatches.length === 0) {
      return this.replyText(
        event.replyToken,
        'ยังไม่พบข้อมูลผู้เช่า กรุณาลงทะเบียนด้วยคำสั่ง REGISTER <เบอร์โทร>',
      );
    }

    let contract: any = null;
    if (tenant) {
      contract = await this.prisma.contract.findFirst({
        where: { tenantId: tenant.id, isActive: true },
        include: { room: true },
      });
      if (!contract) {
        return this.replyText(event.replyToken, 'ไม่พบสัญญาที่ใช้งานอยู่');
      }
    } else if (!tenant && contactMatches.length > 0) {
      const roomIds = Array.from(new Set(contactMatches.map((m) => m.roomId)));
      contract = await this.prisma.contract.findFirst({
        where: { roomId: { in: roomIds }, isActive: true },
        include: { room: true },
        orderBy: { startDate: 'desc' },
      });
    }

    let invoice: any = null;

    if (ctxInvoiceId) {
      invoice = await this.prisma.invoice.findUnique({
        where: { id: ctxInvoiceId },
        include: { payments: true, contract: { include: { room: true } } },
      });
      if (
        invoice &&
        !isStaff &&
        !(
          [
            InvoiceStatus.SENT,
            InvoiceStatus.DRAFT,
            InvoiceStatus.OVERDUE,
          ] as InvoiceStatus[]
        ).includes(invoice.status)
      ) {
        invoice = null;
      }
      if (invoice && contract && invoice.contractId !== contract.id) {
        invoice = null;
      }
    }

    if (!invoice) {
      if (contract) {
        invoice = await this.prisma.invoice.findFirst({
          where: {
            contractId: contract.id,
            status: {
              in: [
                InvoiceStatus.SENT,
                InvoiceStatus.DRAFT,
                InvoiceStatus.OVERDUE,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          include: { payments: true, contract: { include: { room: true } } },
        });
      } else if (isStaff) {
        const state = this.staffPaymentState.get(userId || '');
        if (state?.contractId) {
          // First try unpaid statuses
          invoice = await this.prisma.invoice.findFirst({
            where: {
              contractId: state.contractId,
              status: {
                in: [
                  InvoiceStatus.SENT,
                  InvoiceStatus.DRAFT,
                  InvoiceStatus.OVERDUE,
                ],
              },
            },
            orderBy: { createdAt: 'desc' },
            include: { payments: true, contract: { include: { room: true } } },
          });
          // Fallback: any latest invoice for contract
          if (!invoice) {
            invoice = await this.prisma.invoice.findFirst({
              where: { contractId: state.contractId },
              orderBy: { createdAt: 'desc' },
              include: {
                payments: true,
                contract: { include: { room: true } },
              },
            });
          }
        } else if (state?.roomId) {
          const contract2 = await this.prisma.contract.findFirst({
            where: { roomId: state.roomId, isActive: true },
            include: { room: true },
          });
          if (contract2) {
            // Try unpaid first
            invoice = await this.prisma.invoice.findFirst({
              where: {
                contractId: contract2.id,
                status: {
                  in: [
                    InvoiceStatus.SENT,
                    InvoiceStatus.DRAFT,
                    InvoiceStatus.OVERDUE,
                  ],
                },
              },
              orderBy: { createdAt: 'desc' },
              include: {
                payments: true,
                contract: { include: { room: true } },
              },
            });
            // Fallback: any latest invoice
            if (!invoice) {
              invoice = await this.prisma.invoice.findFirst({
                where: { contractId: contract2.id },
                orderBy: { createdAt: 'desc' },
                include: {
                  payments: true,
                  contract: { include: { room: true } },
                },
              });
            }
          }
        }
        if (!invoice) {
          // Last resort: pick latest unpaid invoice across all contracts
          invoice = await this.prisma.invoice.findFirst({
            where: {
              status: {
                in: [
                  InvoiceStatus.SENT,
                  InvoiceStatus.DRAFT,
                  InvoiceStatus.OVERDUE,
                ],
              },
            },
            orderBy: { createdAt: 'desc' },
            include: { payments: true, contract: { include: { room: true } } },
          });
          if (!invoice) {
            return this.replyText(
              event.replyToken,
              'กรุณาเลือกห้องที่จะรับชำระก่อน',
            );
          }
          this.setPaymentContextWithTimeout(userId, invoice.id);
        }
      }
    }

    if (!invoice) {
      // Try verifying slip first to extract amount and then match invoice by amount
      const filenameTmp = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const filepathTmp = join(this.mediaService.getUploadDir(), filenameTmp);
      let slipUrlTmp: string | null = null;
      try {
        const apiUrl = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
        const res = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${this.channelAccessToken}` },
        });
        if (res.ok && res.body) {
          const stream = Readable.fromWeb(
            res.body as unknown as NodeReadableStream<Uint8Array>,
          );
          await pipeline(stream, createWriteStream(filepathTmp));
          const baseUrl =
            process.env.PUBLIC_API_URL ||
            process.env.INTERNAL_API_URL ||
            process.env.API_URL ||
            'https://line-sisom.washqueue.com';
          slipUrlTmp = this.mediaService.buildUrlFromBase(baseUrl, filenameTmp);
        }
      } catch {}
      let slipAmount: number | undefined = undefined;
      if (slipUrlTmp) {
        const v1 = await this.slipOk.verifyByUrl(slipUrlTmp);
        slipAmount = v1.amount;
        if (!slipAmount) {
          const v2 = await this.slipOk.verifyByData(filepathTmp);
          slipAmount = v2.amount;
        }
      }
      if (typeof slipAmount === 'number' && isStaff) {
        const state = this.staffPaymentState.get(userId || '');
        const whereBase: any = {
          status: {
            in: [
              InvoiceStatus.SENT,
              InvoiceStatus.DRAFT,
              InvoiceStatus.OVERDUE,
            ],
          },
        };
        if (state?.contractId) {
          whereBase.contractId = state.contractId;
        } else if (state?.roomId) {
          const c = await this.prisma.contract.findFirst({
            where: { roomId: state.roomId, isActive: true },
          });
          if (c) whereBase.contractId = c.id;
        }
        // Find by amount (allow ±1 THB)
        const candidates = await this.prisma.invoice.findMany({
          where: {
            ...whereBase,
            totalAmount: { gte: slipAmount - 1, lte: slipAmount + 1 },
          },
          orderBy: { createdAt: 'desc' },
          include: { payments: true, contract: { include: { room: true } } },
        });
        const pick = candidates[0];
        if (pick) {
          invoice = pick;
          this.setPaymentContextWithTimeout(userId, invoice.id);
        }
      }
      if (!invoice) {
        // As a final fallback for Staff: pick latest invoice globally
        if (isStaff) {
          invoice = await this.prisma.invoice.findFirst({
            orderBy: { createdAt: 'desc' },
            include: { payments: true, contract: { include: { room: true } } },
          });
          if (invoice) {
            this.setPaymentContextWithTimeout(userId, invoice.id);
          }
        }
      }
      if (!invoice) {
        return this.replyText(event.replyToken, 'ไม่พบใบแจ้งหนี้ที่ต้องชำระ');
      }
    }

    // Clear context after use (optional, but good practice to avoid stuck context)
    // However, if payment fails (e.g. invalid slip), maybe we want to keep it?
    // Let's keep it for now, or maybe clear it only on success.
    // Actually, if they send another slip, it might be for a different invoice if they didn't click the button again.
    // But usually the flow is Button -> Slip.
    // Let's leave it in map, it will be overwritten by next button click.

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filepath = join(this.mediaService.getUploadDir(), filename);
    let slipUrl: string | null = null;
    try {
      const apiUrl = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
      const res = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      });
      if (!res.ok) {
        throw new Error(`LINE fetch failed: ${res.status} ${res.statusText}`);
      }
      const body = res.body;
      if (!body) {
        throw new Error('LINE response has no body');
      }
      const stream = Readable.fromWeb(
        body as unknown as NodeReadableStream<Uint8Array>,
      );
      await pipeline(stream, createWriteStream(filepath));
      try {
        const img = await Jimp.read(filepath);
        const maxW = 1200;
        if (img.getWidth() > maxW) {
          img.resize(maxW, Jimp.AUTO);
        }
        img.quality(80);
        await img.writeAsync(filepath);
      } catch (e) {
        this.logger.warn(
          `Image resize/compress failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      const baseUrl =
        process.env.PUBLIC_API_URL ||
        process.env.INTERNAL_API_URL ||
        process.env.API_URL ||
        'https://line-sisom.washqueue.com';
      slipUrl = this.mediaService.buildUrlFromBase(baseUrl, filename);
    } catch (e) {
      this.logger.warn(
        `Failed to save slip image: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!slipUrl) {
      return this.replyText(
        event.replyToken,
        'ระบบไม่สามารถบันทึกสลิปได้ กรุณาส่งใหม่อีกครั้ง',
      );
    }

    await this.replyText(
      event.replyToken,
      `รับสลิปแล้ว ห้อง ${invoice.contract?.room?.number || contract?.room?.number || '-'} อยู่ระหว่างตรวจสอบ`,
    );

    const verifyUrl = await this.slipOk.verifyByUrl(
      slipUrl,
      Number(invoice.totalAmount),
    );
    const verify = verifyUrl.ok
      ? verifyUrl
      : await this.slipOk.verifyByData(filepath, Number(invoice.totalAmount));
    const slipMeta = {
      amount: verify.amount ?? Number(invoice.totalAmount),
      destBank: verify.destBank,
      destAccount: verify.destAccount,
      transactedAt: verify.transactedAt,
      bankRef: verify.bankRef,
      message: verify.message,
      duplicate: verify.duplicate ?? false,
    };

    const paymentAmount = verify.amount ?? Number(invoice.totalAmount);
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: paymentAmount,
        slipImageUrl: slipUrl,
        slipBankRef: JSON.stringify(slipMeta),
        status: verify.ok ? PaymentStatus.VERIFIED : PaymentStatus.PENDING,
        paidAt: verify.ok
          ? verify.transactedAt
            ? new Date(verify.transactedAt)
            : new Date()
          : undefined,
        verifiedBy: verify.ok ? 'AUTO' : undefined,
      },
    });

    // Calculate total paid including this new payment
    const previousPaid = (invoice.payments || []).reduce(
      (sum: number, p: any) => sum + Number(p.amount),
      0,
    );
    const totalPaid = previousPaid + Number(paymentAmount);
    const remaining = Number(invoice.totalAmount) - totalPaid;

    // Update invoice status if fully paid
    if (verify.ok && remaining <= 1) {
      // Allow small diff for rounding
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.PAID },
      });
    }

    const delayMs = 1000; // Reduced delay for better UX
    if (verify.ok) {
      if (remaining > 1) {
        // Partial payment case
        await this.replyText(
          event.replyToken,
          `ได้รับยอดชำระ ${paymentAmount.toLocaleString()} บาท\nยอดคงเหลือ ${remaining.toLocaleString()} บาท\nกรุณาชำระส่วนที่เหลือ`,
        );
      } else {
        // Full payment case
        try {
          const when = verify.transactedAt
            ? new Date(verify.transactedAt).toLocaleString('th-TH', {
                timeZone: 'Asia/Bangkok',
              })
            : '—';
          const period = `${this.thaiMonth(invoice.month)} ${invoice.year}`;
          const dest =
            [verify.destBank, verify.destAccount].filter(Boolean).join(' / ') ||
            '—';
          const amt = paymentAmount.toLocaleString();
          const roomNum =
            invoice.contract?.room?.number || contract?.room?.number || '-';
          const flex = this.buildSlipFlex('SUCCESS', {
            amount: amt,
            room: roomNum,
            dest,
            when,
            period,
          });
          setTimeout(() => {
            this.pushFlex(userId, flex).catch((e) => {
              this.logger.warn(
                `pushFlex failed: ${e instanceof Error ? e.message : String(e)}`,
              );
            });
          }, delayMs);
        } catch (e) {
          this.logger.warn(
            `Failed to push flex: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } else if (verify.duplicate) {
      try {
        const when = verify.transactedAt
          ? new Date(verify.transactedAt).toLocaleString('th-TH', {
              timeZone: 'Asia/Bangkok',
            })
          : '—';
        const period = `${this.thaiMonth(invoice.month)} ${invoice.year}`;
        const roomNum =
          invoice.contract?.room?.number || contract?.room?.number || '-';
        const flex = this.buildSlipFlex('DUPLICATE', {
          room: roomNum,
          when,
          period,
        });
        setTimeout(() => {
          this.pushFlex(userId, flex).catch((e) => {
            this.logger.warn(
              `pushFlex failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
        }, delayMs);
      } catch (e) {
        this.logger.warn(
          `Failed to push flex: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      try {
        const when = verify.transactedAt
          ? new Date(verify.transactedAt).toLocaleString('th-TH', {
              timeZone: 'Asia/Bangkok',
            })
          : '—';
        const period = `${this.thaiMonth(invoice.month)} ${invoice.year}`;
        const roomNum =
          invoice.contract?.room?.number || contract?.room?.number || '-';
        const flex = this.buildSlipFlex('INVALID', {
          room: roomNum,
          when,
          reason: verify.message ?? 'สลิปไม่ถูกต้อง',
          period,
        });
        setTimeout(() => {
          this.pushFlex(userId, flex).catch((e) => {
            this.logger.warn(
              `pushFlex failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
        }, delayMs);
      } catch (e) {
        this.logger.warn(
          `Failed to push flex: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return null;
  }

  async pushMessage(userId: string, text: string) {
    if (!this.client) {
      this.logger.warn('Line Client not initialized');
      return;
    }
    const res = await this.client.pushMessage({
      to: userId,
      messages: [{ type: 'text', text }],
    });
    this.recordMessage('push_text');
    this.addRecentChat({ userId, type: 'sent_text', text });
    return res;
  }

  getMoveOutStateByTenantId = async (tenantId: string) => {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t?.lineUserId) return null;
    const state = this.moveOutRequests.get(t.lineUserId);
    if (!state) return null;
    return {
      requestedAt: state.requestedAt,
      days: state.days ?? 7,
      bankInfo: state.bankInfo,
    };
  };

  getMoveOutDaysByUserId(userId?: string | null): number {
    if (!userId) return 7;
    const s = this.moveOutRequests.get(userId);
    return s?.days ?? 7;
  }

  async notifyMoveoutForDate(dateStr?: string) {
    const target =
      dateStr && dateStr.trim().length > 0
        ? dateStr.trim()
        : new Date().toISOString().slice(0, 10);
    const list = await this.prisma.maintenanceRequest.findMany({
      where: {
        title: 'แจ้งย้ายออก',
        description: {
          contains: `วันที่ย้ายออก: ${target}`,
        },
      },
      include: {
        room: {
          include: {
            building: true,
          },
        },
      },
    });
    if (!list.length) {
      return { ok: true, date: target, count: 0 };
    }
    const lines = list.map((req) => {
      const room = req.room;
      const buildingName = room.building?.name || room.building?.code || '-';
      return `- ตึก ${buildingName} ชั้น ${room.floor} ห้อง ${room.number}`;
    });
    const msg = [`แจ้งเตือนห้องที่จะย้ายออกในวันที่ ${target}`, ...lines].join(
      '\n',
    );
    const targets = await this.getLineNotifyTargets();
    for (const uid of targets) {
      if (uid) {
        await this.pushMessage(uid, msg);
      }
    }
    return { ok: true, date: target, count: list.length };
  }

  getLinkRequestsByRoom(roomId: string) {
    return (this.linkRequests.get(roomId) || [])
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async acceptLink(roomId: string, userId: string, tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) return { ok: false };
    if (tenant.lineUserId) {
      const listExisting = (this.linkRequests.get(roomId) || []).filter(
        (r) => !(r.userId === userId && r.tenantId === tenantId),
      );
      this.linkRequests.set(roomId, listExisting);
      if (userId) {
        if (tenant.lineUserId === userId) {
          await this.pushMessage(
            userId,
            'บัญชี LINE นี้เชื่อมกับหอพักเรียบร้อยแล้ว',
          );
        } else {
          await this.pushMessage(
            userId,
            'ห้องนี้มีการเชื่อมบัญชี LINE แล้ว หากต้องการเปลี่ยน กรุณาติดต่อผู้ดูแล',
          );
        }
      }
      return { ok: false };
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { lineUserId: userId },
    });
    const list = (this.linkRequests.get(roomId) || []).filter(
      (r) => !(r.userId === userId && r.tenantId === tenantId),
    );
    this.linkRequests.set(roomId, list);
    if (userId) {
      await this.linkMenuForUser(userId, 'TENANT');
      await this.pushMessage(userId, 'เชื่อมบัญชี LINE กับหอพักเรียบร้อย');
    }
    return { ok: true };
  }

  async rejectLink(roomId: string, userId: string) {
    const list = (this.linkRequests.get(roomId) || []).filter(
      (r) => r.userId !== userId,
    );
    this.linkRequests.set(roomId, list);
    if (userId) await this.pushMessage(userId, 'ยกเลิกคำขอเชื่อมต่อเรียบร้อย');
    return { ok: true };
  }

  async apiSetDefaultRichMenuGeneral() {
    await this.setDefaultRichMenuGeneral();
    return { ok: true };
  }

  async apiLinkRichMenu(body: {
    userId: string;
    kind: 'GENERAL' | 'TENANT' | 'ADMIN';
  }) {
    const input = (body.userId || '').trim();
    let targetUid = input;
    try {
      // If input is not a LINE user id (doesn't start with 'U'), try to resolve from DB by internal user id
      const looksLikeLineId = /^U[a-f0-9]{32}$/i.test(input);
      if (!looksLikeLineId) {
        const record = await this.prisma.user.findUnique({
          where: { id: input },
          select: { lineUserId: true },
        });
        if (record?.lineUserId) {
          targetUid = record.lineUserId;
        }
      }
      await this.linkMenuForUser(targetUid, body.kind);
      return { ok: true, linkedUserId: targetUid };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async apiCreateGeneralRichMenuFromLocal() {
    if (!this.client) {
      return { ok: false, error: 'Line client not initialized' };
    }
    const { existsSync, copyFileSync, readFileSync } = await import('fs');
    const { join, extname } = await import('path');
    const uploadCandidate = join(
      '/app/uploads',
      'richmenu-a-1771048926187.png',
    );
    let localPath = uploadCandidate;
    if (!existsSync(localPath)) {
      localPath = join(this.projectRoot, 'richmenu', 'a.png');
    }
    if (!existsSync(localPath)) {
      localPath = join(this.projectRoot, 'richmenu', 'a.jpg');
    }
    if (!existsSync(localPath)) {
      // Fallback for absolute path if projectRoot is not what we expect
      localPath = '/root/line-sisom/richmenu/a.png';
      if (!existsSync(localPath)) {
        localPath = '/root/line-sisom/richmenu/a.jpg';
      }
    }
    if (!existsSync(localPath)) {
      return { ok: false, error: `File not found: ${localPath}` };
    }
    const payload = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'defualt',
      chatBarText: 'Bulletin',
      areas: [
        {
          bounds: { x: 116, y: 132, width: 2272, height: 697 },
          action: { type: 'message', text: 'รายละเอียดห้องพัก' },
        },
        {
          bounds: { x: 124, y: 957, width: 664, height: 673 },
          action: {
            type: 'uri',
            uri: 'https://cms.washqueue.com/gallery',
          },
        },
        {
          bounds: { x: 932, y: 965, width: 648, height: 660 },
          action: { type: 'message', text: 'ติดต่อสอบถาม' },
        },
        {
          bounds: { x: 1720, y: 953, width: 660, height: 672 },
          action: { type: 'message', text: 'REGISTERSISOM' },
        },
      ],
    } as any;
    const createRes = await this.client.createRichMenu(payload);
    const richMenuId =
      (createRes as any)?.richMenuId ||
      (createRes as unknown as { richMenuId: string }).richMenuId;
    const buf = readFileSync(localPath);
    // Skip uploading richmenu image to avoid upstream size limit issues
    const ext = extname(localPath).toLowerCase();
    const uploadsName = `richmenu-a-${Date.now()}${ext}`;
    const uploadsPath = join(this.mediaService.getUploadDir(), uploadsName);
    copyFileSync(localPath, uploadsPath);
    const baseUrl =
      process.env.PUBLIC_API_URL ||
      process.env.INTERNAL_API_URL ||
      process.env.API_URL ||
      'https://line-sisom.washqueue.com';
    const imageUrl = this.mediaService.buildUrlFromBase(baseUrl, uploadsName);
    try {
      const metaPath = join(
        this.mediaService.getUploadDir(),
        'richmenu-general.json',
      );
      writeFileSync(metaPath, JSON.stringify({ richMenuId }, null, 2), 'utf8');
    } catch {}
    await this.setDefaultRichMenu(richMenuId);
    return { ok: true, richMenuId, imageUrl };
  }

  async apiCreateTenantRichMenuFromLocal() {
    if (!this.client) {
      return { ok: false, error: 'Line client not initialized' };
    }
    const { existsSync, copyFileSync, readFileSync } = await import('fs');
    const { join, extname } = await import('path');
    let localPath = join(this.projectRoot, 'richmenu', 'b.png');
    if (!existsSync(localPath)) {
      localPath = join(this.projectRoot, 'richmenu', 'b.jpg');
    }
    if (!existsSync(localPath)) {
      // Fallback
      localPath = '/root/line-sisom/richmenu/b.png';
      if (!existsSync(localPath)) {
        localPath = '/root/line-sisom/richmenu/b.jpg';
      }
    }
    if (!existsSync(localPath)) {
      return { ok: false, error: `File not found: ${localPath}` };
    }
    const payload = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'b',
      chatBarText: 'Bulletin',
      areas: [
        {
          bounds: { x: 58, y: 54, width: 718, height: 746 },
          action: { type: 'message', text: 'ตรวจสอบค่าเช่า' },
        },
        {
          bounds: { x: 875, y: 70, width: 746, height: 726 },
          action: { type: 'message', text: 'เลขบัญชีหอพัก' },
        },
        {
          bounds: { x: 1729, y: 54, width: 730, height: 742 },
          action: { type: 'message', text: 'แจ้งย้ายออก' },
        },
        {
          bounds: { x: 45, y: 891, width: 743, height: 755 },
          action: {
            type: 'message',
            text: '713 ตำบลหนองระเวียง อำเภอเมือง จังหวัดนครราชสีมา 30000',
          },
        },
        {
          bounds: { x: 883, y: 887, width: 738, height: 738 },
          action: { type: 'message', text: 'แจ้งซ่อม' },
        },
        {
          bounds: { x: 1724, y: 908, width: 743, height: 726 },
          action: { type: 'message', text: 'เบอร์ติดต่อ 092 426 9477' },
        },
      ],
    } as any;
    const createRes = await this.client.createRichMenu(payload);
    const richMenuId =
      (createRes as any)?.richMenuId ||
      (createRes as unknown as { richMenuId: string }).richMenuId;
    const buf = readFileSync(localPath);
    if (this.blobClient) {
      const ext = extname(localPath).toLowerCase();
      const mimeType =
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      const blob: any = new Blob([buf], { type: mimeType });
      await this.blobClient.setRichMenuImage(richMenuId, blob);
    }
    const ext = extname(localPath).toLowerCase();
    const uploadsName = `richmenu-b-${Date.now()}${ext}`;
    const uploadsPath = join(this.mediaService.getUploadDir(), uploadsName);
    copyFileSync(localPath, uploadsPath);
    const baseUrl =
      process.env.PUBLIC_API_URL ||
      process.env.INTERNAL_API_URL ||
      process.env.API_URL ||
      'https://line-sisom.washqueue.com';
    const imageUrl = this.mediaService.buildUrlFromBase(baseUrl, uploadsName);
    return { ok: true, richMenuId, imageUrl };
  }

  async apiCreateAdminRichMenuFromLocal() {
    if (!this.client) {
      return { ok: false, error: 'Line client not initialized' };
    }
    const { existsSync, copyFileSync, readFileSync } = await import('fs');
    const { join, extname } = await import('path');
    let localPath = join(this.projectRoot, 'richmenu', 'c.png');
    if (!existsSync(localPath)) {
      localPath = join(this.projectRoot, 'richmenu', 'c.jpg');
    }
    if (!existsSync(localPath)) {
      // Fallback
      localPath = '/root/line-sisom/richmenu/c.png';
      if (!existsSync(localPath)) {
        localPath = '/root/line-sisom/richmenu/c.jpg';
      }
    }
    if (!existsSync(localPath)) {
      return { ok: false, error: `File not found: ${localPath}` };
    }
    const meterPath = '/meter';
    const meterUrl = this.liffId
      ? `https://liff.line.me/${this.liffId}?path=${encodeURIComponent(meterPath)}`
      : 'https://line-sisom.washqueue.com/meter';
    const payload = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: 'c',
      chatBarText: 'Bulletin',
      areas: [
        {
          bounds: { x: 12, y: 0, width: 821, height: 825 },
          action: { type: 'message', text: 'ห้องค้างชำระ' },
        },
        {
          bounds: { x: 858, y: 12, width: 792, height: 805 },
          action: { type: 'uri', uri: meterUrl },
        },
        {
          bounds: { x: 1683, y: 8, width: 809, height: 825 },
          action: { type: 'message', text: 'รายการแจ้งซ่อม' },
        },
        {
          bounds: { x: 17, y: 870, width: 1208, height: 805 },
          action: { type: 'message', text: 'รับชำระเงิน' },
        },
        {
          bounds: { x: 1283, y: 862, width: 1196, height: 813 },
          action: { type: 'message', text: 'แจ้งย้าย' },
        },
      ],
    } as any;
    const createRes = await this.client.createRichMenu(payload);
    const richMenuId =
      (createRes as any)?.richMenuId ||
      (createRes as unknown as { richMenuId: string }).richMenuId;
    const buf = readFileSync(localPath);
    if (this.blobClient) {
      const ext = extname(localPath).toLowerCase();
      const mimeType =
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      const blob: any = new Blob([buf], { type: mimeType });
      await this.blobClient.setRichMenuImage(richMenuId, blob);
    }
    const ext = extname(localPath).toLowerCase();
    const uploadsName = `richmenu-c-${Date.now()}${ext}`;
    const uploadsPath = join(this.mediaService.getUploadDir(), uploadsName);
    copyFileSync(localPath, uploadsPath);
    const baseUrl =
      process.env.PUBLIC_API_URL ||
      process.env.INTERNAL_API_URL ||
      process.env.API_URL ||
      'https://line-sisom.washqueue.com';
    const imageUrl = this.mediaService.buildUrlFromBase(baseUrl, uploadsName);
    return { ok: true, richMenuId, imageUrl };
  }

  async apiLinkRichMenuById(userId: string, richMenuId: string) {
    await this.linkRichMenu(userId, richMenuId);
    return { ok: true };
  }
  async apiUnlinkRichMenu(body: {
    userId: string;
    fallbackTo?: 'GENERAL' | 'TENANT' | 'ADMIN';
  }) {
    let targetUid = (body.userId || '').trim();
    try {
      const looksLikeLineId = /^U[a-f0-9]{32}$/i.test(targetUid);
      if (!looksLikeLineId) {
        const record = await this.prisma.user.findUnique({
          where: { id: targetUid },
          select: { lineUserId: true },
        });
        if (record?.lineUserId) {
          targetUid = record.lineUserId;
        }
      }
      await this.unlinkRichMenu(targetUid);
      if (body.fallbackTo) {
        await this.linkMenuForUser(targetUid, body.fallbackTo);
      }
      return {
        ok: true,
        unlinkedUserId: targetUid,
        fallbackTo: body.fallbackTo ?? null,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  async apiIsStaff(userId?: string) {
    const uid = (userId || '').trim();
    if (!uid) return { isStaff: false };
    try {
      const variants = (() => {
        const list = new Set<string>();
        const base = uid;
        if (base) list.add(base);
        const withoutPrefix = base.replace(/^U/i, '');
        if (withoutPrefix && withoutPrefix !== base) list.add(withoutPrefix);
        const withPrefix =
          /^U/i.test(base) || !base ? base : `U${withoutPrefix || base}`;
        if (withPrefix && withPrefix !== base) list.add(withPrefix);
        return Array.from(list);
      })();
      const user = await this.prisma.user.findFirst({
        where: { lineUserId: { in: variants } },
        select: { role: true, permissions: true },
      });
      const byRole = !!user && (user.role === 'OWNER' || user.role === 'ADMIN');
      const byPerm =
        !!user &&
        Array.isArray(user.permissions) &&
        user.permissions.includes('meter');
      const byEnv = this.isStaffUser(uid);
      return { isStaff: Boolean(byRole || byPerm || byEnv) };
    } catch {
      return { isStaff: this.isStaffUser(uid) };
    }
  }

  async apiMapLineUserRole(body: {
    userId: string;
    role: 'STAFF' | 'ADMIN' | 'OWNER';
  }) {
    const userId = (body.userId || '').trim();
    const role = body.role;
    if (!userId) return { ok: false, error: 'userId is required' };
    if (!['STAFF', 'ADMIN', 'OWNER'].includes(role))
      return { ok: false, error: 'invalid role' };
    const add = (arr: string[]) => {
      if (!arr.includes(userId)) arr.push(userId);
    };
    if (role === 'STAFF') add(this.staffUserIds);
    if (role === 'ADMIN') add(this.adminUserIds);
    if (role === 'OWNER') {
      add(this.adminUserIds);
      add(this.staffUserIds);
    }
    return {
      ok: true,
      staffCount: this.staffUserIds.length,
      adminCount: this.adminUserIds.length,
    };
  }

  async pushRejectFlex(
    userId: string,
    room: string,
    when?: string,
    reason?: string,
    period?: string,
  ) {
    const flex = this.buildSlipFlex('INVALID', {
      room,
      when:
        when ||
        new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      period,
      reason: reason || 'สลิปไม่ถูกต้อง',
    });
    return this.pushFlex(userId, flex);
  }

  private async pushFlex(userId: string, message: unknown) {
    if (!this.client) return;
    const altText = (() => {
      if (typeof message !== 'object' || message === null) return 'n/a';
      const m = message as Record<string, unknown>;
      return typeof m.altText === 'string' ? m.altText : 'n/a';
    })();
    try {
      this.logger.log(`pushFlex: to=${userId} altText=${altText}`);
    } catch (e) {
      void e;
    }
    const res = await this.client.pushMessage({
      to: userId,
      messages: [message as messagingApi.Message],
    });
    this.recordMessage('push_flex');
    this.addRecentChat({ userId, type: 'sent_flex', altText });
    return res;
  }

  private buildSlipFlex(
    status: 'SUCCESS' | 'DUPLICATE' | 'INVALID',
    data: {
      amount?: string;
      room: string;
      dest?: string;
      when: string;
      period?: string;
      reason?: string;
    },
  ) {
    const logoUrl =
      this.getDormLogoUrl() ||
      process.env.SLIP_FLEX_LOGO_URL ||
      `${process.env.PUBLIC_API_URL || ''}/api/media/logo.png`;
    const cfg =
      status === 'SUCCESS'
        ? { title: 'สลิปถูกต้อง', color: '#2ecc71' }
        : status === 'DUPLICATE'
          ? { title: 'สลิปซ้ำ', color: '#f1c40f' }
          : { title: 'สลิปไม่ถูกต้อง', color: '#e74c3c' };
    const headerContents: Array<Record<string, unknown>> = [];
    if (logoUrl && logoUrl.startsWith('http')) {
      headerContents.push({
        type: 'image',
        url: logoUrl,
        size: 'sm',
        aspectMode: 'cover',
      });
    }
    headerContents.push({
      type: 'text',
      text: cfg.title,
      weight: 'bold',
      color: '#ffffff',
      size: 'md',
      wrap: true,
      margin: logoUrl ? 'md' : 'none',
    });
    const header: Record<string, unknown> = {
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      alignItems: 'center',
      backgroundColor: cfg.color,
      paddingAll: '12px',
      contents: headerContents,
    };
    const rows: Array<Record<string, unknown>> = [];
    if (data.amount) {
      rows.push({
        type: 'text',
        text: `฿ ${data.amount}`,
        weight: 'bold',
        size: 'xl',
        wrap: true,
      });
    }
    rows.push({
      type: 'text',
      text: `ห้อง ${data.room}`,
      size: 'sm',
      color: '#666666',
      wrap: true,
    });
    if (data.dest) {
      rows.push({
        type: 'text',
        text: `ปลายทาง: ${data.dest}`,
        size: 'sm',
        color: '#666666',
        wrap: true,
      });
    }
    rows.push({
      type: 'text',
      text: `เวลา: ${data.when}`,
      size: 'sm',
      color: '#666666',
      wrap: true,
    });
    if (data.period) {
      rows.push({
        type: 'text',
        text: `เดือนที่ชำระ: ${data.period}`,
        size: 'sm',
        color: '#666666',
        wrap: true,
      });
    }
    if (data.reason && status === 'INVALID') {
      rows.push({
        type: 'text',
        text: `สาเหตุ: ${data.reason}`,
        size: 'sm',
        color: '#666666',
        wrap: true,
        maxLines: 5,
      });
    }
    const successExtra: Array<Record<string, unknown>> =
      status === 'SUCCESS'
        ? [
            {
              type: 'text',
              text: 'ตัดยอดเรียบร้อย',
              size: 'sm',
              color: '#2c3e50',
              wrap: true,
            },
          ]
        : [];
    const body: Record<string, unknown> = {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      spacing: 'sm',
      contents: [...rows, ...successExtra],
    };
    return {
      type: 'flex',
      altText: `ผลตรวจสลิป (${cfg.title})`,
      contents: {
        type: 'bubble',
        // omit size to use default full width
        header,
        body,
      },
    };
  }

  private getDormLogoUrl(): string | undefined {
    try {
      const uploadsDir = resolve('/app/uploads');
      const p = join(uploadsDir, 'dorm-extra.json');
      if (!existsSync(p)) return undefined;
      const raw = readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      const url =
        typeof parsed.logoUrl === 'string' ? parsed.logoUrl : undefined;
      if (url && /^https?:\/\//.test(url)) return url;
      return undefined;
    } catch {
      return undefined;
    }
  }

  async pushSuccessFlex(
    userId: string,
    room: string,
    amount?: number,
    when?: Date,
    dest?: string,
    period?: string,
  ) {
    const amtStr =
      typeof amount === 'number' ? amount.toLocaleString() : undefined;
    const whenStr = (when || new Date()).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
    });
    const flex = this.buildSlipFlex('SUCCESS', {
      amount: amtStr,
      room,
      dest,
      when: whenStr,
      period,
    });
    return this.pushFlex(userId, flex);
  }

  async notifyStaffPaymentSuccess(params: {
    room: string;
    amount?: number;
    period?: string;
    paidAt?: Date;
    tenantName?: string;
  }) {
    const targets = await this.getLineNotifyTargets();
    if (!targets.length) return;
    const paidAt = params.paidAt || new Date();
    const whenStr = paidAt.toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
    });
    const amountStr =
      typeof params.amount === 'number'
        ? params.amount.toLocaleString('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : undefined;
    const header = 'แจ้งเตือนการชำระเงินค่าเช่าผ่านระบบแล้ว';
    const lines = [
      params.tenantName && params.tenantName.trim()
        ? `ผู้เช่า: ${params.tenantName.trim()}`
        : undefined,
      `ห้อง: ${params.room}`,
      params.period ? `รอบบิล: ${params.period}` : undefined,
      amountStr ? `ยอดที่ชำระ: ${amountStr} บาท` : undefined,
      `เวลา: ${whenStr}`,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    const contents: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: header,
        weight: 'bold',
        size: 'md',
        wrap: true,
      },
      ...lines.map((text) => ({
        type: 'text',
        text,
        size: 'sm',
        wrap: true,
      })),
    ];
    const flex = {
      type: 'flex',
      altText: header,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '12px',
          spacing: 'sm',
          contents,
        },
      },
    };
    for (const uid of targets) {
      if (uid) {
        await this.pushFlex(uid, flex);
      }
    }
  }

  private buildRentBillFlex(data: {
    room: string;
    monthLabel: string;
    rentAmount: number;
    waterAmount: number;
    electricAmount: number;
    otherFees: number;
    discount: number;
    totalAmount: number;
    buildingLabel?: string;
    bankInstruction?: string;
  }) {
    const heroUrl =
      process.env.RENT_FLEX_HERO_URL ||
      'https://img2.pic.in.th/imagef8d247a8c00bfa80.png';
    const lineUrl = 'https://line.me/';
    const iconMonth =
      'https://cdn-icons-png.freepik.com/512/10691/10691802.png';
    const iconWater = 'https://cdn-icons-png.flaticon.com/512/3105/3105807.png';
    const iconElectric =
      'https://png.pngtree.com/png-vector/20241019/ourmid/pngtree-yellow-lightning-bolt-clipart-energy-power-speed-electric-symbol-icon-png-image_14114467.png';
    const iconRoom =
      'https://icons.veryicon.com/png/o/media/home-furnishing-icon/room-1.png';
    const iconOther = 'https://cdn-icons-png.flaticon.com/512/2454/2454282.png';
    const iconDiscount =
      'https://cdn-icons-png.flaticon.com/512/879/879757.png';

    const fmt = (n: number) => `${Number(n).toLocaleString()} บาท`;
    const roomLine =
      data.buildingLabel && data.buildingLabel.trim()
        ? `${data.buildingLabel.trim()} ห้อง ${data.room}`
        : `ห้อง ${data.room}`;

    const utilityRows: any[] = [
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'icon', url: iconWater },
          {
            type: 'text',
            text: 'ค่าน้ำ',
            weight: 'bold',
            margin: 'sm',
            flex: 0,
          },
          {
            type: 'text',
            text: fmt(data.waterAmount),
            size: 'sm',
            align: 'end',
            color: '#aaaaaa',
          },
        ],
      },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'icon', url: iconElectric },
          {
            type: 'text',
            text: 'ค่าไฟ',
            weight: 'bold',
            margin: 'sm',
            flex: 0,
          },
          {
            type: 'text',
            text: fmt(data.electricAmount),
            size: 'sm',
            align: 'end',
            color: '#aaaaaa',
          },
        ],
      },
    ];

    if (data.otherFees > 0) {
      utilityRows.push({
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'icon', url: iconOther },
          {
            type: 'text',
            text: 'ค่าอื่นๆ',
            weight: 'bold',
            margin: 'sm',
            flex: 0,
          },
          {
            type: 'text',
            text: fmt(data.otherFees),
            size: 'sm',
            align: 'end',
            color: '#aaaaaa',
          },
        ],
      });
    }

    if (data.discount > 0) {
      utilityRows.push({
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'icon', url: iconDiscount },
          {
            type: 'text',
            text: 'ส่วนลด',
            weight: 'bold',
            margin: 'sm',
            flex: 0,
          },
          {
            type: 'text',
            text: `-${fmt(data.discount)}`,
            size: 'sm',
            align: 'end',
            color: '#2ecc71',
          },
        ],
      });
    }

    const contents: Array<Record<string, unknown>> = [
      { type: 'text', text: roomLine, size: 'xl', weight: 'bold', flex: 0 },
      {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              { type: 'icon', url: iconMonth },
              {
                type: 'text',
                text: 'เดือน',
                weight: 'bold',
                margin: 'md',
                flex: 0,
                align: 'start',
                size: 'lg',
              },
              { type: 'text', text: data.monthLabel, size: 'lg', align: 'end' },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: utilityRows,
          },
        ],
      },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'icon', url: iconRoom },
          {
            type: 'text',
            text: 'ค่าห้อง',
            weight: 'bold',
            margin: 'sm',
            flex: 0,
          },
          {
            type: 'text',
            text: fmt(data.rentAmount),
            size: 'sm',
            align: 'end',
            color: '#aaaaaa',
          },
        ],
      },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          {
            type: 'text',
            text: 'รวมทั้งหมด',
            weight: 'bold',
            margin: 'sm',
            flex: 0,
          },
          {
            type: 'text',
            text: fmt(data.totalAmount),
            size: 'sm',
            align: 'end',
          },
        ],
      },
      ...(data.bankInstruction
        ? [
            {
              type: 'text',
              text: data.bankInstruction,
              color: '#e84e40',
            } as Record<string, unknown>,
          ]
        : []),
      {
        type: 'text',
        text: 'โปรดชำระไม่เกินวันที่ 5 ของทุกเดือน',
        wrap: true,
        color: '#aaaaaa',
        size: 'xxs',
      },
    ];
    return {
      type: 'flex',
      altText: 'บิลค่าเช่า',
      contents: {
        type: 'bubble',
        hero: {
          type: 'image',
          url: heroUrl,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
          action: { type: 'uri', uri: lineUrl },
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          action: { type: 'uri', uri: lineUrl },
          contents,
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#FF6413',
              margin: 'xxl',
              action: {
                type: 'message',
                label: 'ชำระค่าห้อง',
                text: `ชำระค่าห้อง ${data.monthLabel}`,
              },
            },
          ],
        },
      },
    };
  }

  async pushRentBillFlex(
    userId: string,
    input: {
      room: string;
      month: number;
      year: number;
      rentAmount: number;
      waterAmount: number;
      electricAmount: number;
      otherFees: number;
      discount: number;
      totalAmount: number;
      buildingLabel?: string;
      bankInstruction?: string;
    },
  ) {
    const monthLabel = `${this.thaiMonth(input.month)} ${input.year}`;
    const flex = this.buildRentBillFlex({
      room: input.room,
      monthLabel,
      rentAmount: input.rentAmount,
      waterAmount: input.waterAmount,
      electricAmount: input.electricAmount,
      otherFees: input.otherFees,
      discount: input.discount,
      totalAmount: input.totalAmount,
      buildingLabel: input.buildingLabel,
      bankInstruction: input.bankInstruction,
    });
    return this.pushFlex(userId, flex);
  }
}
