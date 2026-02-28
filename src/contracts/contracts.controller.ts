import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  create(@Body() createContractDto: CreateContractDto) {
    return this.contractsService.create(createContractDto);
  }

  @Get()
  findAll(@Query('isActive') isActive?: string) {
    return this.contractsService.findAll({ 
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined 
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateContractDto: UpdateContractDto,
  ) {
    return this.contractsService.update(id, updateContractDto);
  }

  @Post('sync-deposit')
  syncDeposit() {
    return this.contractsService.syncDepositsGlobal();
  }

  @Post('sync-rent')
  syncRent() {
    return this.contractsService.syncRentFromRoom();
  }

  @Post(':id/move-out')
  moveOut(@Param('id') id: string, @Body() body: { moveOutDate?: string }) {
    return this.contractsService.moveOut(id, body?.moveOutDate);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contractsService.remove(id);
  }
}
