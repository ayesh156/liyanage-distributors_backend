import { Router } from 'express';
import storeRoutes from './storeRoutes.ts';
import salesPersonRoutes from './salesPersonRoutes.ts';
import invoiceRoutes from './invoiceRoutes.ts';
import paymentRoutes from './paymentRoutes.ts';
import routeRoutes from './routeRoutes.ts';
import dashboardRoutes from './dashboardRoutes.ts';
import reportRoutes from './reportRoutes.ts';
import authRoutes from './authRoutes.ts';
import warehouseRoutes from './warehouseRoutes.ts';
import vanStockRoutes from './vanStockRoutes.ts';
import damagedGoodsRoutes from './damagedGoodsRoutes.ts';
import manifestRoutes from './manifestRoutes.ts';
import { authMiddleware } from '../middlewares/authMiddleware.ts';
import { getDatabaseHealth } from '../config/database.ts';

import healthRoutes from './health.routes.ts';
import userRoutes from './userRoutes.ts';

const router = Router();

// Health Check (Lightweight ping endpoint with { status: "ok" })
router.use('/health', healthRoutes);

// Unauthenticated / Auth Routes
router.use('/auth', authRoutes);

// Manifest Routes (contains public /share/:manifestNo and protected sub-routes)
router.use('/manifests', manifestRoutes);

// Protected Core Resource Routes
router.use(authMiddleware);
router.use('/users', userRoutes);
router.use('/stores', storeRoutes);
router.use('/sales-persons', salesPersonRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/routes', routeRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/warehouse', warehouseRoutes);
router.use('/van-stock', vanStockRoutes);
router.use('/damaged-goods', damagedGoodsRoutes);

export default router;
