import 'dotenv/config';
import { createServer } from 'http';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import router from './routes/index.js';
import { testConnection } from './config/database.js';
import prisma from './lib/prisma.js';

// ─────────────────────────────────────────────────────────────
// LIYANAGE DISTRIBUTORS - PRODUCTION REST API SERVER
// Express MVC Backend for Ledger Management System
// ─────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1);

// ── BULLETPROOF STANDARD CORS CONFIGURATION ──────────────────
const allowedOrigins = [
  'https://lhdd.ecosystemlk.app',
  'https://api.lhdd.ecosystemlk.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3003'
];

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400
}));

// ── Gzip Compression ─────────────────────────────────────────
// Compresses responses > 1 KB — critical for large /reports/* payloads.
app.use(compression({ threshold: 1024 }));

// ── Body Parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request Logging ──────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${req.method}] ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ── API Routes ───────────────────────────────────────────────
app.use('/api', router);

// ── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// ── HTTP Server & OpenLiteSpeed lsnode Dual Support ───────────
const httpServer = createServer(app);

// OpenLiteSpeed lsnode pipe socket සහ Local Port dual-support
const isLSNode = Boolean(process.env.LSAPI_CHILDREN);
const LISTEN_PORT = isLSNode ? undefined : (process.env.PORT ? parseInt(process.env.PORT, 10) : 3003);

async function startServer() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  LIYANAGE DISTRIBUTORS - REST API');
  console.log('  Ledger Management System (Production lsnode)');
  console.log('═══════════════════════════════════════════════\n');

  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    console.error('⚠️  Server will start, but database is unavailable.');
    console.error('   Make sure MySQL/MariaDB is running and DATABASE_URL is correct.\n');
  }

  if (LISTEN_PORT) {
    // Standard TCP Port Mode (Local Development / Standalone Node)
    httpServer.listen(LISTEN_PORT, () => {
      console.log(`🚀 Server running on http://localhost:${LISTEN_PORT}`);
      console.log(`   Health:     http://localhost:${LISTEN_PORT}/api/health`);
      console.log(`   Stores:     http://localhost:${LISTEN_PORT}/api/stores`);
      console.log(`   Invoices:   http://localhost:${LISTEN_PORT}/api/invoices`);
      console.log(`   Payments:   http://localhost:${LISTEN_PORT}/api/payments\n`);
    });
  } else {
    // OpenLiteSpeed lsnode Native pipe mode
    httpServer.listen(() => {
      console.log('🚀 Liyanage Distributors API started via OpenLiteSpeed lsnode pipe');
    });
  }
}

// ── Graceful Shutdown (Zombie processes සහ MariaDB connection leaks වැළැක්වීමට) ──
let isShuttingDown = false;
async function handleGracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[lsnode] Received ${signal}. Closing HTTP server and database gracefully...`);

  httpServer.close(async () => {
    try {
      if (prisma && typeof prisma.$disconnect === 'function') {
        await prisma.$disconnect();
      }
      console.log('[lsnode] Database disconnected cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('[lsnode] Disconnect error:', err);
      process.exit(1);
    }
  });

  // Force exit safety timer (5s)
  setTimeout(() => {
    console.error('[lsnode] Force exiting after 5s timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[lsnode] Unhandled Promise Rejection:', reason));
process.on('uncaughtException', (err) => console.error('[lsnode] Uncaught Exception:', err));

startServer();

export default app;