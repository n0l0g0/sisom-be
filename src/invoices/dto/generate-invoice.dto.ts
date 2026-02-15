import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class GenerateInvoiceDto {
  @IsNotEmpty()
  @IsString()
  roomId: string;

  @IsNotEmpty()
  @IsNumber()
  month: number;

  @IsNotEmpty()
  @IsNumber()
  year: number;
}
