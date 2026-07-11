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

/**
 * Generate the next sequential document number atomically.
 * Uses an upsert on the singleton DocumentCounter row to guarantee no duplicates.
 */
async function generateDocumentNo(): Promise<string> {
  const counter = await prisma.documentCounter.upsert({
    where: { id: 1 },
    update: { seq: { increment: 1 } },
    create: { id: 1, prefix: 'INV-', seq: 1, year: new Date().getFullYear() },
  });
  const year = counter.year.toString().slice(-2);
  return `${counter.prefix}${year}${String(counter.seq).padStart(5, '0')}`;
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

    const invoices = await prisma.invoice.findMany({
      where: dateFilter,
      select: {
        id: true,
        documentNo: true,
        amount: true,
        received: true,
        balanceDue: true,
        status: true,
        date: true,
      },
    });

    const metrics = invoices.reduce(
      (acc, inv) => {
        const amount = Number(inv.amount);
        const received = Number(inv.received);
        const balance = Number(inv.balanceDue);

        acc.totalBilled += amount;
        acc.totalReceived += received;
        acc.totalOutstanding += balance;
        acc.count += 1;

        if (inv.status === 'paid') acc.paidCount += 1;
        else if (inv.status === 'pending') acc.pendingCount += 1;
        else if (inv.status === 'overdue') acc.overdueCount += 1;

        return acc;
      },
      {
        totalBilled: 0,
        totalReceived: 0,
        totalOutstanding: 0,
        count: 0,
        paidCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        collectionRate: '0.00',
      },
    );

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
   * Creates an invoice with atomic document number generation.
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

    // Verify store and sales person exist
    const [store, salesPerson] = await Promise.all([
      prisma.store.findUnique({ where: { id: input.storeId } }),
      prisma.salesPerson.findUnique({ where: { id: input.salesPersonId } }),
    ]);

    if (!store) throw new AppError('Store not found', 400);
    if (!salesPerson) throw new AppError('Sales person not found', 400);

    const amountDecimal = parseFloat(String(input.amount || 0));
    const receivedDecimal = parseFloat(String(input.received || 0));
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
      // Generate document number atomically
      const counter = await tx.documentCounter.upsert({
        where: { id: 1 },
        update: { seq: { increment: 1 } },
        create: { id: 1, prefix: 'INV-', seq: 1, year: new Date().getFullYear() },
      });
      const year = counter.year.toString().slice(-2);
      const documentNo = `${counter.prefix}${year}${String(counter.seq).padStart(5, '0')}`;

      // Create the invoice
      const invoice = await tx.invoice.create({
        data: {
          documentNo,
          date: input.date ? new Date(input.date) : new Date(),
          docType: input.docType || 'Invoice',
          description: input.description || null,
          amount: amountDecimal,
          received: receivedDecimal,
          balanceDue,
          status: invoiceStatus as any,
          chequeNo: input.chequeNo || null,
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
            description: `Initial payment for ${documentNo}`,
            paymentMethod: input.chequeNo ? 'cheque' : 'cash',
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

    const updateData: any = {};
    if (input.description !== undefined) updateData.description = input.description;
    if (input.chequeNo !== undefined) updateData.chequeNo = input.chequeNo;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.date !== undefined) updateData.date = new Date(input.date);

    if (Object.keys(updateData).length === 0) {
      throw new AppError(
        'No updatable fields provided. Use payment endpoints for financial adjustments.',
        400,
      );
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: updateData,
      include: {
        store: { select: { id: true, name: true } },
        salesPerson: { select: { id: true, name: true } },
        payments: { orderBy: { date: 'desc' } },
      },
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
      await prisma.invoice.update({
        where: { id },
        data: { status: 'cancelled', balanceDue: 0 },
      });
      return { softDeleted: true };
    }

    // No payments — hard delete
    await prisma.invoice.delete({ where: { id } });
    return { softDeleted: false };
  }
}