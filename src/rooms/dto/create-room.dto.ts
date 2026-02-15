import { RoomStatus } from '@prisma/client';
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  number: string;

  @IsInt()
  @Min(0)
  floor: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerMonth?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  waterOverrideAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  electricOverrideAmount?: number;

  @IsOptional()
  status?: RoomStatus;

  @IsOptional()
  @IsString()
  buildingId?: string;
}
