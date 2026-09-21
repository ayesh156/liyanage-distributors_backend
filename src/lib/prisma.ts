import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const rawUrl = process.env.DATABASE_URL;

if (!rawUrl) {
  throw new Error(
    'Critical architecture error: DATABASE_URL is missing in environment variables.',
  );
}

// Prisma connection-pool parameters are configured here for production load and connection stability.
const dbUrl = new URL(rawUrl);
dbUrl.searchParams.set('connection_limit', '15');
dbUrl.searchParams.set('connect_timeout', '20');
dbUrl.searchParams.set('pool_timeout', '30');

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: dbUrl.toString(),
      },
    },
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

// Keep one Prisma client instance across module reloads and development restarts.
globalForPrisma.prisma = prisma;

let isConnected = false;

export function isDbConnected(): boolean {
  return isConnected;
}

// Initialize the shared Prisma connection during server startup.
export async function connectDB(): Promise<void> {
  try {
    await prisma.$connect();
    isConnected = true;

    const databaseName = dbUrl.pathname.replace(/^\//, '');

    // Standardized database engine logging without emojis or broken encodings
    console.log('[db] Prisma Native Engine connected successfully (Pool limit: 5)');
    
  } catch (error) {
    isConnected = false;
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

// Gracefully close the shared Prisma connection during server shutdown.
export async function disconnectDB(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await prisma.$disconnect();
    isConnected = false;
  } catch (error) {
    console.error('❌ Database disconnect failed:', error);
    throw error;
  }
}

export default prisma;
