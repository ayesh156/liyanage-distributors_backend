import { Router } from 'express';
import invoiceController from '../controllers/invoiceController.js';

const router = Router();

// GET /api/invoices/outstanding — must be before /:id to avoid route param conflict
router.get('/outstanding', invoiceController.outstanding);

// GET /api/invoices/summary — must be before /:id to avoid route param conflict
router.get('/summary', invoiceController.summary);

// GET /api/invoices
router.get('/', invoiceController.list);

// GET /api/invoices/document/:documentNo
router.get('/document/:documentNo', invoiceController.getByDocumentNo);

// GET /api/invoices/:id
router.get('/:id', invoiceController.getById);

// POST /api/invoices
router.post('/', invoiceController.create);

// PUT /api/invoices/:id
router.put('/:id', invoiceController.update);

// DELETE /api/invoices/:id
router.delete('/:id', invoiceController.delete);

export default router;