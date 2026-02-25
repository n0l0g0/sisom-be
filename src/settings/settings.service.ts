import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DormConfig } from '@prisma/client';
import { UpdateDormConfigDto } from './dto/update-dorm-config.dto';
import { DormExtraDto } from './dto/dorm-extra.dto';
import * as fs from 'fs';
import * as path from 'path';

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
    if (existing) {
      return this.prisma.dormConfig.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.dormConfig.create({
      data: {
        waterUnitPrice: data.waterUnitPrice ?? 18,
        waterFeeMethod: data.waterFeeMethod ?? undefined,
        waterFlatMonthlyFee: data.waterFlatMonthlyFee ?? undefined,
        waterFlatPerPersonFee: data.waterFlatPerPersonFee ?? undefined,
        waterMinAmount: data.waterMinAmount ?? undefined,
        waterMinUnits: data.waterMinUnits ?? undefined,
        waterBaseFee: data.waterBaseFee ?? undefined,
        waterTieredRates: data.waterTieredRates ?? undefined,
        electricUnitPrice: data.electricUnitPrice ?? 7,
        electricFeeMethod: data.electricFeeMethod ?? undefined,
        electricFlatMonthlyFee: data.electricFlatMonthlyFee ?? undefined,
        electricMinAmount: data.electricMinAmount ?? undefined,
        electricMinUnits: data.electricMinUnits ?? undefined,
        electricBaseFee: data.electricBaseFee ?? undefined,
        electricTieredRates: data.electricTieredRates ?? undefined,
        commonFee: data.commonFee ?? 300,
        dormName: data.dormName,
        address: data.address,
        phone: data.phone,
        lineId: data.lineId,
        bankAccount: data.bankAccount,
      },
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

  getDormExtra(): DormExtraDto {
    try {
      const p = this.getExtraFilePath();
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, 'utf8');
      const parsedUnknown = JSON.parse(raw) as unknown;
      const parsed = this.isRecord(parsedUnknown) ? parsedUnknown : {};
      return {
        logoUrl:
          typeof parsed.logoUrl === 'string' ? parsed.logoUrl : undefined,
        mapUrl: typeof parsed.mapUrl === 'string' ? parsed.mapUrl : undefined,
        lineLink:
          typeof parsed.lineLink === 'string' ? parsed.lineLink : undefined,
        monthlyDueDay: Number.isFinite(Number(parsed.monthlyDueDay))
          ? Number(parsed.monthlyDueDay)
          : undefined,
      };
    } catch {
      return {};
    }
  }

  updateDormExtra(data: DormExtraDto): DormExtraDto {
    const p = this.getExtraFilePath();
    const current = this.getDormExtra();
    const next: DormExtraDto = {
      logoUrl: data.logoUrl ?? current.logoUrl,
      mapUrl: data.mapUrl ?? current.mapUrl,
      lineLink: data.lineLink ?? current.lineLink,
      monthlyDueDay: Number.isFinite(Number(data.monthlyDueDay))
        ? Number(data.monthlyDueDay)
        : current.monthlyDueDay,
    };
    try {
      fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
    } catch {
      return next;
    }
    return next;
  }
}
