import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateMeterReadingDto {
  @IsNotEmpty()
  @IsString()
  roomId: string;

  @IsNotEmpty()
  @IsNumber()
  month: number;

  @IsNotEmpty()
  @IsNumber()
  year: number;

  @IsNotEmpty()
  @IsNumber()
  waterReading: number;

  @IsNotEmpty()
  @IsNumber()
  electricReading: number;
}
