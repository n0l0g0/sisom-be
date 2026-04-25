import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { LineModule } from '../line/line.module';

@Module({
  imports: [LineModule],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
