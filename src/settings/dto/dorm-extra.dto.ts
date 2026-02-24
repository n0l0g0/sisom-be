import { IsOptional, IsString, IsNumber } from 'class-validator';

export class DormExtraDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  mapUrl?: string;

  @IsOptional()
  @IsString()
  lineLink?: string;

  @IsOptional()
  @IsNumber()
  monthlyDueDay?: number;
}
