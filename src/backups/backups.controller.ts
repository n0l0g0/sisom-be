import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Param,
  Res,
} from '@nestjs/common';
import { BackupsService } from './backups.service';
import type { Response } from 'express';
import * as path from 'path';

@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('schedule')
  getSchedule() {
    return this.backups.getSchedule();
  }

  @Post('schedule')
  setSchedule(@Body() body: { hour: number; minute?: number }) {
    return this.backups.setSchedule({ hour: Number(body.hour), minute: Number(body.minute ?? 0) });
  }

  @Post('run')
  async runNow() {
    return this.backups.runBackup();
  }

  @Get('files')
  listFiles() {
    return this.backups.listFiles();
  }

  @Get('files/:name/download')
  download(@Param('name') name: string, @Res() res: Response) {
    const p = path.resolve('/app/uploads/backups', path.basename(name));
    return res.download(p);
  }

  @Delete('files/:name')
  delete(@Param('name') name: string) {
    return this.backups.deleteFile(name);
  }
}
