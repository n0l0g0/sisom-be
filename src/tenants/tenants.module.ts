import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { LineModule } from '../line/line.module';

@Module({
  imports: [LineModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
