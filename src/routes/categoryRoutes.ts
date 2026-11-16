import express from 'express';
import { CategoryController } from '../controllers/category.controller.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = express.Router();

// Dynamic Product Categories CRUD
router.get('/', CategoryController.getCategories);
router.post('/', adminOnly, CategoryController.createCategory);
router.put('/:id', adminOnly, CategoryController.updateCategory);
router.delete('/:id', adminOnly, CategoryController.deleteCategory);

export default router;
