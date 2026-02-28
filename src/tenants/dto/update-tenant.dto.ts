import { PartialType } from '@nestjs/mapped-types';
import { CreateTenantDto } from './create-tenant.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { TenantStatus } from '@prisma/client';

export class UpdateTenantDto extends PartialType(CreateTenantDto) {
  @IsEnum(TenantStatus)
  @IsOptional()
  status?: TenantStatus;
}
