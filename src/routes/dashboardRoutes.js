import { Router } from 'express';
import dashboardController from '../controllers/dashboardController.js';

const router = Router();

// GET /api/dashboard/analytics
router.get('/analytics', dashboardController.analytics);

export default router;
