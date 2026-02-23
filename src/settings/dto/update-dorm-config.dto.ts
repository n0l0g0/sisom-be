import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { WaterFeeMethod } from '@prisma/client';

const WaterFeeMethodEnum = {
  METER_USAGE: 'METER_USAGE',
  METER_USAGE_MIN_AMOUNT: 'METER_USAGE_MIN_AMOUNT',
  METER_USAGE_MIN_UNITS: 'METER_USAGE_MIN_UNITS',
  METER_USAGE_PLUS_BASE: 'METER_USAGE_PLUS_BASE',
  METER_USAGE_TIERED: 'METER_USAGE_TIERED',
  FLAT_MONTHLY: 'FLAT_MONTHLY',
  FLAT_PER_PERSON: 'FLAT_PER_PERSON',
} as const;

export class UpdateDormConfigDto {
  @IsOptional()
  @IsString()
  dormName?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  lineId?: string;

  @IsOptional()
  @IsNumber()
  waterUnitPrice?: number;

  @IsOptional()
  @IsEnum(WaterFeeMethodEnum)
  waterFeeMethod?: WaterFeeMethod;

  @IsOptional()
  @IsNumber()
  waterFlatMonthlyFee?: number;

  @IsOptional()
  @IsNumber()
  waterFlatPerPersonFee?: number;

  @IsOptional()
  @IsNumber()
  waterMinAmount?: number;

  @IsOptional()
  @IsNumber()
  waterMinUnits?: number;

  @IsOptional()
  @IsNumber()
  waterBaseFee?: number;

  @IsOptional()
  waterTieredRates?: Prisma.InputJsonValue;

  @IsOptional()
  @IsNumber()
  electricUnitPrice?: number;

  @IsOptional()
  @IsEnum(WaterFeeMethodEnum)
  electricFeeMethod?: WaterFeeMethod;

  @IsOptional()
  @IsNumber()
  electricFlatMonthlyFee?: number;

  @IsOptional()
  @IsNumber()
  electricMinAmount?: number;

  @IsOptional()
  @IsNumber()
  electricMinUnits?: number;

  @IsOptional()
  @IsNumber()
  electricBaseFee?: number;

  @IsOptional()
  electricTieredRates?: Prisma.InputJsonValue;

  @IsOptional()
  @IsNumber()
  commonFee?: number;

  @IsOptional()
  @IsString()
  bankAccount?: string;
}
