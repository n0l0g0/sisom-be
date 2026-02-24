import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    let db = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {}
    return {
      status: 'ok',
      time: new Date().toISOString(),
      services: { db },
    };
  }

  @Get('ping')
  getPing() {
    return { ping: 'pong' };
  }

  @Get('healthz')
  getHealthz() {
    return 'OK';
  }
}
