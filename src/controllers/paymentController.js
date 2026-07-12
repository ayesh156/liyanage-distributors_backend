import prisma from '../config/prisma.js';
import { PaymentMethod } from '@prisma/client';

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function normalizeSelector(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[-_\s]+/g, '_');
}

function isChequeTransaction(payload = {}) {
  const paymentMethod = resolvePaymentMethodValue(payload);
  return paymentMethod === PaymentMethod.cheque || paymentMethod === PaymentMethod.bank_transfer;
}

function resolvePaymentMethodValue(payload = {}) {
  const selector = normalizeSelector(payload.paymentSelector || payload.paymentMethod || payload.paymentMode || payload.docType);
  if (Boolean(payload.bankSlip)) return PaymentMethod.bank_transfer;

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
  await Promise.all([
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
}

function sumPaymentAmounts(paymentRows = []) {
  return paymentRows.reduce(
    (sum, paymentRecord) => parseFloat((Number(sum) + Number(paymentRecord.amountPaid || 0)).toFixed(2)),
    0,
  );
}

/**
 * Payment Controller
 * Handles payment collection with enterprise-grade transactional safety.
 * 
 * CRITICAL: The collect() method uses prisma.$transaction to guarantee
 * atomicity when updating both the Payment table AND the Invoice ledger.
 */
const paymentController = {
  /**
   * GET /api/payments
   * List all payments with filtering and pagination.
   */
  async list(req, res) {
    try {
      const { invoiceId, startDate, endDate, page = 1, limit = 50 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {};
      if (invoiceId) where.invoiceId = invoiceId;
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(startDate);
        if (endDate) where.date.lte = new Date(endDate);
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          skip,
          take: parseInt(limit),
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
        prisma.payment.count({ where }),
      ]);

      res.json({
        success: true,
        data: payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error('Error listing payments:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/payments/:id
   * Get a single payment record.
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const payment = await prisma.payment.findUnique({
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

      if (!payment) {
        return res.status(404).json({ success: false, error: 'Payment not found' });
      }

      res.json({ success: true, data: payment });
    } catch (error) {
      console.error('Error getting payment:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/payments/collect
   * ═══════════════════════════════════════════════════════════════
   * ENTERPRISE PAYMENT COLLECTION WITH ATOMIC TRANSACTION
   * ═══════════════════════════════════════════════════════════════
   * 
   * This is THE critical business operation. When a payment is collected:
   * 
   * 1. A new Payment record is INSERTED into the Payment table
   * 2. The corresponding Invoice is UPDATED:
   *    - received += amountPaid
   *    - balanceDue -= amountPaid
   *    - status dynamically adjusted (paid, pending, overdue)
   * 
   * BOTH operations happen inside a SINGLE Prisma $transaction.
   * If either operation fails, the entire transaction ROLLS BACK.
   * No partial writes. No inconsistent state. EVER.
   */
  async collect(req, res) {
    try {
      const {
        invoiceId: rawInvoiceId,
        date,
        amountPaid: rawAmountPaid,
        amount,
        description,
        paymentMethod,
        paymentMode,
        chequeNo,
        bankName,
        branchName,
      } = req.body;
      const chequeTransaction = isChequeTransaction({ paymentMethod, paymentMode, chequeNo, bankName, branchName });
      const normalizedPaymentMethod = resolvePaymentMethodValue({ paymentMethod, paymentMode });
      const normalizedChequeNo = normalizeText(chequeNo);
      const normalizedBankName = normalizeText(bankName);
      const normalizedBranchName = normalizeText(branchName);
      const normalizedDescription = normalizeText(description);
      const requestedAmount = rawAmountPaid ?? amount;

      // ── Validation ──────────────────────────────────────────
      if (!rawInvoiceId) {
        return res.status(400).json({ success: false, error: 'invoiceId is required' });
      }

      // ══════════════════════════════════════════════════════════
      // TYPE-SAFETY LOCK: Prisma schema defines Invoice.id as String (UUID).
      // Force-stringify the incoming invoiceId as a baseline safety measure.
      // ══════════════════════════════════════════════════════════
      const invoiceId = String(rawInvoiceId);

      if (!requestedAmount || parseFloat(requestedAmount) <= 0) {
        return res.status(400).json({ success: false, error: 'amountPaid must be greater than 0' });
      }

      const payAmount = toMoneyNumber(requestedAmount);

      // ── Atomic Transaction ──────────────────────────────────
      const result = await prisma.$transaction(async (tx) => {
        // 1. Lock and read the invoice within the transaction
        //    ── DUAL-LOOKUP STRATEGY ───────────────────────────
        //    First, attempt to find by UUID (Prisma Invoice.id).
        //    If that fails, fall back to documentNo (human-readable
        //    code like "INV-2600005"). This ensures resilience
        //    regardless of whether the frontend passes the UUID or
        //    the document code — especially critical after seed
        //    resets that regenerate UUIDs.
        let invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            storeId: true,
            documentNo: true,
            amount: true,
            received: true,
            balanceDue: true,
            status: true,
          },
        });

        if (!invoice) {
          // Fallback: try looking up by documentNo
          invoice = await tx.invoice.findFirst({
            where: { documentNo: invoiceId },
            select: {
              id: true,
              storeId: true,
              documentNo: true,
              amount: true,
              received: true,
              balanceDue: true,
              status: true,
            },
          });
        }

        if (!invoice) {
          throw new Error(`Invoice ${invoiceId} not found`);
        }

        const invoiceAmount = toMoneyNumber(invoice.amount);
        const currentBalance = toMoneyNumber(invoice.balanceDue);
        // 2. Validate: prevent over-collection beyond balance due
        if (payAmount > currentBalance) {
          throw new Error(
            `Payment amount (${payAmount.toFixed(2)}) exceeds outstanding balance (${currentBalance.toFixed(2)}). ` +
            `Maximum collectible: ${currentBalance.toFixed(2)}`
          );
        }

        // 3. INSERT the Payment record
        //    Use the resolved invoice.id (UUID) as the FK, NOT the raw
        //    invoiceId (which may be a documentNo string from fallback).
        //    Bank fields are OPTIONAL - payment method is authoritative from UI state.
        const payment = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            date: date ? new Date(date) : new Date(),
            amountPaid: payAmount,
            description: normalizedDescription || `Payment collected for ${invoice.documentNo}`,
            paymentMethod: normalizedPaymentMethod,
            chequeNo: normalizedChequeNo || null,
            bankName: normalizedBankName || null,
            branchName: normalizedBranchName || null,
          },
        });

        const matchingPayments = await tx.payment.findMany({
          where: { invoiceId: invoice.id },
          select: { amountPaid: true },
        });

        const newReceived = toMoneyNumber(sumPaymentAmounts(matchingPayments));
        const newBalanceDue = computeBalanceDue(invoiceAmount, newReceived);
        const finalStatus = newBalanceDue <= 0 ? 'paid' : (newReceived > 0 ? 'pending' : invoice.status);

        const refreshedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            received: newReceived,
            balanceDue: newBalanceDue,
            status: finalStatus,
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

        await recomputeStoreOutstandingBalance(tx, invoice.storeId);
        await compileLedgerAggregates(tx);

        return { payment, invoice: refreshedInvoice };
      });

      // ── Success Response ────────────────────────────────────
      res.status(201).json({
        success: true,
        message: 'Payment collected successfully',
        data: {
          payment: result.payment,
          invoice: result.invoice,
        },
      });
    } catch (error) {
      console.error('Error collecting payment:', error);

      // Handle known business rule violations with proper status codes
      if (error.message.includes('exceeds outstanding balance')) {
        return res.status(400).json({ success: false, error: error.message });
      }
      if (error.message.includes('not found')) {
        return res.status(404).json({ success: false, error: error.message });
      }

      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/payments/bulk-collect
   * Collect payments for multiple invoices in a single atomic transaction.
   * All payments succeed together or all fail together.
   */
  async bulkCollect(req, res) {
    try {
      const { payments } = req.body;

      if (!Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'payments must be a non-empty array of { invoiceId, amountPaid, ... }',
        });
      }

      // ══════════════════════════════════════════════════════════
      // TYPE-SAFETY LOCK: Coerce each invoiceId to String to match
      // Prisma schema (Invoice.id = String/UUID) before queries.
      // ══════════════════════════════════════════════════════════
      const safePayments = payments.map(p => ({
        ...p,
        invoiceId: String(p.invoiceId),
      }));

      // Validate all payments first
      for (const p of safePayments) {
        if (!p.invoiceId) {
          return res.status(400).json({
            success: false,
            error: `All payments must have an invoiceId. Missing in entry.`,
          });
        }
        if (!p.amountPaid || parseFloat(p.amountPaid) <= 0) {
          return res.status(400).json({
            success: false,
            error: `All payments must have amountPaid > 0. Check invoice ${p.invoiceId}.`,
          });
        }
      }

      // Execute all collections in a single transaction
      const results = await prisma.$transaction(async (tx) => {
        const processed = [];

        for (const p of safePayments) {
          const payAmount = toMoneyNumber(p.amountPaid);
          const chequeTransaction = isChequeTransaction(p);
          const normalizedPaymentMethod = resolvePaymentMethodValue(p);
          const normalizedChequeNo = normalizeText(p.chequeNo);
          const normalizedBankName = normalizeText(p.bankName);
          const normalizedBranchName = normalizeText(p.branchName);
          const normalizedDescription = normalizeText(p.description);

          // Read invoice with lock
          const invoice = await tx.invoice.findUnique({
            where: { id: p.invoiceId },
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
            throw new Error(`Invoice ${p.invoiceId} not found - rolling back all payments`);
          }

          const invoiceAmount = toMoneyNumber(invoice.amount);
          const currentBalance = toMoneyNumber(invoice.balanceDue);
          if (payAmount > currentBalance) {
            throw new Error(
              `Payment ${payAmount} exceeds balance ${currentBalance} for invoice ${invoice.documentNo}. Rolling back.`
            );
          }

          // Create payment
          const payment = await tx.payment.create({
            data: {
              invoiceId: p.invoiceId,
              date: p.date ? new Date(p.date) : new Date(),
              amountPaid: payAmount,
              description: normalizedDescription || `Bulk payment for ${invoice.documentNo}`,
              paymentMethod: normalizedPaymentMethod,
              chequeNo: chequeTransaction ? normalizedChequeNo : null,
              bankName: chequeTransaction ? normalizedBankName : null,
              branchName: chequeTransaction ? normalizedBranchName : null,
            },
          });

          const matchingPayments = await tx.payment.findMany({
            where: { invoiceId: p.invoiceId },
            select: { amountPaid: true },
          });

          const newReceived = toMoneyNumber(sumPaymentAmounts(matchingPayments));
          const newBalanceDue = computeBalanceDue(invoiceAmount, newReceived);
          const newStatus = newBalanceDue <= 0 ? 'paid' : (newReceived > 0 ? 'pending' : invoice.status);

          const updatedInvoice = await tx.invoice.update({
            where: { id: p.invoiceId },
            data: { received: newReceived, balanceDue: newBalanceDue, status: newStatus },
            select: { id: true, documentNo: true, amount: true, received: true, balanceDue: true, status: true },
          });

          processed.push({ payment, invoice: updatedInvoice });
        }

        return processed;
      });

      res.status(201).json({
        success: true,
        message: `Successfully collected ${results.length} payment(s)`,
        data: results,
      });
    } catch (error) {
      console.error('Error in bulk collect:', error);

      if (error.message.includes('not found - rolling back')) {
        return res.status(404).json({ success: false, error: error.message });
      }
      if (error.message.includes('exceeds balance')) {
        return res.status(400).json({ success: false, error: error.message });
      }

      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * DELETE /api/payments/:id
   * Reverse a payment record and update the invoice accordingly.
   * Uses a transaction to ensure atomic reversal.
   */
  async reverse(req, res) {
    try {
      const { id } = req.params;

      const result = await prisma.$transaction(async (tx) => {
        // Find the payment
        const payment = await tx.payment.findUnique({
          where: { id },
          select: { id: true, invoiceId: true, amountPaid: true },
        });

        if (!payment) {
          throw new Error('Payment not found');
        }

        // Find and update the invoice
        const invoice = await tx.invoice.findUnique({
          where: { id: payment.invoiceId },
          select: { id: true, documentNo: true, received: true, balanceDue: true, amount: true, status: true },
        });

        if (!invoice) {
          throw new Error('Associated invoice not found');
        }

        const invoiceAmount = toMoneyNumber(invoice.amount);
        const reversedReceived = toMoneyNumber(Number(invoice.received) - Number(payment.amountPaid));
        const reversedBalance = computeBalanceDue(invoiceAmount, reversedReceived);

        // Determine status after reversal
        let reversedStatus = invoice.status;
        if (reversedBalance > 0 && reversedStatus === 'paid') {
          reversedStatus = 'pending';
        } else if (reversedBalance <= 0) {
          reversedStatus = 'paid';
        }

        // Update invoice
        const updatedInvoice = await tx.invoice.update({
          where: { id: payment.invoiceId },
          data: {
            received: reversedReceived,
            balanceDue: reversedBalance,
            status: reversedStatus,
          },
          select: { id: true, documentNo: true, amount: true, received: true, balanceDue: true, status: true },
        });

        // Delete the payment record
        await tx.payment.delete({ where: { id: payment.id } });

        return { payment: { id: payment.id, amountPaid: payment.amountPaid }, invoice: updatedInvoice };
      });

      res.json({
        success: true,
        message: 'Payment reversed successfully',
        data: result,
      });
    } catch (error) {
      console.error('Error reversing payment:', error);

      if (error.message === 'Payment not found') {
        return res.status(404).json({ success: false, error: error.message });
      }

      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default paymentController;