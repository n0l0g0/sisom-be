import { Module } from '@nestjs/common';
import { SlipOkService } from './slipok.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [SlipOkService],
  exports: [SlipOkService],
})
export class SlipOkModule {}
