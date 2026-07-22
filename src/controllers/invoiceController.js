import prisma from '../config/prisma.js';
import { PaymentMethod } from '@prisma/client';

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function normalizeSelector(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[-_\s]+/g, '_');
}

function hasNonEmptyValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizeOptionalText(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function stripTrailingNoToken(value) {
  const normalized = normalizeOptionalText(value, null);
  if (!normalized) return normalized;
  return normalized.replace(/_no$/i, '').trim();
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? parseFloat(numeric.toFixed(2)) : 0;
}

function isChequeTransaction(payload = {}) {
  const paymentMethod = resolvePaymentMethodValue(payload);
  return paymentMethod === PaymentMethod.cheque || paymentMethod === PaymentMethod.bank_transfer || Boolean(payload.bankSlip);
}

function resolvePaymentMethodValue(payload = {}) {
  const selector = normalizeSelector(payload.paymentSelector || payload.paymentMethod || payload.paymentMode || payload.docType);
  if (Boolean(payload.bankSlip)) {
    return PaymentMethod.bank_transfer;
  }

  switch (selector) {
    case 'BANK_SLIP':
    case 'BANKSLIP':
    case 'BANK_SLIP_PAYMENT':
    case 'BANK_TRANSFER':
      return PaymentMethod.bank_transfer;
    case 'CHEQUE':
    case 'CHECK':
    case 'CHEQUE_PAYMENT':
    case 'CHECK_PAYMENT':
      return PaymentMethod.cheque;
    case 'CASH':
    case 'CASH_PAYMENT':
    default:
      return PaymentMethod.cash;
  }
}

function toMoneyNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return parseFloat(numeric.toFixed(2));
}

function computeBalanceDue(amount, received) {
  const computedBalanceDue = parseFloat((Number(amount) - Number(received)).toFixed(2));
  return Math.max(0, Number.isFinite(computedBalanceDue) ? computedBalanceDue : 0);
}

async function resolveUniqueInvoiceDocumentNo(inputDocumentNo) {
  let candidate = normalizeOptionalText(inputDocumentNo, null) || `INV-${Date.now()}`;

  while (true) {
    const existingInvoice = await prisma.invoice.findUnique({
      where: { documentNo: candidate },
      select: { id: true },
    });

    if (!existingInvoice) return candidate;

    const suffixMatch = candidate.match(/^(.*)_(\d+)$/);
    if (suffixMatch) {
      const baseCode = suffixMatch[1];
      const suffixValue = Number(suffixMatch[2]);
      candidate = `${baseCode}_${suffixValue + 1}`;
    } else {
      candidate = `${candidate}_1`;
    }
  }
}

let storeOutstandingBalanceColumnExists;

async function hasStoreOutstandingBalanceColumn(tx) {
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

async function recomputeStoreOutstandingBalance(tx, storeId) {
  if (!storeId) return 0;

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

async function compileLedgerAggregates(tx) {
  const [invoiceAggregate, statusBuckets, storeBuckets] = await Promise.all([
    tx.invoice.aggregate({
      where: { status: { not: 'cancelled' } },
      _sum: {
        amount: true,
        received: true,
        balanceDue: true,
      },
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

  return {
    totals: {
      totalBilled: toMoneyNumber(invoiceAggregate?._sum?.amount),
      totalReceived: toMoneyNumber(invoiceAggregate?._sum?.received),
      totalOutstanding: toMoneyNumber(invoiceAggregate?._sum?.balanceDue),
      count: invoiceAggregate?._count?._all || 0,
    },
    statusBuckets,
    stores: storeBuckets.map((bucket) => ({
      storeId: bucket.storeId,
      outstanding: toMoneyNumber(bucket?._sum?.balanceDue),
    })),
  };
}

/**
 * Invoice Controller (Core Ledger)
 * Handles all invoice operations with dynamic balance calculations.
 * When an invoice is created, balanceDue is calculated as: amount - received.
 */
const invoiceController = {
  /**
   * GET /api/invoices
   * List all invoices with filtering, search, and pagination.
   */
  async list(req, res) {
    try {
      const {
        search,
        storeId,
        salesPersonId,
        status,
        docType,
        startDate,
        endDate,
        page = 1,
        limit = 50,
      } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {};
      if (search) {
        where.OR = [
          { documentNo: { contains: search } },
          { description: { contains: search } },
          { chequeNo: { contains: search } },
        ];
      }
      if (storeId) where.storeId = storeId;
      if (salesPersonId) where.salesPersonId = salesPersonId;
      if (status) where.status = status;
      if (docType) where.docType = docType;
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(startDate);
        if (endDate) where.date.lte = new Date(endDate);
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          skip,
          take: parseInt(limit),
          orderBy: { date: 'desc' },
          include: {
            store: {
              select: {
                id: true,
                name: true,
                route: {
                  select: { id: true, name: true },
                },
              },
            },
            salesPerson: { select: { id: true, name: true } },
            payments: {
              orderBy: { date: 'desc' },
              select: { id: true, date: true, amountPaid: true, description: true, paymentMethod: true, chequeNo: true, bankName: true, branchName: true },
            },
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      res.json({
        success: true,
        data: invoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error('Error listing invoices:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/invoices/outstanding
   * ═══════════════════════════════════════════════════════════════
   * FULL OUTSTANDING REPORT ENDPOINT
   * ═══════════════════════════════════════════════════════════════
   *
   * Returns all invoice rows with balance calculations, ordered by date ASC.
   * The frontend groups them by store and computes running balances
   * for the per-shop accordion in the Outstanding Report view.
   *
   * Query params:
   *   storeId   - Filter to a single store (optional)
   *   page      - Page number (default 1)
   *   limit     - Items per page (default 5000 for full dataset)
   */
  async outstanding(req, res) {
    try {
      const {
        storeId,
        startDate,
        endDate,
        year,
        month,
        aging,
        page = 1,
        limit = 5000,
      } = req.query;

      const where = {};
      if (storeId) where.storeId = storeId;

      const yearNum = Number(year);
      const monthNum = Number(month);
      const hasYear = Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 9999;
      const hasMonth = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12;

      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(startDate);
        if (endDate) where.date.lte = new Date(endDate);
      } else if (hasYear && hasMonth) {
        where.date = {
          gte: new Date(Date.UTC(yearNum, monthNum - 1, 1)),
          lt: new Date(Date.UTC(yearNum, monthNum, 1)),
        };
      } else if (hasYear) {
        where.date = {
          gte: new Date(Date.UTC(yearNum, 0, 1)),
          lt: new Date(Date.UTC(yearNum + 1, 0, 1)),
        };
      }

      const agingMatch = String(aging || '').trim().toLowerCase().match(/^(\d+)d$/);
      const agingDays = agingMatch ? Number(agingMatch[1]) : null;
      const agingCutoff = agingDays && Number.isFinite(agingDays)
        ? new Date(Date.now() - (agingDays * 24 * 60 * 60 * 1000))
        : null;

      const invoices = await prisma.invoice.findMany({
        where,
        orderBy: [{ storeId: 'asc' }, { date: 'asc' }],
        select: {
          id: true,
          documentNo: true,
          date: true,
          docType: true,
          description: true,
          amount: true,
          received: true,
          balanceDue: true,
          status: true,
          chequeNo: true,
          bankName: true,
          branchName: true,
          storeId: true,
          store: {
            select: {
              id: true,
              name: true,
              phone: true,
              route: {
                select: { id: true, name: true },
              },
            },
          },
          payments: {
            orderBy: { date: 'asc' },
            select: { id: true, date: true, amountPaid: true, description: true, paymentMethod: true, chequeNo: true, bankName: true, branchName: true },
          },
        },
      });

      const filteredInvoices = invoices.filter((invoice) => {
        const computedBalanceDue = computeBalanceDue(invoice.amount, invoice.received);
        if (computedBalanceDue <= 0) return false;
        if (agingCutoff) {
          const postingDate = new Date(invoice.date);
          if (!(postingDate < agingCutoff)) return false;
        }
        return true;
      });

      const total = filteredInvoices.length;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const pagedInvoices = filteredInvoices.slice(skip, skip + parseInt(limit));

      res.json({
        success: true,
        data: pagedInvoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error('Error fetching outstanding report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/invoices/summary
   * Aggregate summary of all invoices for dashboard metrics.
   */
  async summary(req, res) {
    try {
      const { startDate, endDate } = req.query;

      const where = {};
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(startDate);
        if (endDate) where.date.lte = new Date(endDate);
      }

      where.status = { not: 'cancelled' };

      const [aggregate, statusBuckets] = await Promise.all([
        prisma.invoice.aggregate({
          where,
          _sum: {
            amount: true,
            received: true,
            balanceDue: true,
          },
          _count: { _all: true },
        }),
        prisma.invoice.groupBy({
          where,
          by: ['status'],
          _count: { _all: true },
        }),
      ]);

      const metrics = {
        totalBilled: toMoneyNumber(aggregate?._sum?.amount),
        totalReceived: toMoneyNumber(aggregate?._sum?.received),
        totalOutstanding: toMoneyNumber(aggregate?._sum?.balanceDue),
        count: aggregate?._count?._all || 0,
        paidCount: 0,
        pendingCount: 0,
        overdueCount: 0,
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

      res.json({ success: true, data: metrics });
    } catch (error) {
      console.error('Error computing invoice summary:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/invoices/:id
   * Get a single invoice by ID with full relational data.
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const invoice = await prisma.invoice.findUnique({
        where: { id },
        include: {
          store: true,
          salesPerson: true,
          payments: {
            orderBy: { date: 'desc' },
          },
        },
      });

      if (!invoice) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
      }

      res.json({ success: true, data: invoice });
    } catch (error) {
      console.error('Error getting invoice:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/invoices/document/:documentNo
   * Get an invoice by its document number.
   */
  async getByDocumentNo(req, res) {
    try {
      const { documentNo } = req.params;
      const invoice = await prisma.invoice.findUnique({
        where: { documentNo },
        include: {
          store: true,
          salesPerson: true,
          payments: { orderBy: { date: 'desc' } },
        },
      });

      if (!invoice) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
      }

      res.json({ success: true, data: invoice });
    } catch (error) {
      console.error('Error getting invoice by document no:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/invoices
   * Create a new invoice with dynamic balance calculations.
   * balanceDue = amount - received (calculated server-side).
   */
  async create(req, res) {
    try {
      const {
        storeId,
        salesPersonId,
        date,
        docType = 'Invoice',
        paymentMode,
        paymentMethod,
        description,
        amount,
        documentNo,
        docNo,
        received = 0,
        chequeNo,
        bankName,
        branchName,
        status,
      } = req.body;

      // Validation
      if (!storeId) {
        return res.status(400).json({ success: false, error: 'storeId is required' });
      }
      if (!salesPersonId) {
        return res.status(400).json({ success: false, error: 'salesPersonId is required' });
      }

      const normalizedDocumentNo = stripTrailingNoToken(documentNo ?? docNo) || `INV-${Date.now()}`;
      const safeDocumentNo = await resolveUniqueInvoiceDocumentNo(normalizedDocumentNo);
      const safeDescription = stripTrailingNoToken(description);

      // Verify store and sales person exist
      const [store, salesPerson] = await Promise.all([
        prisma.store.findUnique({ where: { id: storeId } }),
        prisma.salesPerson.findUnique({ where: { id: salesPersonId } }),
      ]);

      if (!store) {
        return res.status(400).json({ success: false, error: 'Store not found' });
      }
      if (!salesPerson) {
        return res.status(400).json({ success: false, error: 'Sales person not found' });
      }

      const amountDecimal = normalizeOptionalNumber(amount);
      const receivedDecimal = normalizeOptionalNumber(received);
      const balanceDue = computeBalanceDue(amountDecimal, receivedDecimal);
      const resolvedPaymentMethod = resolvePaymentMethodValue({ paymentMode, paymentMethod });
      const isBankBasedMethod = resolvedPaymentMethod === PaymentMethod.cheque || resolvedPaymentMethod === PaymentMethod.bank_transfer;
      const normalizedChequeNo = normalizeOptionalText(chequeNo);
      const normalizedBankName = normalizeOptionalText(bankName);
      const normalizedBranchName = normalizeOptionalText(branchName);

      // Determine status based on payment
      let invoiceStatus = status;
      if (!invoiceStatus) {
        if (balanceDue <= 0) invoiceStatus = 'paid';
        else if (receivedDecimal > 0) invoiceStatus = 'pending';
        else invoiceStatus = 'pending';
      }

      const invoice = await prisma.invoice.create({
        data: {
          documentNo: safeDocumentNo,
          date: date ? new Date(date) : new Date(),
          docType,
          description: safeDescription,
          amount: amountDecimal,
          received: receivedDecimal,
          balanceDue,
          status: invoiceStatus,
          chequeNo: isBankBasedMethod ? normalizedChequeNo : null,
          bankName: isBankBasedMethod ? normalizedBankName : null,
          branchName: isBankBasedMethod ? normalizedBranchName : null,
          storeId,
          salesPersonId,
        },
        include: {
          store: { select: { id: true, name: true } },
          salesPerson: { select: { id: true, name: true } },
        },
      });

      // If there's an initial payment, record it automatically
      if (receivedDecimal > 0) {
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            date: invoice.date,
            amountPaid: receivedDecimal,
            description: safeDescription,
            paymentMethod: resolvedPaymentMethod,
            chequeNo: isBankBasedMethod ? normalizedChequeNo : null,
            bankName: isBankBasedMethod ? normalizedBankName : null,
            branchName: isBankBasedMethod ? normalizedBranchName : null,
          },
        });
      }

      res.status(201).json({ success: true, data: invoice });
    } catch (error) {
      console.error('Error creating invoice:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * PUT /api/invoices/:id
   * Update invoice fields. For sensitive financial fields (amount, received),
   * updates are propagated through payment collection instead.
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const {
        description,
        chequeNo,
        bankName,
        branchName,
        status,
        date,
        amount,
        received,
        docType,
        paymentMode,
        paymentMethod,
        paymentSelector,
        bankSlip,
        receivedAmount,
        amountPaid,
        paymentAmount,
        paymentDescription,
        documentNo,
        docNo,
      } = req.body;

      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
      }

      // ── INVOICE EDIT OVERPAYMENT GUARD: Prevent received > amount ──────────
      if (received !== undefined && amount !== undefined && Number(received) > Number(amount)) {
        return res.status(400).json({
          success: false,
          message: "Received payment cannot be greater than total invoice amount.",
        });
      }
      if (received !== undefined && amount === undefined && Number(received) > Number(existing.amount)) {
        return res.status(400).json({
          success: false,
          message: "Received payment cannot be greater than total invoice amount.",
        });
      }

      const updateData = {};
      if (description !== undefined) updateData.description = stripTrailingNoToken(description);
      if (status !== undefined) updateData.status = status;
      if (docType !== undefined) updateData.docType = docType;
      if (documentNo !== undefined) updateData.documentNo = stripTrailingNoToken(documentNo);
      if (docNo !== undefined) updateData.documentNo = stripTrailingNoToken(docNo);
      if (date !== undefined) updateData.date = new Date(date);

      const existingReceived = toMoneyNumber(existing.received);
      const amountProvided = amount !== undefined;
      const receivedProvided = received !== undefined;
      const receivedAmountProvided = hasNonEmptyValue(receivedAmount);
      const amountPaidProvided = hasNonEmptyValue(amountPaid);
      const paymentAmountProvided = hasNonEmptyValue(paymentAmount);
      const amountDecimal = amountProvided ? toMoneyNumber(amount) : toMoneyNumber(existing.amount);
      const explicitPaymentAmount = receivedAmountProvided
        ? toMoneyNumber(receivedAmount)
        : amountPaidProvided
          ? toMoneyNumber(amountPaid)
          : paymentAmountProvided
            ? toMoneyNumber(paymentAmount)
            : 0;

      let receivedDecimal = receivedProvided ? toMoneyNumber(received) : existingReceived;
      if (!receivedProvided && explicitPaymentAmount > 0) {
        receivedDecimal = toMoneyNumber(existingReceived + explicitPaymentAmount);
        updateData.received = receivedDecimal;
      }

      if (amountProvided) updateData.amount = amountDecimal;
      if (receivedProvided) updateData.received = receivedDecimal;
      if (amountProvided || receivedProvided || explicitPaymentAmount > 0) {
        updateData.balanceDue = computeBalanceDue(amountDecimal, receivedDecimal);
      }

      const normalizedChequeNo = normalizeText(chequeNo);
      const normalizedBankName = normalizeText(bankName);
      const normalizedBranchName = normalizeText(branchName);
      const explicitPaymentMethod = resolvePaymentMethodValue({
        paymentMode,
        paymentMethod,
        paymentSelector,
        bankSlip,
      });
      const isBankBasedMethod = explicitPaymentMethod === PaymentMethod.cheque || explicitPaymentMethod === PaymentMethod.bank_transfer;

      if (chequeNo !== undefined || bankName !== undefined || branchName !== undefined || paymentMode !== undefined || paymentMethod !== undefined) {
        updateData.chequeNo = normalizedChequeNo;
        updateData.bankName = normalizedBankName;
        updateData.branchName = normalizedBranchName;
      }

      if (status === undefined && (amountProvided || receivedProvided)) {
        if (updateData.balanceDue <= 0) updateData.status = 'paid';
        else if (receivedDecimal > 0) updateData.status = 'pending';
        else updateData.status = existing.status;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No updatable fields provided.',
        });
      }

      const receivedDelta = toMoneyNumber(receivedDecimal - existingReceived);
      const paymentAmountToCreate = receivedDelta > 0
        ? receivedDelta
        : explicitPaymentAmount > 0
          ? explicitPaymentAmount
          : 0;
      const paymentMetadataProvided = hasNonEmptyValue(paymentMethod)
        || hasNonEmptyValue(paymentMode)
        || hasNonEmptyValue(paymentSelector)
        || hasNonEmptyValue(bankSlip)
        || hasNonEmptyValue(chequeNo)
        || hasNonEmptyValue(bankName)
        || hasNonEmptyValue(branchName);
      const shouldCreatePayment = paymentAmountToCreate > 0 && (receivedDelta > 0 || paymentMetadataProvided || explicitPaymentAmount > 0);
      const paymentMethodValue = resolvePaymentMethodValue({
        paymentMethod,
        paymentMode,
        paymentSelector,
        bankSlip,
        docType,
      });
      const paymentIsBankBased = paymentMethodValue === PaymentMethod.cheque || paymentMethodValue === PaymentMethod.bank_transfer;

      const mutationResult = await prisma.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id },
          data: updateData,
        });

        if (shouldCreatePayment) {
          await tx.payment.create({
            data: {
              invoiceId: id,
              date: date ? new Date(date) : new Date(),
              amountPaid: paymentAmountToCreate,
              description: normalizeOptionalText(paymentDescription),
              paymentMethod: paymentMethodValue,
              chequeNo: paymentIsBankBased ? normalizedChequeNo : null,
              bankName: paymentIsBankBased ? normalizedBankName : null,
              branchName: paymentIsBankBased ? normalizedBranchName : null,
            },
          });
        }

        const invoice = await tx.invoice.findUnique({
          where: { id },
          include: {
            store: { select: { id: true, name: true } },
            salesPerson: { select: { id: true, name: true } },
            payments: {
              orderBy: { date: 'desc' },
              select: { id: true, date: true, amountPaid: true, description: true, paymentMethod: true, chequeNo: true, bankName: true, branchName: true },
            },
          },
        });

        await recomputeStoreOutstandingBalance(tx, existing.storeId);
        await compileLedgerAggregates(tx);

        return invoice;
      });

      res.json({ success: true, data: mutationResult });
    } catch (error) {
      console.error('Error updating invoice:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * DELETE /api/invoices/:id
   * Soft-delete or hard-delete an invoice.
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      const deletionResult = await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id },
          select: { id: true, storeId: true },
        });

        if (!invoice) {
          return null;
        }

        await tx.invoice.delete({ where: { id } });
        const remainingPayments = await tx.payment.count({ where: { invoiceId: id } });
        const invoiceStillExists = await tx.invoice.findUnique({ where: { id }, select: { id: true } });

        await recomputeStoreOutstandingBalance(tx, invoice.storeId);
        await compileLedgerAggregates(tx);

        return { remainingPayments, invoiceStillExists };
      });

      if (!deletionResult) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
      }

      if (deletionResult.remainingPayments !== 0 || deletionResult.invoiceStillExists) {
        throw new Error('Database confirmation failed after invoice deletion');
      }

      res.json({ success: true, message: 'Invoice deleted permanently.' });
    } catch (error) {
      console.error('Error deleting invoice:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default invoiceController;