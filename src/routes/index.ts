import express from 'express';
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
import categoryRoutes from './categoryRoutes.ts';
import { authMiddleware } from '../middlewares/authMiddleware.ts';
import { getDatabaseHealth } from '../config/database.ts';

import healthRoutes from './health.routes.ts';
import userRoutes from './userRoutes.ts';
import settingsRoutes from './settingsRoutes.ts';

const router = express.Router();

// Health Check (Lightweight ping endpoint with { status: "ok" })
router.use('/health', healthRoutes);

// Unauthenticated / Auth Routes
router.use('/auth', authRoutes);

// Protected Core Resource Routes
router.use(authMiddleware);
router.use('/manifests', manifestRoutes);
router.use('/users', userRoutes);
router.use('/stores', storeRoutes);
router.use('/sales-persons', salesPersonRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/routes', routeRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/warehouse', warehouseRoutes);
router.use('/categories', categoryRoutes);
router.use('/van-stock', vanStockRoutes);
router.use('/damaged-goods', damagedGoodsRoutes);
router.use('/settings', settingsRoutes);

export default router;
