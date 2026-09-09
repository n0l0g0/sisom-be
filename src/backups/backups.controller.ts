import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Param,
  Query,
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
    return this.backups.setSchedule({
      hour: Number(body.hour),
      minute: Number(body.minute ?? 0),
    });
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

  @Post('files/:name/upload-drive')
  async uploadToDrive(@Param('name') name: string) {
    return this.backups.uploadToDrive(name);
  }

  @Get('google-drive')
  getGoogleDriveConfig() {
    return this.backups.getGoogleDriveConfig();
  }

  @Post('google-drive')
  setGoogleDriveConfig(
    @Body()
    body: {
      folderId: string;
      autoUpload: boolean;
      credentials?: object | null;
    },
  ) {
    return this.backups.setGoogleDriveConfig(body);
  }

  @Delete('google-drive')
  removeGoogleDriveConfig() {
    return this.backups.removeGoogleDriveConfig();
  }

  @Post('google-drive/test')
  async testGoogleDriveConnection() {
    return this.backups.testGoogleDriveConnection();
  }

  @Get('google-drive/oauth/url')
  getOAuthUrl(
    @Query('clientId') clientId: string,
    @Query('clientSecret') clientSecret: string,
    @Query('folderId') folderId: string,
    @Query('autoUpload') autoUpload: string,
  ) {
    const url = this.backups.initOAuth2({
      clientId,
      clientSecret,
      folderId,
      autoUpload: autoUpload === 'true',
    });
    return { url };
  }

  @Get('google-drive/oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const appUrl = (process.env.API_URL || '').replace(/\/$/, '');
    const redirectBase = `${appUrl}/settings/backups`;
    if (error) {
      return res.redirect(`${redirectBase}?drive_error=${encodeURIComponent(error)}`);
    }
    try {
      await this.backups.exchangeOAuth2Code(code);
      return res.redirect(`${redirectBase}?drive_connected=1`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.redirect(`${redirectBase}?drive_error=${encodeURIComponent(msg)}`);
    }
  }
}
