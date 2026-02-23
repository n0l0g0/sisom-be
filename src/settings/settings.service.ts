import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDormConfigDto } from './dto/update-dorm-config.dto';
import { DormExtraDto } from './dto/dorm-extra.dto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  getDormConfig() {
    return this.prisma.dormConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });
  }
  async getEffectiveDormConfig() {
    const local = await this.getDormConfig();
    let external: any = null;
    try {
      const f = (globalThis as any).fetch;
      if (typeof f === 'function') {
        const resp = await f('https://cms.washqueue.com/api/settings/rent', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (resp && resp.ok) {
          external = await resp.json();
        }
      }
    } catch {}
    const pickNum = (v: any, def?: any) => {
      const nv = Number(v);
      if (Number.isFinite(nv)) return nv;
      const nd = Number(def);
      return Number.isFinite(nd) ? nd : undefined;
    };
    const pickEnum = (v: any) => (typeof v === 'string' ? v : undefined);
    const merged = {
      ...local,
      waterUnitPrice:
        pickNum(external?.waterUnitPrice, local?.waterUnitPrice) ?? 18,
      waterFeeMethod:
        pickEnum(external?.waterFeeMethod) ?? local?.waterFeeMethod,
      waterFlatMonthlyFee: pickNum(
        external?.waterFlatMonthlyFee,
        local?.waterFlatMonthlyFee,
      ),
      waterFlatPerPersonFee: pickNum(
        external?.waterFlatPerPersonFee,
        local?.waterFlatPerPersonFee,
      ),
      waterMinAmount: pickNum(external?.waterMinAmount, local?.waterMinAmount),
      waterMinUnits: pickNum(external?.waterMinUnits, local?.waterMinUnits),
      waterBaseFee: pickNum(external?.waterBaseFee, local?.waterBaseFee),
      waterTieredRates: external?.waterTieredRates ?? local?.waterTieredRates,
      electricUnitPrice:
        pickNum(external?.electricUnitPrice, local?.electricUnitPrice) ?? 7,
      electricFeeMethod:
        pickEnum(external?.electricFeeMethod) ?? local?.electricFeeMethod,
      electricFlatMonthlyFee: pickNum(
        external?.electricFlatMonthlyFee,
        local?.electricFlatMonthlyFee,
      ),
      electricMinAmount: pickNum(
        external?.electricMinAmount,
        local?.electricMinAmount,
      ),
      electricMinUnits: pickNum(
        external?.electricMinUnits,
        local?.electricMinUnits,
      ),
      electricBaseFee: pickNum(
        external?.electricBaseFee,
        local?.electricBaseFee,
      ),
      electricTieredRates:
        external?.electricTieredRates ?? local?.electricTieredRates,
      commonFee: pickNum(external?.commonFee, local?.commonFee) ?? 300,
      bankAccount: external?.bankAccount ?? local?.bankAccount,
    } as any;
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
      } catch {}
    }
    return path.join(uploadsDir, 'dorm-extra.json');
  }

  getDormExtra(): DormExtraDto {
    try {
      const p = this.getExtraFilePath();
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        logoUrl:
          typeof parsed.logoUrl === 'string' ? parsed.logoUrl : undefined,
        mapUrl: typeof parsed.mapUrl === 'string' ? parsed.mapUrl : undefined,
        lineLink:
          typeof parsed.lineLink === 'string' ? parsed.lineLink : undefined,
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
    };
    try {
      fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
    } catch {}
    return next;
  }
}
