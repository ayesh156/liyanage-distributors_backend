import prisma from '../config/prisma.js';

function toMoneyNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return parseFloat(numeric.toFixed(2));
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  const dt = new Date(Date.UTC(year, (month || 1) - 1, 1));
  return dt.toLocaleString('en-US', { month: 'short' });
}

const dashboardController = {
  /**
   * GET /api/dashboard/analytics
   * Server-side analytics using Prisma aggregates/grouping as source of truth.
   */
  async analytics(req, res) {
    try {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

      const [
        outstandingAggregate,
        thisMonthRecoveredAggregate,
        outstandingByStore,
        paymentModeGroups,
        invoiceMonthlyRows,
        paymentMonthlyRows,
      ] = await Promise.all([
        prisma.invoice.aggregate({
          where: { balanceDue: { gt: 0 } },
          _sum: { balanceDue: true },
        }),
        prisma.payment.aggregate({
          where: {
            createdAt: {
              gte: monthStart,
              lt: nextMonthStart,
            },
          },
          _sum: { amountPaid: true },
        }),
        prisma.invoice.groupBy({
          by: ['storeId'],
          where: { balanceDue: { gt: 0 } },
          _sum: { balanceDue: true },
        }),
        prisma.payment.groupBy({
          by: ['paymentMethod'],
          _sum: { amountPaid: true },
        }),
        prisma.$queryRaw`
          SELECT DATE_FORMAT(date, '%Y-%m') AS monthKey, SUM(amount) AS invoiced
          FROM invoices
          GROUP BY DATE_FORMAT(date, '%Y-%m')
          ORDER BY monthKey ASC
        `,
        prisma.$queryRaw`
          SELECT DATE_FORMAT(createdAt, '%Y-%m') AS monthKey, SUM(amountPaid) AS recovered
          FROM payments
          GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
          ORDER BY monthKey ASC
        `,
      ]);

      const shopOutstanding = {};
      outstandingByStore.forEach((bucket) => {
        const total = toMoneyNumber(bucket?._sum?.balanceDue);
        if (total > 0) {
          shopOutstanding[String(bucket.storeId)] = total;
        }
      });

      const monthlyMap = new Map();
      (invoiceMonthlyRows || []).forEach((row) => {
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

      (paymentMonthlyRows || []).forEach((row) => {
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

      const paymentDistribution = { cash: 0, cheque: 0, check: 0, total: 0 };
      paymentModeGroups.forEach((bucket) => {
        const amount = toMoneyNumber(bucket?._sum?.amountPaid);
        if (bucket.paymentMethod === 'cash') paymentDistribution.cash += amount;
        if (bucket.paymentMethod === 'cheque') paymentDistribution.cheque += amount;
        paymentDistribution.total += amount;
      });

      res.json({
        success: true,
        data: {
          grandTotalOutstanding: toMoneyNumber(outstandingAggregate?._sum?.balanceDue),
          thisMonthRecovered: toMoneyNumber(thisMonthRecoveredAggregate?._sum?.amountPaid),
          totalActiveDebtors: Object.keys(shopOutstanding).length,
          shopOutstanding,
          paymentDistribution: {
            cash: toMoneyNumber(paymentDistribution.cash),
            cheque: toMoneyNumber(paymentDistribution.cheque),
            check: toMoneyNumber(paymentDistribution.check),
            total: toMoneyNumber(paymentDistribution.total),
          },
          monthlyBreakdown,
        },
      });
    } catch (error) {
      console.error('Error building dashboard analytics:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default dashboardController;
