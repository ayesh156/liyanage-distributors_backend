import type { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.ts';
import { WarehouseService } from '../services/warehouse.service.ts';
import { validatePositiveNumber } from '../utils/inventoryValidation.ts';

export const CategoryController = {
  /**
   * GET /api/categories
   * List all active product categories.
   */
  getCategories: catchAsync(async (_req: Request, res: Response) => {
    const result = await WarehouseService.getCategories();
    res.json({ success: true, data: result });
  }),

  /**
   * POST /api/categories
   * Register a new hardware product category.
   */
  createCategory: catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.createCategory(req.body, req.user);
    res.status(201).json({ success: true, data: result });
  }),

  /**
   * PUT /api/categories/:id
   * Update category name and synchronize existing catalog items.
   */
  updateCategory: catchAsync(async (req: Request, res: Response) => {
    const id = validatePositiveNumber(Number(req.params.id), 'Category ID');
    const result = await WarehouseService.updateCategory(id, req.body, req.user);
    res.json({ success: true, data: result });
  }),

  /**
   * DELETE /api/categories/:id
   * Soft-delete a category.
   */
  deleteCategory: catchAsync(async (req: Request, res: Response) => {
    const id = validatePositiveNumber(Number(req.params.id), 'Category ID');
    const result = await WarehouseService.deleteCategory(id, req.user);
    res.json({ success: true, data: result });
  }),
};

export default CategoryController;
