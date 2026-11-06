import { Router } from 'express';
import { WarehouseController } from '../controllers/warehouse.controller.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = Router();

// Warehouse Catalog & Master Products
router.get('/catalog', WarehouseController.getCatalog);
router.post('/products', adminOnly, WarehouseController.registerProduct);
router.put('/products/:id', adminOnly, WarehouseController.updateProduct);
router.delete('/products/:id', adminOnly, WarehouseController.deleteProduct);

// PO Receiving & Stocktake Adjustments
router.post('/receive-po', WarehouseController.receivePO);
router.post('/adjust-stock', adminOnly, WarehouseController.adjustStock);

// Owner / Dispatcher Official Digital Signature Settings
router.get('/owner-signature', WarehouseController.getOwnerSignature);
router.post('/owner-signature', adminOnly, WarehouseController.saveOwnerSignature);

export default router;

