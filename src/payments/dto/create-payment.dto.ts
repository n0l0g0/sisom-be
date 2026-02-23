import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
} from 'class-validator';
import type { PaymentStatus } from '@prisma/client';

const PaymentStatusEnum = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export class CreatePaymentDto {
  @IsNotEmpty()
  @IsString()
  invoiceId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  slipImageUrl?: string;

  @IsOptional()
  @IsString()
  slipBankRef?: string;

  @IsOptional()
  @IsEnum(PaymentStatusEnum)
  status?: PaymentStatus;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
