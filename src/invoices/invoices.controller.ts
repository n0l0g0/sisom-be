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

  @Get('outstanding-report')
  getOutstandingReport(
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.invoicesService.getOutstandingReport(
      Number(month) || new Date().getMonth() + 1,
      Number(year) || new Date().getFullYear(),
    );
  }

  /** Returns distinct (year, month) pairs with invoice counts — lightweight, no joins. */
  @Get('months')
  getMonths() {
    return this.invoicesService.getAvailableMonths();
  }

  @Get()
  findAll(
    @Query('roomId') roomId?: string,
    @Query('ids') ids?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    if (ids) {
      return this.invoicesService.findByIds(ids.split(','));
    }
    if (roomId) {
      return this.invoicesService.findByRoom(roomId);
    }
    const m = month ? Number(month) : undefined;
    const y = year ? Number(year) : undefined;
    return this.invoicesService.findAll(m, y);
  }

  @Post('fetch-by-ids')
  fetchByIds(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids)) {
      return [];
    }
    return this.invoicesService.findByIds(body.ids);
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

  @Post(':id/settle-partial')
  settlePartialOne(
    @Param('id') id: string,
    @Body() body: { amount: number; paidAt?: string },
  ) {
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('amount must be a positive number');
    }
    const paidAt = typeof body?.paidAt === 'string' ? body.paidAt : undefined;
    return this.invoicesService.settlePartial(id, amount, paidAt);
  }

  @Post(':id/unsettle')
  unsettleOne(@Param('id') id: string) {
    return this.invoicesService.unsettle(id);
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

  @Post('send-room')
  sendRoom(
    @Body()
    payload: {
      roomId: string;
      month: number;
      year: number;
    },
  ) {
    return this.invoicesService.sendForRoom(
      Number(payload.month),
      Number(payload.year),
      String(payload.roomId),
    );
  }

  @Post('recalculate-month')
  recalculateMonth(@Body() payload: { month: number; year: number }) {
    return this.invoicesService.recalculateMonth(
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

  @Post('overdue/run')
  runMarkOverdue() {
    return this.invoicesService.markOverdue();
  }

  @Post('schedules/notify/run')
  runNotifySchedules() {
    return this.invoicesService.notifyPaymentSchedules();
  }
}
