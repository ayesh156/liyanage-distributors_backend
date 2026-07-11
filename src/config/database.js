import prisma from './prisma.js';

/**
 * Database initialization and health check utility.
 * Tests the database connection on startup.
 */
export async function testConnection() {
  try {
    await prisma.$connect();
    console.log('✅ Database connection established successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

/**
 * Gracefully disconnect from the database.
 */
export async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log('Database connection closed.');
}

/**
 * Check database health and return status metrics.
 */
export async function getDatabaseHealth() {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    const [storeCount, invoiceCount, paymentCount, salesPersonCount] = await Promise.all([
      prisma.store.count(),
      prisma.invoice.count(),
      prisma.payment.count(),
      prisma.salesPerson.count(),
    ]);

    return {
      status: 'healthy',
      latency: `${latency}ms`,
      collections: {
        stores: storeCount,
        salesPersons: salesPersonCount,
        invoices: invoiceCount,
        payments: paymentCount,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
    };
  }
}

export default prisma;