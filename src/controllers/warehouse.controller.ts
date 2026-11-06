import type { Request, Response } from 'express';
import { WarehouseService } from '../services/warehouse.service.ts';
import { catchAsync } from '../utils/catchAsync.ts';

export const WarehouseController = {
  /**
   * GET /api/warehouse/catalog
   * List active products, stock on hand in LOC_MAIN, valuation, and movements.
   */
  getCatalog: catchAsync(async (req: Request, res: Response) => {
    const filters = {
      search: req.query.search as string | undefined,
      category: req.query.category as string | undefined,
    };
    const result = await WarehouseService.getWarehouseCatalog(filters);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/warehouse/products
   * Register a new Product SKU with opening stock.
   */
  registerProduct: catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.registerProduct(req.body, req.user!);
    res.status(201).json({ success: true, data: result });
  }),

  /**
   * PUT /api/warehouse/products/:id
   * Update product SKU metadata and sync stock items.
   */
  updateProduct: catchAsync(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    const result = await WarehouseService.updateProduct(id, req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * DELETE /api/warehouse/products/:id
   * Soft-delete product SKU and associated stock.
   */
  deleteProduct: catchAsync(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    const result = await WarehouseService.softDeleteWarehouseProduct(id, req.user!);
    res.status(200).json({ success: true, ...result });
  }),

  /**
   * POST /api/warehouse/receive-po
   * Inbound supplier purchase order receiving.
   */
  receivePO: catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.receivePurchaseOrder(req.body, req.user!);
    res.status(200).json({ success: true, ...result });
  }),

  /**
   * POST /api/warehouse/adjust-stock
   * Central warehouse physical audit count reconciliation.
   */
  adjustStock: catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.adjustWarehouseStock(req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * GET /api/warehouse/owner-signature
   * Fetch official Owner / Dispatcher signature from SystemSetting.
   */
  getOwnerSignature: catchAsync(async (_req: Request, res: Response) => {
    const result = await WarehouseService.getOwnerSignature();
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/warehouse/owner-signature
   * Save or upload official Owner / Dispatcher signature.
   */
  saveOwnerSignature: catchAsync(async (req: Request, res: Response) => {
    const result = await WarehouseService.saveOwnerSignature(req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),
};

export default WarehouseController;
