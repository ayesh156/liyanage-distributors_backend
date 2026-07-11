import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import router from './routes/index.js';
import { testConnection } from './config/database.js';

// ─────────────────────────────────────────────────────────────
// LIYANAGE DISTRIBUTORS - PRODUCTION REST API SERVER
// Express MVC Backend for Ledger Management System
// ─────────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// ── CORS Configuration ───────────────────────────────────────
const normalizeOrigin = (value) => {
  if (!value || typeof value !== 'string') return null;
  return value.trim().replace(/\/+$/, '').toLowerCase();
};

const frontendOrigin = normalizeOrigin(process.env.FRONTEND_URL);
const allowedOrigins = [
  frontendOrigin,
  normalizeOrigin('http://localhost:5173'),
  normalizeOrigin('http://127.0.0.1:5173'),
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!origin || (normalizedOrigin && allowedOrigins.includes(normalizedOrigin))) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Mismatch Exception'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

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