import { PartialType } from '@nestjs/mapped-types';
import { CreateMaintenanceDto } from './create-maintenance.dto';
import { IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';
import type { MaintenanceStatus } from '@prisma/client';

const MaintenanceStatusEnum = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export class UpdateMaintenanceDto extends PartialType(CreateMaintenanceDto) {
  @IsOptional()
  @IsEnum(MaintenanceStatusEnum)
  status?: MaintenanceStatus;

  @IsOptional()
  @IsDateString()
  resolvedAt?: string;

  @IsOptional()
  @IsNumber()
  cost?: number;
}
