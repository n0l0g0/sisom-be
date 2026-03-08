import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DormConfig } from '@prisma/client';
import { UpdateDormConfigDto } from './dto/update-dorm-config.dto';
import { DormExtraDto } from './dto/dorm-extra.dto';
import { tenantContext } from '../tenant-db/tenant-context';
import * as fs from 'fs';
import * as path from 'path';

const EXTRA_CACHE_KEY = '_dormExtra';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private pickNum(value: unknown, fallback?: unknown): number | undefined {
    const nv = Number(value);
    if (Number.isFinite(nv)) return nv;
    const nf = Number(fallback);
    return Number.isFinite(nf) ? nf : undefined;
  }

  private pickString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  getDormConfig() {
    return this.prisma.dormConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });
  }
  async getEffectiveDormConfig(): Promise<any> {
    const local = await this.getDormConfig();
    let external: Record<string, unknown> | null = null;
    try {
      const f = (globalThis as { fetch?: unknown }).fetch;
      const fetchFn = typeof f === 'function' ? (f as typeof fetch) : null;
      if (fetchFn) {
        const resp = await fetchFn(
          'https://cms.washqueue.com/api/settings/rent',
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          },
        );
        if (resp && resp.ok) {
          const data: unknown = await resp.json().catch(() => null);
          external = this.isRecord(data) ? data : null;
        }
      }
    } catch {
      external = null;
    }
    const pickEnum = <T extends string>(v: unknown) =>
      typeof v === 'string' ? (v as T) : undefined;
    const merged: any = {
      ...(local ?? {}),
      waterUnitPrice:
        this.pickNum(external?.waterUnitPrice, local?.waterUnitPrice) ?? 18,
      waterFeeMethod:
        pickEnum(external?.waterFeeMethod) ?? local?.waterFeeMethod,
      waterFlatMonthlyFee: this.pickNum(
        external?.waterFlatMonthlyFee,
        local?.waterFlatMonthlyFee,
      ),
      waterFlatPerPersonFee: this.pickNum(
        external?.waterFlatPerPersonFee,
        local?.waterFlatPerPersonFee,
      ),
      waterMinAmount: this.pickNum(
        external?.waterMinAmount,
        local?.waterMinAmount,
      ),
      waterMinUnits: this.pickNum(
        external?.waterMinUnits,
        local?.waterMinUnits,
      ),
      waterBaseFee: this.pickNum(external?.waterBaseFee, local?.waterBaseFee),
      waterTieredRates: this.isRecord(external)
        ? (external.waterTieredRates as DormConfig['waterTieredRates'])
        : local?.waterTieredRates,
      electricUnitPrice:
        this.pickNum(external?.electricUnitPrice, local?.electricUnitPrice) ??
        7,
      electricFeeMethod:
        pickEnum(external?.electricFeeMethod) ?? local?.electricFeeMethod,
      electricFlatMonthlyFee: this.pickNum(
        external?.electricFlatMonthlyFee,
        local?.electricFlatMonthlyFee,
      ),
      electricMinAmount: this.pickNum(
        external?.electricMinAmount,
        local?.electricMinAmount,
      ),
      electricMinUnits: this.pickNum(
        external?.electricMinUnits,
        local?.electricMinUnits,
      ),
      electricBaseFee: this.pickNum(
        external?.electricBaseFee,
        local?.electricBaseFee,
      ),
      electricTieredRates: this.isRecord(external)
        ? (external.electricTieredRates as DormConfig['electricTieredRates'])
        : local?.electricTieredRates,
      commonFee: this.pickNum(external?.commonFee, local?.commonFee) ?? 300,
      bankAccount: this.pickString(external?.bankAccount) ?? local?.bankAccount,
    };
    return merged;
  }

  async updateDormConfig(data: UpdateDormConfigDto) {
    const existing = await this.prisma.dormConfig.findFirst();
    const baseData: Record<string, unknown> = {
      waterUnitPrice: data.waterUnitPrice ?? 18,
      waterFeeMethod: data.waterFeeMethod,
      waterFlatMonthlyFee: data.waterFlatMonthlyFee,
      waterFlatPerPersonFee: data.waterFlatPerPersonFee,
      waterMinAmount: data.waterMinAmount,
      waterMinUnits: data.waterMinUnits,
      waterBaseFee: data.waterBaseFee,
      waterTieredRates: data.waterTieredRates,
      electricUnitPrice: data.electricUnitPrice ?? 7,
      electricFeeMethod: data.electricFeeMethod,
      electricFlatMonthlyFee: data.electricFlatMonthlyFee,
      electricMinAmount: data.electricMinAmount,
      electricMinUnits: data.electricMinUnits,
      electricBaseFee: data.electricBaseFee,
      electricTieredRates: data.electricTieredRates,
      commonFee: data.commonFee ?? 300,
      dormName: data.dormName,
      address: data.address,
      phone: data.phone,
      lineId: data.lineId,
      bankAccount: data.bankAccount,
      lineOaChannelId: data.lineOaChannelId,
      lineOaChannelSecret: data.lineOaChannelSecret,
      lineOaChannelAccessToken: data.lineOaChannelAccessToken,
      liffId: data.liffId,
      slipokApiKey: data.slipokApiKey,
      slipokApiUrl: data.slipokApiUrl,
      slipokBranchId: data.slipokBranchId,
      logoUrl: data.logoUrl,
      mapUrl: data.mapUrl,
      lineLink: data.lineLink,
      monthlyDueDay: data.monthlyDueDay,
    };
    if (existing) {
      return this.prisma.dormConfig.update({
        where: { id: existing.id },
        data: baseData as Parameters<typeof this.prisma.dormConfig.update>[0]['data'],
      });
    }
    return this.prisma.dormConfig.create({
      data: baseData as Parameters<typeof this.prisma.dormConfig.create>[0]['data'],
    });
  }

  private getExtraFilePath() {
    const uploadsDir = path.resolve('/app/uploads');
    if (!fs.existsSync(uploadsDir)) {
      try {
        fs.mkdirSync(uploadsDir, { recursive: true });
      } catch {
        return path.join(uploadsDir, 'dorm-extra.json');
      }
    }
    return path.join(uploadsDir, 'dorm-extra.json');
  }

  async getDormExtra(): Promise<DormExtraDto> {
    const store = tenantContext.getStore();
    if (store && (store as Record<string, unknown>)[EXTRA_CACHE_KEY]) {
      return (store as Record<string, unknown>)[EXTRA_CACHE_KEY] as DormExtraDto;
    }
    // 1. Read from DormConfig (tenant DB) - per-tenant
    const cfg = await this.getDormConfig();
    if (cfg && (cfg.lineOaChannelAccessToken ?? cfg.slipokApiKey ?? cfg.liffId)) {
      const out: DormExtraDto = {
        logoUrl: cfg.logoUrl ?? undefined,
        mapUrl: cfg.mapUrl ?? undefined,
        lineLink: cfg.lineLink ?? undefined,
        monthlyDueDay: cfg.monthlyDueDay ?? undefined,
        lineOaChannelId: cfg.lineOaChannelId ?? process.env.LINE_CHANNEL_ID,
        lineOaChannelSecret: cfg.lineOaChannelSecret ?? process.env.LINE_CHANNEL_SECRET,
        lineOaChannelAccessToken: cfg.lineOaChannelAccessToken ?? process.env.LINE_CHANNEL_ACCESS_TOKEN,
        slipokApiKey: cfg.slipokApiKey ?? process.env.SLIPOK_API_KEY,
        slipokApiUrl: cfg.slipokApiUrl ?? (process.env.SLIPOK_API_URL || process.env.SLIPOK_CHECK_URL),
        slipokBranchId: cfg.slipokBranchId ?? process.env.SLIPOK_BRANCH_ID,
        liffId: cfg.liffId ?? process.env.LIFF_ID,
      };
      if (store) (store as Record<string, unknown>)[EXTRA_CACHE_KEY] = out;
      return out;
    }
    // 2. Fallback: file
    try {
      const p = this.getExtraFilePath();
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = this.isRecord(JSON.parse(raw)) ? JSON.parse(raw) : {};
        const out: DormExtraDto = {
          logoUrl: this.pickString(parsed.logoUrl),
          mapUrl: this.pickString(parsed.mapUrl),
          lineLink: this.pickString(parsed.lineLink),
          monthlyDueDay: Number.isFinite(Number(parsed.monthlyDueDay)) ? Number(parsed.monthlyDueDay) : undefined,
          lineOaChannelId: this.pickString(parsed.lineOaChannelId) ?? process.env.LINE_CHANNEL_ID,
          lineOaChannelSecret: this.pickString(parsed.lineOaChannelSecret) ?? process.env.LINE_CHANNEL_SECRET,
          lineOaChannelAccessToken: this.pickString(parsed.lineOaChannelAccessToken) ?? process.env.LINE_CHANNEL_ACCESS_TOKEN,
          slipokApiKey: this.pickString(parsed.slipokApiKey) ?? process.env.SLIPOK_API_KEY,
          slipokApiUrl: this.pickString(parsed.slipokApiUrl) ?? (process.env.SLIPOK_API_URL || process.env.SLIPOK_CHECK_URL),
          slipokBranchId: this.pickString(parsed.slipokBranchId) ?? process.env.SLIPOK_BRANCH_ID,
          liffId: this.pickString(parsed.liffId) ?? process.env.LIFF_ID,
        };
        if (store) (store as Record<string, unknown>)[EXTRA_CACHE_KEY] = out;
        return out;
      }
    } catch {
      /* ignore */
    }
    // 3. Fallback: ENV
    const out: DormExtraDto = {
      lineOaChannelId: process.env.LINE_CHANNEL_ID,
      lineOaChannelSecret: process.env.LINE_CHANNEL_SECRET,
      lineOaChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      slipokApiKey: process.env.SLIPOK_API_KEY,
      slipokApiUrl: process.env.SLIPOK_API_URL || process.env.SLIPOK_CHECK_URL,
      slipokBranchId: process.env.SLIPOK_BRANCH_ID,
      liffId: process.env.LIFF_ID,
    };
    if (store) (store as Record<string, unknown>)[EXTRA_CACHE_KEY] = out;
    return out;
  }

  async updateDormExtra(data: DormExtraDto): Promise<DormExtraDto> {
    const current = await this.getDormExtra();
    const next: DormExtraDto = {
      ...current,
      logoUrl: data.logoUrl ?? current.logoUrl,
      mapUrl: data.mapUrl ?? current.mapUrl,
      lineLink: data.lineLink ?? current.lineLink,
      monthlyDueDay: Number.isFinite(Number(data.monthlyDueDay))
        ? Number(data.monthlyDueDay)
        : current.monthlyDueDay,
      lineOaChannelId: data.lineOaChannelId ?? current.lineOaChannelId,
      lineOaChannelSecret: data.lineOaChannelSecret ?? current.lineOaChannelSecret,
      lineOaChannelAccessToken: data.lineOaChannelAccessToken ?? current.lineOaChannelAccessToken,
      slipokApiKey: data.slipokApiKey ?? current.slipokApiKey,
      slipokApiUrl: data.slipokApiUrl ?? current.slipokApiUrl,
      slipokBranchId: data.slipokBranchId ?? current.slipokBranchId,
      liffId: data.liffId ?? current.liffId,
    };
    const existing = await this.prisma.dormConfig.findFirst();
    const updateData = {
      logoUrl: next.logoUrl,
      mapUrl: next.mapUrl,
      lineLink: next.lineLink,
      monthlyDueDay: next.monthlyDueDay,
      lineOaChannelId: next.lineOaChannelId,
      lineOaChannelSecret: next.lineOaChannelSecret,
      lineOaChannelAccessToken: next.lineOaChannelAccessToken,
      slipokApiKey: next.slipokApiKey,
      slipokApiUrl: next.slipokApiUrl,
      slipokBranchId: next.slipokBranchId,
      liffId: next.liffId,
    };
    if (existing) {
      await this.prisma.dormConfig.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      await this.prisma.dormConfig.create({
        data: {
          ...updateData,
          waterUnitPrice: 18,
          electricUnitPrice: 7,
          commonFee: 300,
        },
      });
    }
    return next;
  }
}
