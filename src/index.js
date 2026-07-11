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
app.set('trust proxy', true);
const PORT = parseInt(process.env.PORT || '3003', 10);

// ── CORS Configuration ───────────────────────────────────────
const allowedOrigins = [
  'https://lhdd.ecosystemlk.app',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options(/.*/, (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  return res.sendStatus(204);
});

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