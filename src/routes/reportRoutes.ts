import { Router } from 'express';
import invoiceController from '../controllers/invoiceController.ts';

const router = Router();

// GET /api/reports/outstanding
router.get('/outstanding', invoiceController.outstanding);

export default router;

