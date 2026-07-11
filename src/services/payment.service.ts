import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';
import {
  PaymentDTO,
  CreatePaymentInput,
  BulkPaymentInput,
  PaymentQueryParams,
  PaginatedResult,
} from '../types/index.js';

function toDTO(record: any): PaymentDTO {
  return {
    id: record.id,
    date: record.date?.toISOString?.() || record.date,
    amountPaid: Number(record.amountPaid),
    description: record.description ?? undefined,
    paymentMethod: record.paymentMethod as PaymentDTO['paymentMethod'],
    chequeNo: record.chequeNo ?? undefined,
    invoiceId: record.invoiceId,
    invoiceDocumentNo: record.invoice?.documentNo ?? undefined,
    invoiceAmount: record.invoice?.amount ? Number(record.invoice.amount) : undefined,
    invoiceBalanceDue: record.invoice?.balanceDue ? Number(record.invoice.balanceDue) : undefined,
    invoiceStatus: record.invoice?.status as PaymentDTO['invoiceStatus'],
    storeName: record.invoice?.store?.name ?? undefined,
  };
}

export class PaymentService {
  /**
   * GET /api/payments
   * Paginated, filterable list of payments.
   */
  static async getAll(params: PaymentQueryParams): Promise<PaginatedResult<PaymentDTO>> {
    const { invoiceId, startDate, endDate, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (invoiceId) where.invoiceId = invoiceId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [total, items] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          invoice: {
            select: {
              id: true,
              documentNo: true,
              amount: true,
              balanceDue: true,
              status: true,
              store: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    const pages = Math.ceil(total / limit);

    return {
      data: items.map(toDTO),
      pagination: { page, limit, total, pages },
    };
  }

  /**
   * GET /api/payments/:id
   */
  static async getById(id: string): Promise<PaymentDTO> {
    const item = await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: {
          include: {
            store: { select: { id: true, name: true } },
            salesPerson: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!item) {
      throw new AppError('Payment not found', 404);
    }

    return toDTO(item);
  }

  /**
   * POST /api/payments/collect
   *
   * ENTERPRISE PAYMENT COLLECTION WITH ATOMIC TRANSACTION.
   *
   * When a payment is collected:
   * 1. A new Payment record is INSERTED
   * 2. The corresponding Invoice is UPDATED:
   *    - received += amountPaid
   *    - balanceDue -= amountPaid
   *    - status dynamically adjusted (paid if fully cleared)
   *
   * BOTH operations happen inside a SINGLE Prisma $transaction.
   */
  static async collect(input: CreatePaymentInput): Promise<{ payment: PaymentDTO; invoice: any }> {
    if (!input.invoiceId) {
      throw new AppError('invoiceId is required', 400);
    }
    const payAmount = parseFloat(String(input.amountPaid));
    if (!payAmount || payAmount <= 0) {
      throw new AppError('amountPaid must be greater than 0', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock and read the invoice within the transaction
      const invoice = await tx.invoice.findUnique({
        where: { id: input.invoiceId },
        select: {
          id: true,
          documentNo: true,
          amount: true,
          received: true,
          balanceDue: true,
          status: true,
        },
      });

      if (!invoice) {
        throw new Error(`Invoice ${input.invoiceId} not found`);
      }

      const currentBalance = Number(invoice.balanceDue);
      const currentReceived = Number(invoice.received);

      // 2. Validate: prevent over-collection beyond balance due
      if (payAmount > currentBalance) {
        throw new Error(
          `Payment amount (${payAmount.toFixed(2)}) exceeds outstanding balance (${currentBalance.toFixed(2)}). ` +
          `Maximum collectible: ${currentBalance.toFixed(2)}`,
        );
      }

      // 3. Calculate new values
      const newReceived = currentReceived + payAmount;
      const newBalanceDue = currentBalance - payAmount;

      // 4. Dynamically determine new status
      let newStatus = invoice.status;
      if (newBalanceDue <= 0) {
        newStatus = 'paid';
      } else if (newBalanceDue > 0 && newReceived > 0) {
        newStatus = 'pending';
      }

      // 5. UPDATE the Invoice ledger
      const updatedInvoice = await tx.invoice.update({
        where: { id: input.invoiceId },
        data: {
          received: newReceived,
          balanceDue: newBalanceDue,
          status: newStatus,
        },
        select: {
          id: true,
          documentNo: true,
          amount: true,
          received: true,
          balanceDue: true,
          status: true,
        },
      });

      // 6. INSERT the Payment record
      const payment = await tx.payment.create({
        data: {
          invoiceId: input.invoiceId,
          date: input.date ? new Date(input.date) : new Date(),
          amountPaid: payAmount,
          description: input.description || `Payment collected for ${invoice.documentNo}`,
          paymentMethod: (input.paymentMethod || 'cash') as any,
          chequeNo: input.chequeNo || null,
        },
      });

      return { payment: toDTO(payment), invoice: updatedInvoice };
    });

    return result;
  }

  /**
   * POST /api/payments/bulk-collect
   * Collect payments for multiple invoices in a single atomic transaction.
   */
  static async bulkCollect(input: BulkPaymentInput): Promise<any[]> {
    if (!input.payments || input.payments.length === 0) {
      throw new AppError('payments must be a non-empty array', 400);
    }

    // Validate all payments first
    for (const p of input.payments) {
      if (!p.invoiceId) {
        throw new AppError('All payments must have an invoiceId', 400);
      }
      if (!p.amountPaid || parseFloat(String(p.amountPaid)) <= 0) {
        throw new AppError(`All payments must have amountPaid > 0. Check invoice ${p.invoiceId}.`, 400);
      }
    }

    const results = await prisma.$transaction(async (tx) => {
      const processed: any[] = [];

      for (const p of input.payments) {
        const payAmount = parseFloat(String(p.amountPaid));

        const invoice = await tx.invoice.findUnique({
          where: { id: p.invoiceId },
          select: { id: true, documentNo: true, amount: true, received: true, balanceDue: true, status: true },
        });

        if (!invoice) {
          throw new Error(`Invoice ${p.invoiceId} not found - rolling back all payments`);
        }

        const currentBalance = Number(invoice.balanceDue);
        const currentReceived = Number(invoice.received);

        if (payAmount > currentBalance) {
          throw new Error(
            `Payment ${payAmount} exceeds balance ${currentBalance} for invoice ${invoice.documentNo}. Rolling back.`,
          );
        }

        const newReceived = currentReceived + payAmount;
        const newBalanceDue = currentBalance - payAmount;
        const newStatus = newBalanceDue <= 0 ? 'paid' : invoice.status;

        const updatedInvoice = await tx.invoice.update({
          where: { id: p.invoiceId },
          data: { received: newReceived, balanceDue: newBalanceDue, status: newStatus },
          select: { id: true, documentNo: true, amount: true, received: true, balanceDue: true, status: true },
        });

        const payment = await tx.payment.create({
          data: {
            invoiceId: p.invoiceId,
            date: p.date ? new Date(p.date) : new Date(),
            amountPaid: payAmount,
            description: p.description || `Bulk payment for ${invoice.documentNo}`,
            paymentMethod: (p.paymentMethod || 'cash') as any,
            chequeNo: p.chequeNo || null,
          },
        });

        processed.push({ payment: toDTO(payment), invoice: updatedInvoice });
      }

      return processed;
    });

    return results;
  }

  /**
   * DELETE /api/payments/:id (Reverse payment)
   * Reverses a payment and updates the invoice accordingly.
   * Uses a transaction to ensure atomic reversal.
   */
  static async reverse(id: string): Promise<{ payment: any; invoice: any }> {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id },
        select: { id: true, invoiceId: true, amountPaid: true },
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      const invoice = await tx.invoice.findUnique({
        where: { id: payment.invoiceId },
        select: { id: true, documentNo: true, received: true, balanceDue: true, amount: true, status: true },
      });

      if (!invoice) {
        throw new Error('Associated invoice not found');
      }

      const reversedReceived = Number(invoice.received) - Number(payment.amountPaid);
      const reversedBalance = Number(invoice.balanceDue) + Number(payment.amountPaid);

      let reversedStatus = invoice.status;
      if (reversedBalance > 0 && reversedStatus === 'paid') {
        reversedStatus = 'pending';
      } else if (reversedBalance <= 0) {
        reversedStatus = 'paid';
      }

      const updatedInvoice = await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          received: reversedReceived,
          balanceDue: reversedBalance,
          status: reversedStatus,
        },
        select: { id: true, documentNo: true, amount: true, received: true, balanceDue: true, status: true },
      });

      await tx.payment.delete({ where: { id: payment.id } });

      return { payment: { id: payment.id, amountPaid: payment.amountPaid }, invoice: updatedInvoice };
    });

    return result;
  }
}