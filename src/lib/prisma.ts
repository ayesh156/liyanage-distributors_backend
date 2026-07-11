import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Singleton Prisma client for the entire application.
 * Uses the MariaDB adapter for Prisma 7 compatibility.
 * In development, cached on `globalThis` to avoid connection leaks during hot-reload.
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const adapterUrl = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/liyanage_backend';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaMariaDb(adapterUrl),
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;