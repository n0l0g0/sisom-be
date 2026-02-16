import { Controller, Get, Put, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateDormConfigDto } from './dto/update-dorm-config.dto';
import { DormExtraDto } from './dto/dorm-extra.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('dorm-config')
  getDormConfig() {
    return this.settingsService.getDormConfig().then((cfg) => cfg ?? {});
  }

  @Put('dorm-config')
  updateDormConfig(@Body() body: UpdateDormConfigDto) {
    return this.settingsService.updateDormConfig(body);
  }

  @Get('dorm-extra')
  getDormExtra() {
    return this.settingsService.getDormExtra();
  }

  @Put('dorm-extra')
  updateDormExtra(@Body() body: DormExtraDto) {
    return this.settingsService.updateDormExtra(body || {});
  }
}
