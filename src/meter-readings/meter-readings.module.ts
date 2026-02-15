import { Module } from '@nestjs/common';
import { MeterReadingsService } from './meter-readings.service';
import { MeterReadingsController } from './meter-readings.controller';

@Module({
  controllers: [MeterReadingsController],
  providers: [MeterReadingsService],
})
export class MeterReadingsModule {}
