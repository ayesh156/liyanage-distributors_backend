import { Router } from 'express';
import storeRoutes from './storeRoutes.ts';
import salesPersonRoutes from './salesPersonRoutes.ts';
import invoiceRoutes from './invoiceRoutes.ts';
import paymentRoutes from './paymentRoutes.ts';
import routeRoutes from './routeRoutes.ts';
import dashboardRoutes from './dashboardRoutes.ts';
import reportRoutes from './reportRoutes.ts';
import authRoutes from './authRoutes.ts';
import { authMiddleware } from '../middlewares/authMiddleware.ts';
import { getDatabaseHealth } from '../config/database.ts';

const router = Router();

// Health Check
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

// Mount Resource Routes
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
