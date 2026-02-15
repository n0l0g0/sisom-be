import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDormConfigDto } from './dto/update-dorm-config.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  getDormConfig() {
    return this.prisma.dormConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });
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
}
