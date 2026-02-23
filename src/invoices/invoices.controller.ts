import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('generate')
  generate(@Body() generateInvoiceDto: GenerateInvoiceDto) {
    return this.invoicesService.generate(generateInvoiceDto);
  }

  @Post()
  create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoicesService.create(createInvoiceDto);
  }

  @Get('export')
  export(
    @Query('month') month: number,
    @Query('year') year: number,
    @Res() res: Response,
  ) {
    return this.invoicesService.export(Number(month), Number(year), res);
  }

  @Get()
  findAll(@Query('roomId') roomId?: string, @Query('ids') ids?: string) {
    if (ids) {
      return this.invoicesService.findByIds(ids.split(','));
    }
    if (roomId) {
      return this.invoicesService.findByRoom(roomId);
    }
    return this.invoicesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, updateInvoiceDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.invoicesService.remove(id);
  }

  @Post(':id/send')
  sendOne(@Param('id') id: string) {
    return this.invoicesService.send(id);
  }

  @Post(':id/settle')
  settleOne(
    @Param('id') id: string,
    @Body() body: { method: 'DEPOSIT' | 'CASH'; paidAt?: string },
  ) {
    const method = body?.method === 'DEPOSIT' ? 'DEPOSIT' : 'CASH';
    const paidAt = typeof body?.paidAt === 'string' ? body.paidAt : undefined;
    return this.invoicesService.settle(id, method, paidAt);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.invoicesService.cancel(id);
  }

  @Post(':id/items')
  addItem(
    @Param('id') id: string,
    @Body() body: { description: string; amount: number },
  ) {
    return this.invoicesService.addItem(id, body);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') _id: string,
    @Param('itemId') itemId: string,
    @Body() body: { description?: string; amount?: number },
  ) {
    return this.invoicesService.updateItem(itemId, body);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id') _id: string, @Param('itemId') itemId: string) {
    return this.invoicesService.removeItem(itemId);
  }

  @Post('send-all')
  sendAll(@Body() payload: { month: number; year: number }) {
    return this.invoicesService.sendAll(
      Number(payload.month),
      Number(payload.year),
    );
  }

  // Auto-send config
  @Get('auto-send/config')
  getAutoSendConfig() {
    return this.invoicesService.getAutoSendConfig();
  }

  @Post('auto-send/config')
  setAutoSendConfig(
    @Body()
    body: {
      enabled: boolean;
      dayOfMonth: number;
      hour: number;
      minute?: number;
      timezone?: string;
    },
  ) {
    return this.invoicesService.setAutoSendConfig({
      enabled: !!body.enabled,
      dayOfMonth: Math.max(1, Math.min(28, Number(body.dayOfMonth ?? 1))),
      hour: Math.max(0, Math.min(23, Number(body.hour ?? 9))),
      minute: Math.max(0, Math.min(59, Number(body.minute ?? 0))),
      timezone: String(body.timezone || 'Asia/Bangkok'),
    });
  }

  @Post('auto-send/run')
  runAutoSend() {
    return this.invoicesService.runAutoSend();
  }
}
