import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Singleton Prisma client for the entire application.
 * Uses MariaDB adapter for Prisma 7 compatibility.
 * Caches on globalThis during development to prevent hot-reload connection leaks.
 */
const globalForPrisma = globalThis;

const adapterUrl = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/liyanage_backend';

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaMariaDb(adapterUrl),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;