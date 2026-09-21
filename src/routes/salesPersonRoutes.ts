import { Router } from 'express';
import { SalesPersonController } from '../controllers/salesPerson.controller.ts';

const router = Router();

// GET /api/sales-persons
router.get('/', SalesPersonController.list);

// GET /api/sales-persons/:id
router.get('/:id', SalesPersonController.getById);

// POST /api/sales-persons
router.post('/', SalesPersonController.create);

// PUT /api/sales-persons/:id
router.put('/:id', SalesPersonController.update);

// DELETE /api/sales-persons/:id
router.delete('/:id', SalesPersonController.delete);

export default router;
