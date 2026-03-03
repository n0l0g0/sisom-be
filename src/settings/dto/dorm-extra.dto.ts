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

  @IsOptional()
  @IsString()
  lineOaChannelId?: string;

  @IsOptional()
  @IsString()
  lineOaChannelSecret?: string;

  @IsOptional()
  @IsString()
  lineOaChannelAccessToken?: string;

  @IsOptional()
  @IsString()
  slipokApiKey?: string;

  @IsOptional()
  @IsString()
  slipokApiUrl?: string;

  @IsOptional()
  @IsString()
  slipokBranchId?: string;
}
