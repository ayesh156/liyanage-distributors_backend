import type { Request, Response } from 'express';
import prisma from '../lib/prisma.ts';

interface MonthlyInvoiceRow {
  monthKey: string | null;
  invoiced: unknown;
}

interface MonthlyPaymentRow {
  monthKey: string | null;
  recovered: unknown;
}

interface MonthlyBreakdownRow {
  key: string;
  month: string;
  invoiced: number;
  recovered: number;
  outstanding: number;
}

interface ShopOutstanding {
  [storeId: string]: number;
}

function toMoneyNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return parseFloat(numeric.toFixed(2));
}

function monthLabel(monthKey: unknown): string {
  const [year, month] = String(monthKey).split('-').map(Number);
  const dt = new Date(Date.UTC(year, (month || 1) - 1, 1));

  return dt.toLocaleString('en-US', { month: 'short' });
}

const dashboardController = {
  /**
   * GET /api/dashboard/analytics
   * Server-side analytics using Prisma aggregates/grouping as source of truth.
   */
  async analytics(_req: Request, res: Response): Promise<void> {
    try {
      const now = new Date();

      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );

      const nextMonthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      );

      const [
        invoiceBucketsByStore,
        thisMonthRecoveredAggregate,
        paymentModeGroups,
        invoiceMonthlyRowsRaw,
        paymentMonthlyRowsRaw,
      ] = await Promise.all([
        prisma.invoice.groupBy({
          by: ['storeId'],
          where: {
            status: { not: 'cancelled' },
            balanceDue: { gt: 0 },
          },
          _sum: { balanceDue: true },
        }),

        prisma.payment.aggregate({
          where: {
            date: {
              gte: monthStart,
              lt: nextMonthStart,
            },
          },
          _sum: { amountPaid: true },
        }),

        prisma.payment.groupBy({
          by: ['paymentMethod'],
          _sum: { amountPaid: true },
        }),

        prisma.$queryRaw<MonthlyInvoiceRow[]>`
          SELECT DATE_FORMAT(date, '%Y-%m') AS monthKey, SUM(amount) AS invoiced
          FROM invoices
          GROUP BY DATE_FORMAT(date, '%Y-%m')
          ORDER BY monthKey ASC
        `,

        prisma.$queryRaw<MonthlyPaymentRow[]>`
          SELECT DATE_FORMAT(date, '%Y-%m') AS monthKey, SUM(amountPaid) AS recovered
          FROM payments
          GROUP BY DATE_FORMAT(date, '%Y-%m')
          ORDER BY monthKey ASC
        `,
      ]);

      const invoiceMonthlyRows = invoiceMonthlyRowsRaw || [];
      const paymentMonthlyRows = paymentMonthlyRowsRaw || [];

      const shopOutstanding: ShopOutstanding = {};
      let grandTotalOutstanding = 0;

      invoiceBucketsByStore.forEach((bucket) => {
        const balanceDue = toMoneyNumber(bucket._sum.balanceDue);

        if (balanceDue <= 0) return;

        const storeKey = String(bucket.storeId);

        shopOutstanding[storeKey] = toMoneyNumber(
          (shopOutstanding[storeKey] || 0) + balanceDue,
        );

        grandTotalOutstanding = toMoneyNumber(
          grandTotalOutstanding + balanceDue,
        );
      });

      const monthlyMap = new Map<string, MonthlyBreakdownRow>();

      invoiceMonthlyRows.forEach((row) => {
        const key = String(row.monthKey || '');

        if (!key) return;

        monthlyMap.set(key, {
          key,
          month: monthLabel(key),
          invoiced: toMoneyNumber(row.invoiced),
          recovered: 0,
          outstanding: 0,
        });
      });

      paymentMonthlyRows.forEach((row) => {
        const key = String(row.monthKey || '');

        if (!key) return;

        const existing = monthlyMap.get(key) || {
          key,
          month: monthLabel(key),
          invoiced: 0,
          recovered: 0,
          outstanding: 0,
        };

        existing.recovered = toMoneyNumber(row.recovered);
        monthlyMap.set(key, existing);
      });

      const monthlyBreakdown = Array.from(monthlyMap.values())
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((row) => ({
          month: row.month,
          invoiced: row.invoiced,
          recovered: row.recovered,
          outstanding: toMoneyNumber(row.invoiced - row.recovered),
        }))
        .slice(-12);

      const paymentDistribution = {
        cash: 0,
        cheque: 0,
        check: 0,
        bankSlip: 0,
        total: 0,
      };

      paymentModeGroups.forEach((bucket) => {
        const amount = toMoneyNumber(bucket._sum.amountPaid);

        if (bucket.paymentMethod === 'cash') {
          paymentDistribution.cash += amount;
        }

        if (bucket.paymentMethod === 'cheque') {
          paymentDistribution.cheque += amount;
        }

        // Unified mapper: bank_transfer (canonical) + bank_slip (legacy) -> bankSlip display.
        if (
          bucket.paymentMethod === 'bank_slip' ||
          bucket.paymentMethod === 'bank_transfer'
        ) {
          paymentDistribution.bankSlip += amount;
        }

        paymentDistribution.total += amount;
      });

      res.json({
        success: true,
        data: {
          grandTotalOutstanding: toMoneyNumber(grandTotalOutstanding),
          thisMonthRecovered: toMoneyNumber(
            thisMonthRecoveredAggregate._sum.amountPaid,
          ),
          totalActiveDebtors: Object.keys(shopOutstanding).length,
          shopOutstanding,
          paymentDistribution: {
            cash: toMoneyNumber(paymentDistribution.cash),
            cheque: toMoneyNumber(paymentDistribution.cheque),
            check: toMoneyNumber(paymentDistribution.check),
            bankSlip: toMoneyNumber(paymentDistribution.bankSlip),
            total: toMoneyNumber(paymentDistribution.total),
          },
          monthlyBreakdown,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      console.error('Error building dashboard analytics:', error);

      res.status(500).json({
        success: false,
        error: message,
      });
    }
  },
};

export default dashboardController;
