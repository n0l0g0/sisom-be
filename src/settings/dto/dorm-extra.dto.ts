import { IsOptional, IsString } from 'class-validator';

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
}
