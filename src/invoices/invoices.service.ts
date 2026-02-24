import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UTILITY_RATES } from '../common/constants';
import { InvoiceStatus, WaterFeeMethod, PaymentStatus } from '@prisma/client';
import { LineService } from '../line/line.service';
import { appendLog } from '../activity/logger';
import { SettingsService } from '../settings/settings.service';
import * as fs from 'fs';
import * as path from 'path';
import cron from 'node-cron';

@Injectable()
export class InvoicesService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private lineService: LineService,
    private settingsService: SettingsService,
  ) {}

  private round(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  async generate(generateInvoiceDto: GenerateInvoiceDto) {
    const { roomId, month, year } = generateInvoiceDto;

    // 1. Get Active Contract
    const contract = await this.prisma.contract.findFirst({
      where: {
        roomId,
        isActive: true,
      },
      include: {
        room: true,
        tenant: true,
      },
    });

    if (!contract) {
      throw new NotFoundException('Active contract not found for this room');
    }

    // 2. Get Current Meter Reading
    const currentReading = await this.prisma.meterReading.findFirst({
      where: {
        roomId,
        month,
        year,
      },
    });

    if (!currentReading) {
      throw new BadRequestException(
        `Meter reading for ${month}/${year} not found`,
      );
    }

    // 3. Get Previous Meter Reading
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = year - 1;
    }

    const prevReading = await this.prisma.meterReading.findFirst({
      where: {
        roomId,
        month: prevMonth,
        year: prevYear,
      },
    });

    const electricUsage = prevReading
      ? Number(currentReading.electricReading) -
        Number(prevReading.electricReading)
      : 0;
    const waterUsage = prevReading
      ? Number(currentReading.waterReading) - Number(prevReading.waterReading)
      : 0;

    const dormConfig = await this.settingsService.getEffectiveDormConfig();
    const electricUnitPrice = dormConfig
      ? Number(dormConfig.electricUnitPrice)
      : UTILITY_RATES.ELECTRIC_UNIT_PRICE;
    const waterUnitPrice = dormConfig
      ? Number(dormConfig.waterUnitPrice)
      : UTILITY_RATES.WATER_UNIT_PRICE;
    const commonFee = dormConfig
      ? Number(dormConfig.commonFee)
      : UTILITY_RATES.COMMON_FEE;

    const electricFeeMethod =
      dormConfig?.electricFeeMethod ?? WaterFeeMethod.METER_USAGE;
    const electricMinAmount = Math.max(
      0,
      Number(dormConfig?.electricMinAmount ?? 0),
    );
    const electricMinUnits = Math.max(
      0,
      Number(dormConfig?.electricMinUnits ?? 0),
    );
    const computeElectricTieredAmount = (
      u: number,
      tiers: Array<{
        uptoUnit?: number | null;
        unitPrice: number;
        chargeType?: 'PER_UNIT' | 'FLAT';
      }>,
    ) => {
      if (!tiers.length) return u * electricUnitPrice;
      const normalized = tiers
        .map((t) => ({
          uptoUnit:
            t.uptoUnit === null || t.uptoUnit === undefined
              ? undefined
              : Number(t.uptoUnit),
          unitPrice: Math.max(0, Number(t.unitPrice ?? 0)),
          chargeType: t.chargeType === 'FLAT' ? 'FLAT' : 'PER_UNIT',
        }))
        .filter((t) => t.unitPrice > 0)
        .map((t) => ({
          uptoUnit:
            t.uptoUnit !== undefined &&
            Number.isFinite(t.uptoUnit) &&
            t.uptoUnit > 0
              ? t.uptoUnit
              : undefined,
          unitPrice: t.unitPrice,
          chargeType: t.chargeType,
        }));
      const finite = normalized
        .filter((t) => t.uptoUnit !== undefined)
        .sort((a, b) => (a.uptoUnit as number) - (b.uptoUnit as number));
      const infinite = normalized.filter((t) => t.uptoUnit === undefined);
      const ordered = [...finite, ...infinite];
      let remaining = Math.max(0, u);
      let previousUpto = 0;
      let total = 0;
      for (const tier of ordered) {
        if (remaining <= 0) break;
        const upto = tier.uptoUnit ?? Number.POSITIVE_INFINITY;
        const rangeSize = Math.max(0, upto - previousUpto);
        const tierUnits = Number.isFinite(upto)
          ? Math.min(remaining, rangeSize)
          : remaining;
        if (tier.chargeType === 'FLAT') {
          if (tierUnits > 0) {
            total += tier.unitPrice;
          }
        } else {
          total += tierUnits * tier.unitPrice;
        }
        remaining -= tierUnits;
        previousUpto = Number.isFinite(upto) ? upto : previousUpto;
      }
      return total;
    };
    let electricAmount = 0;
    const eUsage = Math.max(0, electricUsage);
    const electricOverride = Math.max(
      0,
      Number(contract.room?.electricOverrideAmount ?? 0),
    );
    if (electricFeeMethod === WaterFeeMethod.FLAT_MONTHLY) {
      electricAmount =
        electricOverride > 0
          ? electricOverride
          : Number(dormConfig?.electricFlatMonthlyFee ?? 0);
    } else if (electricFeeMethod === WaterFeeMethod.METER_USAGE_MIN_AMOUNT) {
      const eUnit = electricOverride > 0 ? electricOverride : electricUnitPrice;
      electricAmount = Math.max(eUsage * eUnit, electricMinAmount);
    } else if (electricFeeMethod === WaterFeeMethod.METER_USAGE_MIN_UNITS) {
      const eUnit = electricOverride > 0 ? electricOverride : electricUnitPrice;
      electricAmount =
        eUsage <= electricMinUnits ? electricMinAmount : eUsage * eUnit;
    } else if (electricFeeMethod === WaterFeeMethod.METER_USAGE_PLUS_BASE) {
      const eUnit = electricOverride > 0 ? electricOverride : electricUnitPrice;
      electricAmount =
        eUsage <= electricMinUnits
          ? electricMinAmount
          : electricMinAmount + (eUsage - electricMinUnits) * eUnit;
    } else if (electricFeeMethod === WaterFeeMethod.METER_USAGE_TIERED) {
      const eTiers = Array.isArray(dormConfig?.electricTieredRates)
        ? (dormConfig?.electricTieredRates as Array<{
            uptoUnit?: number | null;
            unitPrice: number;
            chargeType?: 'PER_UNIT' | 'FLAT';
          }>)
        : [];
      electricAmount = computeElectricTieredAmount(eUsage, eTiers);
    } else {
      const eUnit = electricOverride > 0 ? electricOverride : electricUnitPrice;
      electricAmount = eUsage * eUnit;
    }
    const waterFeeMethod =
      dormConfig?.waterFeeMethod ?? WaterFeeMethod.METER_USAGE;
    let waterAmount = 0;
    const usage = Math.max(0, waterUsage);
    const waterOverride = Math.max(
      0,
      Number(contract.room?.waterOverrideAmount ?? 0),
    );
    const unitPrice =
      waterOverride > 0 && waterFeeMethod !== WaterFeeMethod.FLAT_MONTHLY
        ? Math.max(0, waterOverride)
        : Math.max(0, waterUnitPrice);
    const minAmount = Math.max(0, Number(dormConfig?.waterMinAmount ?? 0));
    const minUnits = Math.max(0, Number(dormConfig?.waterMinUnits ?? 0));

    const computeTieredAmount = (
      u: number,
      tiers: Array<{
        uptoUnit?: number | null;
        unitPrice: number;
        chargeType?: 'PER_UNIT' | 'FLAT';
      }>,
    ) => {
      if (!tiers.length) return u * unitPrice;
      const normalized = tiers
        .map((t) => ({
          uptoUnit:
            t.uptoUnit === null || t.uptoUnit === undefined
              ? undefined
              : Number(t.uptoUnit),
          unitPrice: Math.max(0, Number(t.unitPrice ?? 0)),
          chargeType: t.chargeType === 'FLAT' ? 'FLAT' : 'PER_UNIT',
        }))
        .filter((t) => t.unitPrice > 0)
        .map((t) => ({
          uptoUnit:
            t.uptoUnit !== undefined &&
            Number.isFinite(t.uptoUnit) &&
            t.uptoUnit > 0
              ? t.uptoUnit
              : undefined,
          unitPrice: t.unitPrice,
          chargeType: t.chargeType,
        }));
      const finite = normalized
        .filter((t) => t.uptoUnit !== undefined)
        .sort((a, b) => (a.uptoUnit as number) - (b.uptoUnit as number));
      const infinite = normalized.filter((t) => t.uptoUnit === undefined);
      const ordered = [...finite, ...infinite];
      let remaining = Math.max(0, u);
      let previousUpto = 0;
      let total = 0;
      for (const tier of ordered) {
        if (remaining <= 0) break;
        const upto = tier.uptoUnit ?? Number.POSITIVE_INFINITY;
        const rangeSize = Math.max(0, upto - previousUpto);
        const tierUnits = Number.isFinite(upto)
          ? Math.min(remaining, rangeSize)
          : remaining;
        if (tier.chargeType === 'FLAT') {
          if (tierUnits > 0) {
            total += tier.unitPrice;
          }
        } else {
          total += tierUnits * tier.unitPrice;
        }
        remaining -= tierUnits;
        previousUpto = Number.isFinite(upto) ? upto : previousUpto;
      }
      return total;
    };

    if (waterFeeMethod === WaterFeeMethod.FLAT_MONTHLY) {
      if (waterOverride > 0) {
        waterAmount = waterOverride;
      } else {
        waterAmount = Number(dormConfig?.waterFlatMonthlyFee ?? 0);
      }
    } else if (waterFeeMethod === WaterFeeMethod.FLAT_PER_PERSON) {
      const perPerson = Number(dormConfig?.waterFlatPerPersonFee ?? 0);
      const occupants = Number(contract.occupantCount ?? 1);
      waterAmount = perPerson * Math.max(1, occupants);
    } else if (waterFeeMethod === WaterFeeMethod.METER_USAGE_MIN_AMOUNT) {
      waterAmount = Math.max(usage * unitPrice, minAmount);
    } else if (waterFeeMethod === WaterFeeMethod.METER_USAGE_MIN_UNITS) {
      waterAmount = usage <= minUnits ? minAmount : usage * unitPrice;
    } else if (waterFeeMethod === WaterFeeMethod.METER_USAGE_PLUS_BASE) {
      waterAmount =
        usage <= minUnits
          ? minAmount
          : minAmount + (usage - minUnits) * unitPrice;
    } else if (waterFeeMethod === WaterFeeMethod.METER_USAGE_TIERED) {
      const tiers = Array.isArray(dormConfig?.waterTieredRates)
        ? (dormConfig?.waterTieredRates as Array<{
            uptoUnit?: number | null;
            unitPrice: number;
            chargeType?: 'PER_UNIT' | 'FLAT';
          }>)
        : [];
      waterAmount = computeTieredAmount(usage, tiers);
    } else {
      waterAmount = usage * unitPrice;
    }
    if (
      (waterFeeMethod === WaterFeeMethod.METER_USAGE ||
        waterFeeMethod === WaterFeeMethod.METER_USAGE_MIN_AMOUNT ||
        waterFeeMethod === WaterFeeMethod.METER_USAGE_MIN_UNITS ||
        waterFeeMethod === WaterFeeMethod.METER_USAGE_PLUS_BASE ||
        waterFeeMethod === WaterFeeMethod.METER_USAGE_TIERED) &&
      usage < 5
    ) {
      waterAmount = 35;
    }

    const rentAmount = this.round(Number(contract.currentRent));
    const otherFees = this.round(commonFee);

    // Ensure all components are rounded
    electricAmount = this.round(electricAmount);
    waterAmount = this.round(waterAmount);

    const totalAmount = this.round(
      rentAmount + electricAmount + waterAmount + otherFees,
    );

    const existingInvoice = await this.prisma.invoice.findFirst({
      where: {
        contractId: contract.id,
        month,
        year,
      },
    });

    if (existingInvoice) {
      throw new BadRequestException('Invoice already exists for this period');
    }

    const dormExtra = this.settingsService.getDormExtra();
    const monthlyDueDay =
      Number.isFinite(Number(dormExtra?.monthlyDueDay))
        ? Number(dormExtra?.monthlyDueDay)
        : 5;
    const dueDateObj = new Date(
      year,
      Math.max(0, Math.min(11, month - 1)),
      Math.max(1, Math.min(31, monthlyDueDay)),
    );

    const invoice = await this.prisma.invoice.create({
      data: {
        contractId: contract.id,
        month,
        year,
        rentAmount,
        electricAmount,
        waterAmount,
        otherFees,
        totalAmount,
        status: InvoiceStatus.DRAFT,
        dueDate: dueDateObj,
      },
    });

    if (contract.tenant && contract.tenant.lineUserId) {
      // Don't send message immediately when generating invoice
      // const message = ...
      // await this.lineService.pushMessage(contract.tenant.lineUserId, message);
    }

    return invoice;
  }

  async settle(id: string, method: 'DEPOSIT' | 'CASH', paidAt?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { contract: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const amount = Math.max(0, Number(invoice.totalAmount));
    if (amount === 0) {
      return this.prisma.invoice.update({
        where: { id },
        data: { status: InvoiceStatus.PAID },
      });
    }
    if (method === 'DEPOSIT') {
      const currentDeposit = Math.max(
        0,
        Number(invoice.contract?.deposit ?? 0),
      );
      if (currentDeposit < amount) {
        throw new BadRequestException('Insufficient deposit to settle invoice');
      }
      await this.prisma.contract.update({
        where: { id: invoice.contractId },
        data: { deposit: this.round(Math.max(0, currentDeposit - amount)) },
      });
    }
    await this.prisma.payment.create({
      data: {
        invoiceId: id,
        amount,
        slipBankRef: method,
        status: PaymentStatus.VERIFIED,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
      },
    });
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.PAID },
    });
    try {
      const full = await this.prisma.invoice.findUnique({
        where: { id },
        include: {
          contract: {
            include: { tenant: true },
          },
        },
      });
      const tenant = full?.contract?.tenant;
      if (tenant?.lineUserId && method === 'DEPOSIT') {
        const contract = await this.prisma.contract.findUnique({
          where: { id: invoice.contractId },
        });
        const depositLeft = Math.max(0, Number(contract?.deposit ?? 0));
        const days = this.lineService.getMoveOutDaysByUserId(tenant.lineUserId);
        await this.lineService.pushMessage(
          tenant.lineUserId,
          `ยอดเงินประกันที่จะคืนให้คุณคือ ฿${depositLeft.toLocaleString()} บาท\nเงินประกันจะได้รับคืนผ่านธนาคารภายใน ${days} วัน\nกรุณาส่งข้อมูลบัญชี: ชื่อ-นามสกุล, เบอร์โทรศัพท์, เลขบัญชี, ธนาคาร`,
        );
      }
    } catch (e) {
      void e;
    }
    return updated;
  }

  create(createInvoiceDto: CreateInvoiceDto) {
    const rent = this.round(Number(createInvoiceDto.rentAmount));
    const water = this.round(Number(createInvoiceDto.waterAmount));
    const electric = this.round(Number(createInvoiceDto.electricAmount));
    const other = this.round(Number(createInvoiceDto.otherFees || 0));
    const discount = this.round(Number(createInvoiceDto.discount || 0));
    const total = Math.max(
      0,
      this.round(rent + water + electric + other - discount),
    );

    return this.prisma.invoice
      .create({
        data: {
          ...createInvoiceDto,
          rentAmount: rent,
          waterAmount: water,
          electricAmount: electric,
          otherFees: other,
          discount: discount,
          totalAmount: total,
        },
      })
      .then((inv) => {
        appendLog({
          action: 'CREATE',
          entityType: 'Invoice',
          entityId: inv.id,
          details: {
            contractId: inv.contractId,
            month: inv.month,
            year: inv.year,
          },
        });
        return inv;
      });
  }

  async findAll() {
    const invoices = await this.prisma.invoice.findMany({
      include: {
        contract: {
          include: {
            room: { include: { building: true } },
            tenant: true,
          },
        },
      },
    });

    return invoices.sort((a, b) => {
      // Sort by Building Name
      const buildingA = a.contract?.room?.building?.name || '';
      const buildingB = b.contract?.room?.building?.name || '';
      if (buildingA !== buildingB) {
        return buildingA.localeCompare(buildingB);
      }

      // Sort by Floor
      const floorA = a.contract?.room?.floor || 0;
      const floorB = b.contract?.room?.floor || 0;
      if (floorA !== floorB) {
        return floorA - floorB;
      }

      // Sort by Room Number (Numeric aware)
      const roomA = a.contract?.room?.number || '';
      const roomB = b.contract?.room?.number || '';
      return roomA.localeCompare(roomB, undefined, { numeric: true });
    });
  }

  findByRoom(roomId: string) {
    return this.prisma.invoice.findMany({
      where: {
        contract: {
          roomId: roomId,
        },
      },
      include: {
        contract: {
          include: {
            room: { include: { building: true } },
            tenant: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByIds(ids: string[]) {
    return this.prisma.invoice.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      include: {
        contract: {
          include: {
            room: { include: { building: true } },
            tenant: true,
          },
        },
      },
    });
  }

  findOne(id: string) {
    return this.prisma.invoice.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            room: { include: { building: true } },
            tenant: true,
          },
        },
        items: true,
        payments: true,
      },
    });
  }

  update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
    return this.prisma.invoice
      .update({
        where: { id },
        data: updateInvoiceDto,
      })
      .then(async (inv) => {
        appendLog({
          action: 'UPDATE',
          entityType: 'Invoice',
          entityId: id,
          details: updateInvoiceDto,
        });
        const full = await this.prisma.invoice.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!full) return inv;
        const base = this.round(
          Number(full.rentAmount) +
            Number(full.waterAmount) +
            Number(full.electricAmount) +
            Number(full.otherFees || 0),
        );
        const itemsTotal = this.round(
          (full.items || []).reduce((sum, it) => sum + Number(it.amount), 0),
        );
        const discount = this.round(Number(full.discount || 0));
        const nextTotal = Math.max(0, this.round(base + itemsTotal - discount));
        if (nextTotal !== Number(full.totalAmount)) {
          return this.prisma.invoice.update({
            where: { id },
            data: { totalAmount: nextTotal },
          });
        }
        return inv;
      });
  }

  async remove(id: string) {
    const exists = await this.prisma.invoice.findUnique({ where: { id } });
    if (!exists) return { ok: true };
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
    appendLog({
      action: 'DELETE',
      entityType: 'Invoice',
      entityId: id,
      details: { prevStatus: exists.status },
    });
    return updated;
  }

  async cancel(id: string) {
    const exists = await this.prisma.invoice.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('Invoice not found');
    }
    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
  }

  async addItem(
    invoiceId: string,
    body: { description: string; amount: number },
  ) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    const item = await this.prisma.invoiceItem.create({
      data: {
        invoiceId,
        description: String(body.description || '').slice(0, 200),
        amount: Math.max(0, Number(body.amount || 0)),
      },
    });
    appendLog({
      action: 'CREATE',
      entityType: 'InvoiceItem',
      entityId: item.id,
      details: {
        invoiceId,
        description: body.description,
        amount: body.amount,
      },
    });
    const all = await this.prisma.invoiceItem.findMany({
      where: { invoiceId },
    });
    const base = this.round(
      Number(inv.rentAmount) +
        Number(inv.waterAmount) +
        Number(inv.electricAmount) +
        Number(inv.otherFees || 0),
    );
    const itemsTotal = this.round(
      all.reduce((sum, it) => sum + Number(it.amount), 0),
    );
    const discount = this.round(Number(inv.discount || 0));
    const nextTotal = Math.max(0, this.round(base + itemsTotal - discount));
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { totalAmount: nextTotal },
    });
    return item;
  }

  async updateItem(
    itemId: string,
    body: { description?: string; amount?: number },
  ) {
    const item = await this.prisma.invoiceItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException('Invoice item not found');
    const updated = await this.prisma.invoiceItem.update({
      where: { id: itemId },
      data: {
        ...(body.description !== undefined
          ? { description: String(body.description).slice(0, 200) }
          : {}),
        ...(body.amount !== undefined
          ? { amount: Math.max(0, Number(body.amount)) }
          : {}),
      },
    });
    appendLog({
      action: 'UPDATE',
      entityType: 'InvoiceItem',
      entityId: itemId,
      details: body,
    });
    const inv = await this.prisma.invoice.findUnique({
      where: { id: item.invoiceId },
    });
    if (inv) {
      const all = await this.prisma.invoiceItem.findMany({
        where: { invoiceId: item.invoiceId },
      });
      const base = this.round(
        Number(inv.rentAmount) +
          Number(inv.waterAmount) +
          Number(inv.electricAmount) +
          Number(inv.otherFees || 0),
      );
      const itemsTotal = this.round(
        all.reduce((sum, it) => sum + Number(it.amount), 0),
      );
      const discount = this.round(Number(inv.discount || 0));
      const nextTotal = Math.max(0, this.round(base + itemsTotal - discount));
      await this.prisma.invoice.update({
        where: { id: item.invoiceId },
        data: { totalAmount: nextTotal },
      });
    }
    return updated;
  }

  async removeItem(itemId: string) {
    const item = await this.prisma.invoiceItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException('Invoice item not found');
    await this.prisma.invoiceItem.update({
      where: { id: itemId },
      data: { amount: 0, description: `[DELETED] ${item.description}` },
    });
    appendLog({
      action: 'DELETE',
      entityType: 'InvoiceItem',
      entityId: itemId,
      details: { invoiceId: item.invoiceId },
    });
    const inv = await this.prisma.invoice.findUnique({
      where: { id: item.invoiceId },
    });
    if (inv) {
      const all = await this.prisma.invoiceItem.findMany({
        where: { invoiceId: item.invoiceId },
      });
      const base = this.round(
        Number(inv.rentAmount) +
          Number(inv.waterAmount) +
          Number(inv.electricAmount) +
          Number(inv.otherFees || 0),
      );
      const itemsTotal = this.round(
        all.reduce((sum, it) => sum + Number(it.amount), 0),
      );
      const discount = this.round(Number(inv.discount || 0));
      const nextTotal = Math.max(0, this.round(base + itemsTotal - discount));
      await this.prisma.invoice.update({
        where: { id: item.invoiceId },
        data: { totalAmount: nextTotal },
      });
    }
    return { ok: true };
  }

  async send(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            tenant: true,
            room: { include: { building: true } },
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    const tenant = invoice.contract?.tenant;
    const room = invoice.contract?.room;
    if (tenant?.lineUserId && room?.number) {
      const dormConfig = await this.prisma.dormConfig.findFirst();
      const bankNote = dormConfig?.bankAccount
        ? `โอนบัญชี ${dormConfig.bankAccount} เท่านั้น`
        : undefined;
      if (tenant.lineUserId) {
        await this.lineService.pushRentBillFlex(tenant.lineUserId, {
          room: room.number,
          month: invoice.month,
          year: invoice.year,
          rentAmount: Number(invoice.rentAmount),
          waterAmount: Number(invoice.waterAmount),
          electricAmount: Number(invoice.electricAmount),
          otherFees: Number(invoice.otherFees || 0),
          discount: Number(invoice.discount || 0),
          totalAmount: Number(invoice.totalAmount),
          buildingLabel:
            room.building?.name || room.building?.code || undefined,
          bankInstruction: bankNote,
        });
      }
    }
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.SENT },
      include: {
        contract: { include: { tenant: true, room: true } },
      },
    });
    return updated;
  }

  async sendAll(month: number, year: number) {
    const invoices = await this.prisma.invoice.findMany({
      where: { month, year },
      include: {
        contract: {
          include: { tenant: true, room: { include: { building: true } } },
        },
      },
    });
    const dormConfig = await this.prisma.dormConfig.findFirst();
    const bankNote = dormConfig?.bankAccount
      ? `โอนบัญชี ${dormConfig.bankAccount} เท่านั้น`
      : undefined;
    for (const inv of invoices) {
      const tenant = inv.contract?.tenant;
      const room = inv.contract?.room;
      if (tenant?.lineUserId && room?.number) {
        await this.lineService.pushRentBillFlex(tenant.lineUserId, {
          room: room.number,
          month: inv.month,
          year: inv.year,
          rentAmount: Number(inv.rentAmount),
          waterAmount: Number(inv.waterAmount),
          electricAmount: Number(inv.electricAmount),
          otherFees: Number(inv.otherFees || 0),
          discount: Number(inv.discount || 0),
          totalAmount: Number(inv.totalAmount),
          buildingLabel:
            (room as any)?.building?.name ||
            (room as any)?.building?.code ||
            undefined,
          bankInstruction: bankNote,
        });
      }
    }
    await this.prisma.invoice.updateMany({
      where: { month, year },
      data: { status: InvoiceStatus.SENT },
    });
    return { ok: true, count: invoices.length };
  }

  async sendForRoom(month: number, year: number, roomId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        month,
        year,
        contract: {
          roomId,
        },
      },
      include: {
        contract: {
          include: { tenant: true, room: { include: { building: true } } },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found for this room and period');
    }
    const dormConfig = await this.prisma.dormConfig.findFirst();
    const bankNote = dormConfig?.bankAccount
      ? `โอนบัญชี ${dormConfig.bankAccount} เท่านั้น`
      : undefined;
    const tenant = invoice.contract?.tenant;
    const room = invoice.contract?.room;
    if (tenant?.lineUserId && room?.number) {
      await this.lineService.pushRentBillFlex(tenant.lineUserId, {
        room: room.number,
        month: invoice.month,
        year: invoice.year,
        rentAmount: Number(invoice.rentAmount),
        waterAmount: Number(invoice.waterAmount),
        electricAmount: Number(invoice.electricAmount),
        otherFees: Number(invoice.otherFees || 0),
        discount: Number(invoice.discount || 0),
        totalAmount: Number(invoice.totalAmount),
        buildingLabel:
          (room as any)?.building?.name ||
          (room as any)?.building?.code ||
          undefined,
        bankInstruction: bankNote,
      });
    }
    if (invoice.status !== InvoiceStatus.SENT) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.SENT },
      });
    }
    return { ok: true, id: invoice.id };
  }

  async export(month: number, year: number, res: Response) {
    const invoices = await this.prisma.invoice.findMany({
      where: { month, year },
      include: {
        contract: {
          include: {
            tenant: true,
            room: {
              include: { building: true },
            },
          },
        },
      },
    });

    // Sort: Building Name -> Floor -> Room Number
    invoices.sort((a, b) => {
      const bA = a.contract?.room?.building?.name || '';
      const bB = b.contract?.room?.building?.name || '';
      if (bA !== bB) return bA.localeCompare(bB);

      const fA = a.contract?.room?.floor || 0;
      const fB = b.contract?.room?.floor || 0;
      if (fA !== fB) return fA - fB;

      const rA = a.contract?.room?.number || '';
      const rB = b.contract?.room?.number || '';
      return rA.localeCompare(rB, undefined, { numeric: true });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Invoices');

    worksheet.columns = [
      { header: 'Building', key: 'building', width: 15 },
      { header: 'Floor', key: 'floor', width: 10 },
      { header: 'Room', key: 'room', width: 10 },
      { header: 'Tenant', key: 'tenant', width: 20 },
      { header: 'Rent', key: 'rent', width: 15 },
      { header: 'Water', key: 'water', width: 15 },
      { header: 'Electric', key: 'electric', width: 15 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
    ];

    invoices.forEach((inv) => {
      worksheet.addRow({
        building: inv.contract?.room?.building?.name || '-',
        floor: inv.contract?.room?.floor || '-',
        room: inv.contract?.room?.number || '-',
        tenant: inv.contract?.tenant?.name || '-',
        rent: Number(inv.rentAmount),
        water: Number(inv.waterAmount),
        electric: Number(inv.electricAmount),
        total: Number(inv.totalAmount),
        status: inv.status,
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoices-${month}-${year}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  }

  // ===== Auto-send configuration & runner =====
  private getAutoSendFilePath() {
    const uploadsDir = path.resolve('/app/uploads');
    if (!fs.existsSync(uploadsDir)) {
      try {
        fs.mkdirSync(uploadsDir, { recursive: true });
      } catch {}
    }
    return path.join(uploadsDir, 'auto-send.json');
  }
  getAutoSendConfig() {
    try {
      const p = this.getAutoSendFilePath();
      if (!fs.existsSync(p)) {
        return {
          enabled: false,
          dayOfMonth: 1,
          hour: 9,
          minute: 0,
          timezone: 'Asia/Bangkok',
          lastRunAt: null,
        };
      }
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        enabled: !!parsed.enabled,
        dayOfMonth: Math.max(1, Math.min(28, Number(parsed.dayOfMonth ?? 1))),
        hour: Math.max(0, Math.min(23, Number(parsed.hour ?? 9))),
        minute: Math.max(0, Math.min(59, Number(parsed.minute ?? 0))),
        timezone:
          typeof parsed.timezone === 'string'
            ? parsed.timezone
            : 'Asia/Bangkok',
        lastRunAt: parsed.lastRunAt ?? null,
      };
    } catch {
      return {
        enabled: false,
        dayOfMonth: 1,
        hour: 9,
        minute: 0,
        timezone: 'Asia/Bangkok',
        lastRunAt: null,
      };
    }
  }
  setAutoSendConfig(payload: {
    enabled: boolean;
    dayOfMonth: number;
    hour: number;
    minute?: number;
    timezone?: string;
  }) {
    const p = this.getAutoSendFilePath();
    const current = this.getAutoSendConfig();
    const next = {
      enabled: !!payload.enabled,
      dayOfMonth: Math.max(
        1,
        Math.min(28, Number(payload.dayOfMonth ?? current.dayOfMonth)),
      ),
      hour: Math.max(0, Math.min(23, Number(payload.hour ?? current.hour))),
      minute: Math.max(
        0,
        Math.min(59, Number(payload.minute ?? current.minute)),
      ),
      timezone: String(payload.timezone || current.timezone || 'Asia/Bangkok'),
      lastRunAt: current.lastRunAt ?? null,
    };
    try {
      fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
    } catch {}
    return next;
  }
  async runAutoSend() {
    const cfg = this.getAutoSendConfig();
    if (!cfg.enabled) return { ok: false, reason: 'disabled' };
    // Compute current time in target timezone
    const tz = cfg.timezone || 'Asia/Bangkok';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value || 0);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    const now = new Date();
    // Match schedule
    const dormExtra = this.settingsService.getDormExtra();
    const effectiveDay =
      Number.isFinite(Number(dormExtra?.monthlyDueDay))
        ? Math.max(1, Math.min(28, Number(dormExtra.monthlyDueDay)))
        : cfg.dayOfMonth;
    if (day !== effectiveDay) return { ok: false, reason: 'day_mismatch' };
    if (hour !== cfg.hour) return { ok: false, reason: 'hour_mismatch' };
    if (minute !== (cfg.minute ?? 0))
      return { ok: false, reason: 'minute_mismatch' };
    // Prevent duplicate run within same minute
    try {
      const last = cfg.lastRunAt ? new Date(cfg.lastRunAt) : null;
      if (last) {
        const diff = Math.abs(now.getTime() - last.getTime());
        if (diff < 60_000) {
          return { ok: false, reason: 'already_ran' };
        }
      }
    } catch {}
    // Send all invoices for current month/year with status DRAFT
    const invoices = await this.prisma.invoice.findMany({
      where: { month, year, status: InvoiceStatus.DRAFT },
      include: {
        contract: {
          include: { tenant: true, room: { include: { building: true } } },
        },
      },
    });
    const dormConfig = await this.prisma.dormConfig.findFirst();
    const bankNote = dormConfig?.bankAccount
      ? `โอนบัญชี ${dormConfig.bankAccount} เท่านั้น`
      : undefined;
    for (const inv of invoices) {
      const tenant = inv.contract?.tenant;
      const room = inv.contract?.room;
      if (tenant?.lineUserId && room?.number) {
        await this.lineService.pushRentBillFlex(tenant.lineUserId, {
          room: room.number,
          month: inv.month,
          year: inv.year,
          rentAmount: Number(inv.rentAmount),
          waterAmount: Number(inv.waterAmount),
          electricAmount: Number(inv.electricAmount),
          otherFees: Number(inv.otherFees || 0),
          discount: Number(inv.discount || 0),
          totalAmount: Number(inv.totalAmount),
          buildingLabel:
            (room as any)?.building?.name ||
            (room as any)?.building?.code ||
            undefined,
          bankInstruction: bankNote,
        });
      }
    }
    await this.prisma.invoice.updateMany({
      where: { month, year, status: InvoiceStatus.DRAFT },
      data: { status: InvoiceStatus.SENT },
    });
    // Update lastRunAt
    const p = this.getAutoSendFilePath();
    const next = { ...cfg, lastRunAt: new Date().toISOString() };
    try {
      fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
    } catch {}
    return { ok: true, count: invoices.length, month, year };
  }

  async markOverdue() {
    const now = new Date();
    const ids = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.SENT,
        dueDate: { lt: now },
      },
      select: { id: true },
    });
    if (ids.length === 0) return { ok: true, count: 0 };
    await this.prisma.invoice.updateMany({
      where: {
        status: InvoiceStatus.SENT,
        dueDate: { lt: now },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });
    return { ok: true, count: ids.length };
  }

  onModuleInit() {
    try {
      cron.schedule('* * * * *', async () => {
        try {
          await this.runAutoSend();
        } catch {}
      });
      cron.schedule('15 0 * * *', async () => {
        try {
          await this.markOverdue();
        } catch {}
      });
    } catch {}
  }
}
