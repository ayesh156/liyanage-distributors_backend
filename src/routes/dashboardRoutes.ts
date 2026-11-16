import express from 'express';
import dashboardController from '../controllers/dashboardController.ts';

const router = express.Router();

// GET /api/dashboard/analytics
router.get('/analytics', dashboardController.analytics);

export default router;

