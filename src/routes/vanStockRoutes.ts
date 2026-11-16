import express from 'express';
import { VanStockController } from '../controllers/vanStock.controller.ts';
import { ManifestController } from '../controllers/manifest.controller.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = express.Router();

// Van on-hand inventory, live vehicle & rep resolution
router.get('/', VanStockController.getInventory);

// Loading & modifying loaded van stock
router.post('/load', VanStockController.loadStock);
router.put('/modify-qty', VanStockController.modifyQty);

// Daily checklist & reconciliation toggle checkpoint
router.post('/check', ManifestController.toggleItemCheck);

// Road sales & returns
router.post('/sales', VanStockController.recordSale);
router.post('/return', VanStockController.returnStock);

// Quarantined Damaged Goods status update (alternate mounting point)
router.put('/damaged-goods/:id/status', VanStockController.updateDamagedStatus);

// Line-item soft removal (admin only)
router.delete('/items/:id', adminOnly, VanStockController.deleteItem);

export default router;

