import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';
import {
  InvoiceDTO,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceQueryParams,
  InvoiceSummary,
  PaginatedResult,
} from '../types/index.js';

function normalizeOptionalText(value: unknown, fallback: string | null = null): string | null {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function normalizeOptionalNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? parseFloat(numeric.toFixed(2)) : 0;
}

function normalizeSelector(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[-_\s]+/g, '_');
}

function hasNonEmptyValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function resolvePaymentMethodValue(payload: any = {}): 'CASH' | 'CHEQUE' | 'BANK_SLIP' {
  const selector = normalizeSelector(payload.paymentSelector || payload.paymentMethod || payload.paymentMode || payload.docType);
  if (selector === 'BANK_SLIP' || selector === 'BANKSLIP' || selector === 'BANK_SLIP_PAYMENT' || Boolean(payload.bankSlip)) {
    return 'BANK_SLIP';
  }
  if (selector === 'CHEQUE' || selector === 'CHECK' || selector === 'CHEQUE_PAYMENT' || selector === 'CHECK_PAYMENT') {
    return 'CHEQUE';
  }
  if (selector === 'CASH' || selector === 'CASH_PAYMENT') {
    return 'CASH';
  }
  return 'CASH';
}

function isChequeTransaction(payload: any = {}): boolean {
  const paymentMethod = resolvePaymentMethodValue(payload);
  return paymentMethod === 'CHEQUE' || paymentMethod === 'BANK_SLIP' || Boolean(payload.bankSlip)
    || Boolean(normalizeOptionalText(payload.chequeNo) || normalizeOptionalText(payload.bankName) || normalizeOptionalText(payload.branchName));
}

function computeBalanceDue(amount: unknown, received: unknown): number {
  const computed = parseFloat((Number(amount) - Number(received)).toFixed(2));
  return Math.max(0, Number.isFinite(computed) ? computed : 0);
}

function toMoneyNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return parseFloat(numeric.toFixed(2));
}

let storeOutstandingBalanceColumnExists: boolean | undefined;

async function hasStoreOutstandingBalanceColumn(tx: any): Promise<boolean> {
  if (storeOutstandingBalanceColumnExists !== undefined) {
    return storeOutstandingBalanceColumnExists;
  }

  const rows = await tx.$queryRaw`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stores'
      AND COLUMN_NAME = 'outstandingBalance'
    LIMIT 1
  `;

  storeOutstandingBalanceColumnExists = Array.isArray(rows) && rows.length > 0;
  return storeOutstandingBalanceColumnExists;
}

async function recomputeStoreOutstandingBalance(tx: any, storeId: string): Promise<number> {
  const aggregate = await tx.invoice.aggregate({
    where: {
      storeId,
      status: { not: 'cancelled' },
      balanceDue: { gt: 0 },
    },
    _sum: { balanceDue: true },
  });

  const outstandingBalance = toMoneyNumber(aggregate?._sum?.balanceDue);
  const hasOutstandingColumn = await hasStoreOutstandingBalanceColumn(tx);

  if (hasOutstandingColumn) {
    await tx.$executeRaw`
      UPDATE stores
      SET outstandingBalance = ${outstandingBalance.toFixed(2)}
      WHERE id = ${storeId}
    `;
  }

  return outstandingBalance;
}

async function compileLedgerAggregates(tx: any): Promise<void> {
  await Promise.all([
    tx.invoice.aggregate({
      where: { status: { not: 'cancelled' } },
      _sum: { amount: true, received: true, balanceDue: true },
      _count: { _all: true },
    }),
    tx.invoice.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    tx.invoice.groupBy({
      by: ['storeId'],
      where: {
        status: { not: 'cancelled' },
        balanceDue: { gt: 0 },
      },
      _sum: { balanceDue: true },
    }),
  ]);
}

function toDTO(record: any): InvoiceDTO {
  return {
    id: record.id,
    documentNo: record.documentNo,
    date: record.date?.toISOString?.() || record.date,
    docType: record.docType as InvoiceDTO['docType'],
    description: record.description ?? undefined,
    amount: Number(record.amount),
    received: Number(record.received),
    balanceDue: Number(record.balanceDue),
    status: record.status as InvoiceDTO['status'],
    chequeNo: record.chequeNo ?? undefined,
    storeId: record.storeId,
    storeName: record.store?.name ?? undefined,
    storeRoute: record.store?.route ?? undefined,
    salesPersonId: record.salesPersonId,
    salesPersonName: record.salesPerson?.name ?? undefined,
    payments: record.payments?.map((p: any) => ({
      id: p.id,
      date: p.date?.toISOString?.() || p.date,
      amountPaid: Number(p.amountPaid),
      description: p.description ?? undefined,
      paymentMethod: p.paymentMethod,
      chequeNo: p.chequeNo ?? undefined,
      invoiceId: p.invoiceId,
    })),
    createdAt: record.createdAt?.toISOString(),
    updatedAt: record.updatedAt?.toISOString(),
  };
}

export class InvoiceService {
  /**
   * GET /api/invoices
   * Paginated, filterable, searchable list of invoices.
   */
  static async getAll(params: InvoiceQueryParams): Promise<PaginatedResult<InvoiceDTO>> {
    const {
      search,
      storeId,
      salesPersonId: spId,
      status,
      docType,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      const q = search.trim();
      where.OR = [
        { documentNo: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { chequeNo: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (storeId) where.storeId = storeId;
    if (spId) where.salesPersonId = spId;
    if (status) where.status = status;
    if (docType) where.docType = docType;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const allowedSortFields = [
      'documentNo', 'date', 'amount', 'received', 'balanceDue',
      'status', 'createdAt', 'updatedAt',
    ];
    const sortBy = 'date';
    const sortOrder = 'desc' as const;

    const [total, items] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          store: { select: { id: true, name: true, route: true } },
          salesPerson: { select: { id: true, name: true } },
          payments: {
            orderBy: { date: 'desc' },
            select: { id: true, date: true, amountPaid: true, paymentMethod: true },
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
   * GET /api/invoices/summary
   * Aggregate metrics across all invoices.
   */
  static async getSummary(startDate?: string, endDate?: string): Promise<InvoiceSummary> {
    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.date = {};
      if (startDate) dateFilter.date.gte = new Date(startDate);
      if (endDate) dateFilter.date.lte = new Date(endDate);
    }

    dateFilter.status = { not: 'cancelled' };

    const [aggregate, statusBuckets] = await Promise.all([
      prisma.invoice.aggregate({
        where: dateFilter,
        _sum: {
          amount: true,
          received: true,
          balanceDue: true,
        },
        _count: { _all: true },
      }),
      prisma.invoice.groupBy({
        where: dateFilter,
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const metrics: InvoiceSummary = {
      totalBilled: toMoneyNumber(aggregate?._sum?.amount),
      totalReceived: toMoneyNumber(aggregate?._sum?.received),
      totalOutstanding: toMoneyNumber(aggregate?._sum?.balanceDue),
      count: aggregate?._count?._all || 0,
      paidCount: 0,
      pendingCount: 0,
      overdueCount: 0,
      collectionRate: '0.00',
    };

    statusBuckets.forEach((bucket) => {
      if (bucket.status === 'paid') metrics.paidCount = bucket._count._all;
      if (bucket.status === 'pending') metrics.pendingCount = bucket._count._all;
      if (bucket.status === 'overdue') metrics.overdueCount = bucket._count._all;
    });

    metrics.collectionRate =
      metrics.totalBilled > 0
        ? ((metrics.totalReceived / metrics.totalBilled) * 100).toFixed(2)
        : '0.00';

    return metrics;
  }

  /**
   * GET /api/invoices/:id
   */
  static async getById(id: string): Promise<InvoiceDTO> {
    const item = await prisma.invoice.findUnique({
      where: { id },
      include: {
        store: true,
        salesPerson: true,
        payments: { orderBy: { date: 'desc' } },
      },
    });

    if (!item) {
      throw new AppError('Invoice not found', 404);
    }

    return toDTO(item);
  }

  /**
   * GET /api/invoices/document/:documentNo
   */
  static async getByDocumentNo(documentNo: string): Promise<InvoiceDTO> {
    const item = await prisma.invoice.findUnique({
      where: { documentNo },
      include: {
        store: true,
        salesPerson: true,
        payments: { orderBy: { date: 'desc' } },
      },
    });

    if (!item) {
      throw new AppError('Invoice not found', 404);
    }

    return toDTO(item);
  }

  /**
   * POST /api/invoices
    * Creates an invoice with a user-provided document number.
   * If received > 0, automatically creates an initial payment record
   * inside the same transaction.
   */
  static async create(input: CreateInvoiceInput): Promise<InvoiceDTO> {
    if (!input.storeId) {
      throw new AppError('storeId is required', 400);
    }
    if (!input.salesPersonId) {
      throw new AppError('salesPersonId is required', 400);
    }
    const providedDocumentNo = normalizeOptionalText((input as any).documentNo ?? (input as any).docNo) ?? `INV-${Date.now()}`;
    const safeDescription = normalizeOptionalText(input.description, 'Manual Invoice Entry');

    // Verify store and sales person exist
    const [store, salesPerson] = await Promise.all([
      prisma.store.findUnique({ where: { id: input.storeId } }),
      prisma.salesPerson.findUnique({ where: { id: input.salesPersonId } }),
    ]);

    if (!store) throw new AppError('Store not found', 400);
    if (!salesPerson) throw new AppError('Sales person not found', 400);

    const amountDecimal = normalizeOptionalNumber(input.amount);
    const receivedDecimal = normalizeOptionalNumber(input.received);
    const balanceDue = amountDecimal - receivedDecimal;

    // Determine status based on payment
    let invoiceStatus = input.status;
    if (!invoiceStatus) {
      if (balanceDue <= 0) invoiceStatus = 'paid';
      else if (receivedDecimal > 0) invoiceStatus = 'pending';
      else invoiceStatus = 'pending';
    }

    // Execute everything in a $transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Create the invoice
      const invoice = await tx.invoice.create({
        data: {
          documentNo: providedDocumentNo,
          date: input.date ? new Date(input.date) : new Date(),
          docType: input.docType || 'Invoice',
          description: safeDescription,
          amount: amountDecimal,
          received: receivedDecimal,
          balanceDue,
          status: invoiceStatus as any,
          chequeNo: normalizeOptionalText((input as any).chequeNo) ?? null,
          storeId: input.storeId,
          salesPersonId: input.salesPersonId,
        },
        include: {
          store: { select: { id: true, name: true } },
          salesPerson: { select: { id: true, name: true } },
        },
      });

      // If there's an initial payment, record it automatically
      if (receivedDecimal > 0) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            date: invoice.date,
            amountPaid: receivedDecimal,
            description: `Initial payment for ${providedDocumentNo}`,
            paymentMethod: resolvePaymentMethodValue(input as any) as any,
            chequeNo: input.chequeNo || null,
          },
        });
      }

      // Fetch complete invoice with payments
      return tx.invoice.findUnique({
        where: { id: invoice.id },
        include: {
          store: true,
          salesPerson: true,
          payments: { orderBy: { date: 'desc' } },
        },
      });
    });

    return toDTO(result);
  }

  /**
   * PUT /api/invoices/:id
   * Update non-financial fields only.
   * Financial adjustments should be done through payment endpoints.
   */
  static async update(id: string, input: UpdateInvoiceInput): Promise<InvoiceDTO> {
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Invoice not found', 404);
    }

    const payload = input as any;
    const updateData: any = {};
    if (payload.description !== undefined) updateData.description = payload.description;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.docType !== undefined) updateData.docType = payload.docType;
    if (payload.documentNo !== undefined) updateData.documentNo = String(payload.documentNo).trim();
    if (payload.docNo !== undefined) updateData.documentNo = String(payload.docNo).trim();
    if (payload.date !== undefined) updateData.date = new Date(payload.date);

    const existingReceived = toMoneyNumber(existing.received);
    const amountProvided = payload.amount !== undefined;
    const receivedProvided = payload.received !== undefined;
    const receivedAmountProvided = hasNonEmptyValue(payload.receivedAmount);
    const amountPaidProvided = hasNonEmptyValue(payload.amountPaid);
    const paymentAmountProvided = hasNonEmptyValue(payload.paymentAmount);
    const amountDecimal = amountProvided ? toMoneyNumber(payload.amount) : toMoneyNumber(existing.amount);
    const explicitPaymentAmount = receivedAmountProvided
      ? toMoneyNumber(payload.receivedAmount)
      : amountPaidProvided
        ? toMoneyNumber(payload.amountPaid)
        : paymentAmountProvided
          ? toMoneyNumber(payload.paymentAmount)
          : 0;

    let receivedDecimal = receivedProvided ? toMoneyNumber(payload.received) : existingReceived;
    if (!receivedProvided && explicitPaymentAmount > 0) {
      receivedDecimal = toMoneyNumber(existingReceived + explicitPaymentAmount);
      updateData.received = receivedDecimal;
    }

    if (amountProvided) updateData.amount = amountDecimal;
    if (receivedProvided) updateData.received = receivedDecimal;
    if (amountProvided || receivedProvided || explicitPaymentAmount > 0) {
      updateData.balanceDue = computeBalanceDue(amountDecimal, receivedDecimal);
    }

    const chequeTransaction = isChequeTransaction(payload);
    const normalizedChequeNo = normalizeOptionalText(payload.chequeNo, null);
    const normalizedBankName = normalizeOptionalText(payload.bankName, null);
    const normalizedBranchName = normalizeOptionalText(payload.branchName, null);

    if (
      payload.chequeNo !== undefined ||
      payload.bankName !== undefined ||
      payload.branchName !== undefined ||
      payload.paymentMode !== undefined ||
      payload.paymentMethod !== undefined ||
      payload.paymentSelector !== undefined ||
      payload.bankSlip !== undefined
    ) {
      updateData.chequeNo = chequeTransaction ? normalizedChequeNo : null;
      updateData.bankName = chequeTransaction ? normalizedBankName : null;
      updateData.branchName = chequeTransaction ? normalizedBranchName : null;
    }

    if (payload.status === undefined && (amountProvided || receivedProvided || explicitPaymentAmount > 0)) {
      if (updateData.balanceDue <= 0) updateData.status = 'paid';
      else if (receivedDecimal > 0) updateData.status = 'pending';
      else updateData.status = existing.status;
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppError(
        'No updatable fields provided. Use payment endpoints for financial adjustments.',
        400,
      );
    }

    const receivedDelta = toMoneyNumber(receivedDecimal - existingReceived);
    const paymentAmountToCreate = receivedDelta > 0
      ? receivedDelta
      : explicitPaymentAmount > 0
        ? explicitPaymentAmount
        : 0;
    const paymentMetadataProvided = hasNonEmptyValue(payload.paymentMethod)
      || hasNonEmptyValue(payload.paymentMode)
      || hasNonEmptyValue(payload.paymentSelector)
      || hasNonEmptyValue(payload.bankSlip)
      || hasNonEmptyValue(payload.chequeNo)
      || hasNonEmptyValue(payload.bankName)
      || hasNonEmptyValue(payload.branchName);
    const shouldCreatePayment = paymentAmountToCreate > 0 && (receivedDelta > 0 || paymentMetadataProvided || explicitPaymentAmount > 0);
    const paymentMethodValue = resolvePaymentMethodValue(payload);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id },
        data: updateData,
      });

      if (shouldCreatePayment) {
        await tx.payment.create({
          data: {
            invoiceId: id,
            date: payload.date ? new Date(payload.date) : new Date(),
            amountPaid: paymentAmountToCreate,
            description: normalizeOptionalText(payload.paymentDescription, `Payment adjustment for ${existing.documentNo}`),
            paymentMethod: paymentMethodValue as any,
            chequeNo: chequeTransaction ? normalizedChequeNo : null,
            bankName: chequeTransaction ? normalizedBankName : null,
            branchName: chequeTransaction ? normalizedBranchName : null,
          },
        });
      }

      const updatedInvoice = await tx.invoice.findUnique({
        where: { id },
        include: {
          store: { select: { id: true, name: true } },
          salesPerson: { select: { id: true, name: true } },
          payments: { orderBy: { date: 'desc' } },
        },
      });

      await recomputeStoreOutstandingBalance(tx, existing.storeId);
      await compileLedgerAggregates(tx);

      return updatedInvoice;
    });

    return toDTO(updated);
  }

  /**
   * DELETE /api/invoices/:id
   * CONSTRAINT-AWARE SOFT/HARD DELETE:
   * - If payments exist → soft-delete by cancelling (balanceDue = 0, status = cancelled)
   * - If no payments → hard-delete permanently
   */
  static async delete(id: string): Promise<{ softDeleted: boolean }> {
    const existing = await prisma.invoice.findUnique({
      where: { id },
      include: { _count: { select: { payments: true } } },
    });

    if (!existing) {
      throw new AppError('Invoice not found', 404);
    }

    if (existing._count.payments > 0) {
      // Soft delete — cancel the invoice
      await prisma.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id },
          data: { status: 'cancelled', balanceDue: 0 },
        });
        await recomputeStoreOutstandingBalance(tx, existing.storeId);
        await compileLedgerAggregates(tx);
      });
      return { softDeleted: true };
    }

    // No payments — hard delete
    await prisma.$transaction(async (tx) => {
      await tx.invoice.delete({ where: { id } });
      await recomputeStoreOutstandingBalance(tx, existing.storeId);
      await compileLedgerAggregates(tx);
    });
    return { softDeleted: false };
  }
}