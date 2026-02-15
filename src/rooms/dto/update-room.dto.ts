import { PartialType } from '@nestjs/mapped-types';
import { CreateRoomDto } from './create-room.dto';
import { IsOptional, IsNumber } from 'class-validator';

export class UpdateRoomDto extends PartialType(CreateRoomDto) {
  @IsOptional()
  @IsNumber()
  pricePerMonth?: number;

  @IsOptional()
  @IsNumber()
  waterOverrideAmount?: number;

  @IsOptional()
  @IsNumber()
  electricOverrideAmount?: number;
}
