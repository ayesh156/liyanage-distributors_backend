import { Router } from 'express';
import { StoreController } from '../controllers/store.controller.ts';

const router = Router();

// GET /api/stores/routes â€” must be before /:id to avoid route param conflict
router.get('/routes', StoreController.listRoutes);

// GET /api/stores
router.get('/', StoreController.list);

// GET /api/stores/:id
router.get('/:id', StoreController.getById);

// POST /api/stores
router.post('/', StoreController.create);

// PUT /api/stores/:id
router.put('/:id', StoreController.update);

// DELETE /api/stores/:id
router.delete('/:id', StoreController.delete);

export default router;
