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
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentStatus } from '@prisma/client';

type SlipokConfirmPayload = {
  paymentId?: string;
  invoiceId?: string;
  status: PaymentStatus;
  amount?: number;
  slipBankRef?: string;
  paidAt?: string;
};

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Post('slipok')
  confirmSlip(@Body() payload: SlipokConfirmPayload) {
    return this.paymentsService.confirmSlip(payload);
  }

  @Get()
  findAll(
    @Query('room') room?: string,
    @Query('status') status?: PaymentStatus,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.paymentsService.findAll({ 
      room, 
      status,
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.paymentsService.remove(id);
  }
}
