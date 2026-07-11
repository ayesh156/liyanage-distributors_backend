import prisma from '../config/prisma.js';

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function normalizeSelector(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isChequeTransaction(payload = {}) {
  const selector = normalizeSelector(payload.paymentMethod || payload.paymentMode || payload.docType);
  return selector === 'CHEQUE' || Boolean(normalizeText(payload.chequeNo) || normalizeText(payload.bankName) || normalizeText(payload.branchName));
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

async function generateDocumentNo() {
  const counter = await prisma.documentCounter.upsert({
    where: { id: 1 },
    update: { seq: { increment: 1 } },
    create: { id: 1, prefix: 'INV-', seq: 1, year: new Date().getFullYear() },
  });
  const year = counter.year.toString().slice(-2);
  return `${counter.prefix}${year}${String(counter.seq).padStart(5, '0')}`;
}

/**
 * Invoice Controller (Core Ledger)
 * Handles all invoice operations with dynamic balance calculations.
 * When an invoice is created, balanceDue is calculated as: amount - received.
 */
const invoiceController = {
  /**
   * Generate the next sequential document number.
   * Uses an atomic database transaction to ensure no duplicates.
   */
  async generateDocumentNo() {
    return generateDocumentNo();
  },

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
              select: { id: true, date: true, amountPaid: true, paymentMethod: true, chequeNo: true, bankName: true, branchName: true },
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
        page = 1,
        limit = 5000,
      } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {
        balanceDue: { gt: 0 },
      };
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

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          skip,
          take: parseInt(limit),
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
              select: { id: true, date: true, amountPaid: true, paymentMethod: true, chequeNo: true, bankName: true, branchName: true },
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

      const [aggregate, count, statusBuckets] = await Promise.all([
        prisma.invoice.aggregate({
          where,
          _sum: {
            amount: true,
            received: true,
            balanceDue: true,
          },
        }),
        prisma.invoice.count({ where }),
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
        count,
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

      const amountDecimal = toMoneyNumber(amount);
      const receivedDecimal = toMoneyNumber(received);
      const balanceDue = computeBalanceDue(amountDecimal, receivedDecimal);
      const chequeTransaction = isChequeTransaction({ paymentMode, paymentMethod, chequeNo, bankName, branchName });
      const normalizedChequeNo = normalizeText(chequeNo);
      const normalizedBankName = normalizeText(bankName);
      const normalizedBranchName = normalizeText(branchName);

      // Determine status based on payment
      let invoiceStatus = status;
      if (!invoiceStatus) {
        if (balanceDue <= 0) invoiceStatus = 'paid';
        else if (receivedDecimal > 0) invoiceStatus = 'pending';
        else invoiceStatus = 'pending';
      }

      // Generate document number atomically
      const documentNo = await generateDocumentNo();

      const invoice = await prisma.invoice.create({
        data: {
          documentNo,
          date: date ? new Date(date) : new Date(),
          docType,
          description,
          amount: amountDecimal,
          received: receivedDecimal,
          balanceDue,
          status: invoiceStatus,
          chequeNo: chequeTransaction ? normalizedChequeNo : null,
          bankName: chequeTransaction ? normalizedBankName : null,
          branchName: chequeTransaction ? normalizedBranchName : null,
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
            description: `Initial payment for ${documentNo}`,
            paymentMethod: chequeTransaction ? 'cheque' : 'cash',
            chequeNo: chequeTransaction ? normalizedChequeNo : null,
            bankName: chequeTransaction ? normalizedBankName : null,
            branchName: chequeTransaction ? normalizedBranchName : null,
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
        documentNo,
        docNo,
      } = req.body;

      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
      }

      const updateData = {};
      if (description !== undefined) updateData.description = description;
      if (status !== undefined) updateData.status = status;
      if (docType !== undefined) updateData.docType = docType;
      if (documentNo !== undefined) updateData.documentNo = String(documentNo).trim();
      if (docNo !== undefined) updateData.documentNo = String(docNo).trim();
      if (date !== undefined) updateData.date = new Date(date);

      const amountProvided = amount !== undefined;
      const receivedProvided = received !== undefined;
      const amountDecimal = amountProvided ? toMoneyNumber(amount) : toMoneyNumber(existing.amount);
      const receivedDecimal = receivedProvided ? toMoneyNumber(received) : toMoneyNumber(existing.received);

      if (amountProvided) updateData.amount = amountDecimal;
      if (receivedProvided) updateData.received = receivedDecimal;
      if (amountProvided || receivedProvided) {
        updateData.balanceDue = computeBalanceDue(amountDecimal, receivedDecimal);
      }

      const normalizedChequeNo = normalizeText(chequeNo);
      const normalizedBankName = normalizeText(bankName);
      const normalizedBranchName = normalizeText(branchName);
      const chequeTransaction = isChequeTransaction({
        paymentMode,
        paymentMethod,
        chequeNo,
        bankName,
        branchName,
      });

      if (chequeNo !== undefined || bankName !== undefined || branchName !== undefined || paymentMode !== undefined || paymentMethod !== undefined) {
        updateData.chequeNo = chequeTransaction ? normalizedChequeNo : null;
        updateData.bankName = chequeTransaction ? normalizedBankName : null;
        updateData.branchName = chequeTransaction ? normalizedBranchName : null;
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

      const invoice = await prisma.invoice.update({
        where: { id },
        data: updateData,
        include: {
          store: { select: { id: true, name: true } },
          salesPerson: { select: { id: true, name: true } },
        },
      });

      res.json({ success: true, data: invoice });
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

      const invoice = await prisma.invoice.findUnique({
        where: { id },
        include: { _count: { select: { payments: true } } },
      });

      if (!invoice) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
      }

      // If payments exist, soft-delete by cancelling
      if (invoice._count.payments > 0) {
        const cancelled = await prisma.invoice.update({
          where: { id },
          data: { status: 'cancelled', balanceDue: 0 },
        });
        return res.json({
          success: true,
          message: 'Invoice cancelled (soft-delete) due to existing payments.',
          data: cancelled,
        });
      }

      // No payments - hard delete
      await prisma.invoice.delete({ where: { id } });
      res.json({ success: true, message: 'Invoice deleted permanently.' });
    } catch (error) {
      console.error('Error deleting invoice:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default invoiceController;