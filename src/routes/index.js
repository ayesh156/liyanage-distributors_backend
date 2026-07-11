import { Router } from 'express';
import storeRoutes from './storeRoutes.js';
import salesPersonRoutes from './salesPersonRoutes.js';
import invoiceRoutes from './invoiceRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import routeRoutes from './routeRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import reportRoutes from './reportRoutes.js';
import authRoutes from './authRoutes.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { getDatabaseHealth } from '../config/database.js';

const router = Router();

// ── Health Check ─────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const health = await getDatabaseHealth();
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    service: 'liyanage-distributors-api',
    version: '1.0.0',
    ...health,
  });
});

// ── Mount Resource Routes ────────────────────────────────────
router.use('/auth', authRoutes);
router.use(authMiddleware);
router.use('/stores', storeRoutes);
router.use('/sales-persons', salesPersonRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/routes', routeRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);

export default router;