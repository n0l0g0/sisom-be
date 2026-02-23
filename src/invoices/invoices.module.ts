import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { LineModule } from '../line/line.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [LineModule, SettingsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
