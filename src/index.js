import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import router from './routes/index.js';
import { testConnection } from './config/database.js';

// ─────────────────────────────────────────────────────────────
// LIYANAGE DISTRIBUTORS - PRODUCTION REST API SERVER
// Express MVC Backend for Ledger Management System
// ─────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', true);
const PORT = parseInt(process.env.PORT || '3003', 10);

// ── BULLETPROOF DYNAMIC CORS & PREFLIGHT CONFIGURATION ───────
const allowedOrigins = [
  'https://lhdd.ecosystemlk.app',
  'https://api.lhdd.ecosystemlk.app', // 👈 API Domain එක හරහා එන proxy Handshakes සඳහා අනිවාර්යයි
  'http://localhost:5173',
  'http://localhost:3003'
];

/**
 * incoming Request එකේ Origin එක Whitelist එකේ තියෙනවාදැයි පරීක්ෂා කිරීම.
 */
function isOriginAllowed(origin) {
  if (!origin) return false;
  if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return true;
  if (/^https:\/\/lhdd\.ecosystemlk\.app\/?$/i.test(origin)) return true;
  if (/^https:\/\/api\.lhdd\.ecosystemlk\.app\/?$/i.test(origin)) return true;
  return false;
}

/**
 * Custom CORS Middleware Layer - Zero Header Dropouts වළක්වයි
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Inform downstream proxies/caches that response varies by Origin
  res.setHeader('Vary', 'Origin');

  if (origin && isOriginAllowed(origin)) {
    // Whitelist එකේ තියෙනවා නම් ඒ origin එකම echo කරයි
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
  } else {
    // Proxy handshakes වලදී origin එක masked වුවහොත් fallback එකක් ලෙස ක්‍රියා කරයි
    res.setHeader('Access-Control-Allow-Origin', 'https://lhdd.ecosystemlk.app');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
  }

  // ── OPTIONS Preflight Handling — සැනින් 204 Return කරයි ──
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 Hours cache duration
    return res.status(204).end();
  }

  next();
});

// ── Gzip Compression ─────────────────────────────────────────
// Compresses responses > 1 KB — critical for large /reports/* payloads.
// Must be registered BEFORE the body parsers and route handlers.
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

// ── Start Server ─────────────────────────────────────────────
async function startServer() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  LIYANAGE DISTRIBUTORS - REST API');
  console.log('  Ledger Management System v1.0.0');
  console.log('═══════════════════════════════════════════════\n');

  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    console.error('⚠️  Server will start, but database is unavailable.');
    console.error('   Make sure MySQL/MariaDB is running and DATABASE_URL is correct.\n');
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`   Health:     http://localhost:${PORT}/api/health`);
    console.log(`   Stores:     http://localhost:${PORT}/api/stores`);
    console.log(`   Invoices:   http://localhost:${PORT}/api/invoices`);
    console.log(`   Payments:   http://localhost:${PORT}/api/payments`);
    console.log(`   SalesPersons: http://localhost:${PORT}/api/sales-persons\n`);
  });
}

startServer();

export default app;