import express from 'express';
import { WarehouseController } from '../controllers/warehouse.controller.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = express.Router();

// Warehouse Catalog & Master Products
router.get('/catalog', WarehouseController.getCatalog);
router.post('/products', adminOnly, WarehouseController.registerProduct);
router.put('/products/:id', adminOnly, WarehouseController.updateProduct);
router.delete('/products/:id', adminOnly, WarehouseController.deleteProduct);

// PO Receiving & Stocktake Adjustments
router.post('/receive-po', WarehouseController.receivePO);
router.post('/adjust-stock', adminOnly, WarehouseController.adjustStock);

// Dynamic Product Categories CRUD
router.get('/categories', WarehouseController.getCategories);
router.post('/categories', adminOnly, WarehouseController.createCategory);
router.put('/categories/:id', adminOnly, WarehouseController.updateCategory);
router.delete('/categories/:id', adminOnly, WarehouseController.deleteCategory);

// Owner / Dispatcher Official Digital Signature Settings
router.get('/owner-signature', WarehouseController.getOwnerSignature);
router.post('/owner-signature', adminOnly, WarehouseController.saveOwnerSignature);

export default router;

