import { IsString, IsOptional } from 'class-validator';

export class CreateMaintenanceDto {
  @IsString()
  roomId: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  reportedBy?: string;
}
