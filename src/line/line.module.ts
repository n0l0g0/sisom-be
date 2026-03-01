import { Module } from '@nestjs/common';
import { LineService } from './line.service';
import { LineController } from './line.controller';
import { MediaModule } from '../media/media.module';
import { SlipOkModule } from '../slipok/slipok.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [MediaModule, SlipOkModule, SettingsModule],
  providers: [LineService],
  controllers: [LineController],
  exports: [LineService],
})
export class LineModule {}
