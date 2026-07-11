import { Router } from 'express';
import salesPersonController from '../controllers/salesPersonController.js';

const router = Router();

// GET /api/sales-persons
router.get('/', salesPersonController.list);

// GET /api/sales-persons/:id
router.get('/:id', salesPersonController.getById);

// POST /api/sales-persons
router.post('/', salesPersonController.create);

// PUT /api/sales-persons/:id
router.put('/:id', salesPersonController.update);

// DELETE /api/sales-persons/:id
router.delete('/:id', salesPersonController.delete);

export default router;