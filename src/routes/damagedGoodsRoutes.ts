import { Router } from 'express';
import { DamagedGoodsController } from '../controllers/damagedGoods.controller.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = Router();

// Quarantined defective goods ledger
router.get('/', DamagedGoodsController.list);
router.post('/quarantine', DamagedGoodsController.quarantine);
router.put('/:id/status', DamagedGoodsController.updateStatus);
router.delete('/:id', adminOnly, DamagedGoodsController.delete);

export default router;

