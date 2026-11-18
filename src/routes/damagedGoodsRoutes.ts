import express from 'express';
import { DamagedGoodsController } from '../controllers/damagedGoods.controller.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = express.Router();

// Quarantined defective goods ledger
router.get('/', DamagedGoodsController.list);
router.post('/quarantine', DamagedGoodsController.quarantine);
router.put('/:id/status', DamagedGoodsController.updateStatus);
router.post('/:id/undo-to-stock', DamagedGoodsController.undoToStock);
router.delete('/:id', adminOnly, DamagedGoodsController.delete);

export default router;

