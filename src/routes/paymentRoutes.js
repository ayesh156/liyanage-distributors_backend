import { Router } from 'express';
import paymentController from '../controllers/paymentController.js';

const router = Router();

// POST /api/payments/collect — must be before /:id to avoid route param conflict
router.post('/collect', paymentController.collect);

// POST /api/payments/bulk-collect
router.post('/bulk-collect', paymentController.bulkCollect);

// GET /api/payments
router.get('/', paymentController.list);

// GET /api/payments/:id
router.get('/:id', paymentController.getById);

// DELETE /api/payments/:id (Reverse payment)
router.delete('/:id', paymentController.reverse);

export default router;