import { Module } from '@nestjs/common';
import { MeterReadingsService } from './meter-readings.service';
import { MeterReadingsController } from './meter-readings.controller';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [InvoicesModule],
  controllers: [MeterReadingsController],
  providers: [MeterReadingsService],
})
export class MeterReadingsModule {}
