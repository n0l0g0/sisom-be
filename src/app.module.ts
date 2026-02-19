import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoomsModule } from './rooms/rooms.module';
import { TenantsModule } from './tenants/tenants.module';
import { MeterReadingsModule } from './meter-readings/meter-readings.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { ContractsModule } from './contracts/contracts.module';
import { LineModule } from './line/line.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';
import { BuildingsModule } from './buildings/buildings.module';
import { AssetsModule } from './assets/assets.module';
import { MediaModule } from './media/media.module';
import { BackupsModule } from './backups/backups.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RoomsModule,
    TenantsModule,
    MeterReadingsModule,
    InvoicesModule,
    PaymentsModule,
    ContractsModule,
    LineModule,
    MaintenanceModule,
    SettingsModule,
    UsersModule,
    BuildingsModule,
    AssetsModule,
    MediaModule,
    BackupsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
