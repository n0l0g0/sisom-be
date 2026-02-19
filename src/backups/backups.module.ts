import { Module } from '@nestjs/common';
import { BackupsService } from './backups.service';
import { BackupsController } from './backups.controller';

@Module({
  providers: [BackupsService],
  controllers: [BackupsController],
  exports: [BackupsService],
})
export class BackupsModule {}
