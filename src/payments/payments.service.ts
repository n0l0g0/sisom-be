import { Injectable, BadRequestException } from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from '../line/line.service';
import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import { appendLog } from '../activity/logger';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private lineService: LineService,
  ) {}

  create(createPaymentDto: CreatePaymentDto) {
    return this.prisma.payment
      .create({
        data: createPaymentDto,
      })
      .then((p) => {
        appendLog({
          action: 'CREATE',
          entityType: 'Payment',
          entityId: p.id,
          details: { invoiceId: p.invoiceId, amount: p.amount },
        });
        return p;
      });
  }

  findAll(filters?: { room?: string; status?: PaymentStatus }) {
    const where: Prisma.PaymentWhereInput = {};
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.room && filters.room.trim()) {
      where.invoice = {
        is: {
          contract: {
            is: {
              room: {
                is: {
                  number: { contains: filters.room.trim() },
                },
              },
            },
          },
        },
      };
    }
    return this.prisma.payment.findMany({
      where,
      include: {
        invoice: {
          include: {
            contract: {
              include: {
                room: {
                  include: {
                    building: true,
                  },
                },
                tenant: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: true,
      },
    });
  }

  async update(id: string, updatePaymentDto: UpdatePaymentDto) {
    const payment = await this.prisma.payment.update({
      where: { id },
      data: updatePaymentDto,
      include: {
        invoice: {
          include: {
            contract: {
              include: {
                tenant: true,
                room: {
                  include: {
                    building: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (updatePaymentDto.status === PaymentStatus.VERIFIED) {
      const paidAt = updatePaymentDto.paidAt
        ? new Date(updatePaymentDto.paidAt)
        : new Date();
      await this.prisma.payment.update({
        where: { id },
        data: { paidAt },
      });
      await this.prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: InvoiceStatus.PAID },
      });
      // Send Flex (Green) - ตัดยอดเรียบร้อย
      const tenant = payment.invoice?.contract?.tenant;
      const room = payment.invoice?.contract?.room?.number;
      const period =
        payment.invoice &&
        typeof payment.invoice.month === 'number' &&
        typeof payment.invoice.year === 'number'
          ? `${['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][Math.max(0, Math.min(11, payment.invoice.month - 1))]} ${payment.invoice.year}`
          : undefined;
      if (tenant && tenant.lineUserId && room) {
        try {
          await this.lineService.pushSuccessFlex(
            tenant.lineUserId,
            room,
            Number(payment.amount),
            paidAt,
            undefined,
            period,
          );
        } catch (e) {
          const msg = 'ตัดยอดเรียบร้อยแล้วครับ';
          try {
            await this.lineService.pushMessage(tenant.lineUserId, msg);
          } catch {
            // ignore
          }
        }
      }
      if (room) {
        try {
          await this.lineService.notifyStaffPaymentSuccess({
            room,
            amount: Number(payment.amount),
            period,
            paidAt,
            tenantName: tenant?.name || undefined,
          });
        } catch {
          // Ignore LINE notify errors
        }
      }
    }
    if (updatePaymentDto.status === PaymentStatus.REJECTED) {
      const tenant = payment.invoice?.contract?.tenant;
      const room = payment.invoice?.contract?.room?.number;
      const period = payment.invoice
        ? `${['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][Math.max(0, Math.min(11, payment.invoice.month - 1))]} ${payment.invoice.year}`
        : undefined;
      if (tenant && tenant.lineUserId && room) {
        const reason =
          'สลิปของคุณไม่ผ่านการตรวจสอบ กรุณาติดต่อผู้ดูแล';
        try {
          await this.lineService.pushRejectFlex(
            tenant.lineUserId,
            room,
            new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
            reason,
            period,
          );
        } catch (e) {
          try {
            await this.lineService.pushMessage(tenant.lineUserId, reason);
          } catch {
            // ignore
          }
        }
      }
    }

    return payment;
  }

  async confirmSlip(payload: {
    paymentId?: string;
    invoiceId?: string;
    status: PaymentStatus;
    amount?: number;
    slipBankRef?: string;
    paidAt?: string;
  }) {
    let payment: Prisma.PaymentGetPayload<Prisma.PaymentDefaultArgs> | null =
      null;
    if (payload.paymentId) {
      payment = await this.prisma.payment.findUnique({
        where: { id: payload.paymentId },
      });
    } else if (payload.invoiceId) {
      payment = await this.prisma.payment.findFirst({
        where: { invoiceId: payload.invoiceId },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!payment) {
      throw new BadRequestException('Payment not found');
    }

    let nextStatus = payload.status;
    if (
      typeof payload.amount === 'number' &&
      Number(payload.amount) !== Number(payment.amount)
    ) {
      nextStatus = PaymentStatus.PENDING;
    }

    return this.update(payment.id, {
      status: nextStatus,
      slipBankRef: payload.slipBankRef,
      paidAt: payload.paidAt,
    });
  }

  async remove(id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p) return { ok: true };
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.REJECTED },
    });
    appendLog({
      action: 'DELETE',
      entityType: 'Payment',
      entityId: id,
      details: { invoiceId: p.invoiceId },
    });
    return updated;
  }
}
