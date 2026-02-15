import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateContractDto {
  @IsString()
  tenantId: string;

  @IsString()
  roomId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsNumber()
  deposit: number;

  @IsNumber()
  currentRent: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  occupantCount?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  contractImageUrl?: string;
}
