import express from 'express';
import routeController from '../controllers/routeController.ts';

const router = express.Router();

// GET /api/routes
router.get('/', routeController.list);

// GET /api/routes/:id
router.get('/:id', routeController.getById);

// POST /api/routes
router.post('/', routeController.create);

// PUT /api/routes/:id
router.put('/:id', routeController.update);

// DELETE /api/routes/:id
router.delete('/:id', routeController.delete);

export default router;

