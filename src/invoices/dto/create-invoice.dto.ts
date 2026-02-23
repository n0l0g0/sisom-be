import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
  IsOptional,
} from 'class-validator';
import type { InvoiceStatus } from '@prisma/client';

const InvoiceStatusEnum = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;

export class CreateInvoiceDto {
  @IsNotEmpty()
  @IsString()
  contractId: string;

  @IsNotEmpty()
  @IsNumber()
  month: number;

  @IsNotEmpty()
  @IsNumber()
  year: number;

  @IsNotEmpty()
  @IsNumber()
  rentAmount: number;

  @IsNotEmpty()
  @IsNumber()
  waterAmount: number;

  @IsNotEmpty()
  @IsNumber()
  electricAmount: number;

  @IsOptional()
  @IsNumber()
  otherFees?: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsNotEmpty()
  @IsNumber()
  totalAmount: number;

  @IsOptional()
  @IsEnum(InvoiceStatusEnum)
  status?: InvoiceStatus;

  @IsNotEmpty()
  @IsDateString()
  dueDate: string;
}
