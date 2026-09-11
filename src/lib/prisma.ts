import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Singleton Prisma client for the entire application.
 * Uses the MariaDB adapter with explicit connection pooling and timeout thresholds.
 */
const globalForPrisma = globalThis;

const rawUrl = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/liyanage_backend';
const parsedUrl = new URL(rawUrl);

const adapter = new PrismaMariaDb({
  host: parsedUrl.hostname,
  port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 3306,
  user: decodeURIComponent(parsedUrl.username),
  password: decodeURIComponent(parsedUrl.password),
  database: parsedUrl.pathname.replace(/^\//, ''),
  connectionLimit: 5,      // Server CPU/memory core වලට අනුකූල safe connection pool limit එක
  connectTimeout: 5000,   // 5s timeout to prevent endless retry storms
  idleTimeout: 60,         // Idle connections 60s වලින් drop කර leaks වළක්වයි
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;