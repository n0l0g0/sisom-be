import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { Prisma, WaterFeeMethod } from '@prisma/client';

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
  @IsEnum(WaterFeeMethod)
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
  @IsEnum(WaterFeeMethod)
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
