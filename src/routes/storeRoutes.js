import { Router } from 'express';
import storeController from '../controllers/storeController.js';

const router = Router();

// GET /api/stores/routes — must be before /:id to avoid route param conflict
router.get('/routes', storeController.listRoutes);

// GET /api/stores
router.get('/', storeController.list);

// GET /api/stores/:id
router.get('/:id', storeController.getById);

// POST /api/stores
router.post('/', storeController.create);

// PUT /api/stores/:id
router.put('/:id', storeController.update);

// DELETE /api/stores/:id
router.delete('/:id', storeController.delete);

export default router;