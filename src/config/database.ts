import prisma, { isDbConnected, connectDB } from '../lib/prisma.ts';

/**
 * Database initialization and health check utility.
 * Tests the database connection on startup.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await connectDB();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

/**
 * Returns the current database connection health status.
 */
export function getDatabaseHealth() {
  return {
    connected: isDbConnected(),
    database: 'liyanage_distributors',
  };
}

export { prisma };
