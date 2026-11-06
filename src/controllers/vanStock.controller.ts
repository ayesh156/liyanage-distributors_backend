import type { Request, Response } from 'express';
import { VanStockService } from '../services/vanStock.service.ts';
import { catchAsync } from '../utils/catchAsync.ts';

export const VanStockController = {
  /**
   * GET /api/van-stock
   * Fetch active van inventory, live route & rep details, KPIs, and movements.
   */
  getInventory: catchAsync(async (req: Request, res: Response) => {
    const vehicleId = (req.query.vehicleId as string) || 'VAN-01';
    const result = await VanStockService.getVanInventory(vehicleId);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/van-stock/load
   * Store-to-Vehicle transfer loading.
   */
  loadStock: catchAsync(async (req: Request, res: Response) => {
    const result = await VanStockService.loadToVan(req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * PUT /api/van-stock/modify-qty
   * Modify loaded van item quantity with automatic warehouse reconciliation.
   */
  modifyQty: catchAsync(async (req: Request, res: Response) => {
    const result = await VanStockService.modifyLoadedVanQty(req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/van-stock/sales
   * Deduct sold items from van on-hand stock and log road sales outbound.
   */
  recordSale: catchAsync(async (req: Request, res: Response) => {
    const result = await VanStockService.recordRoadSale(req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/van-stock/return
   * Return unsold stock from vehicle back to Central Warehouse.
   */
  returnStock: catchAsync(async (req: Request, res: Response) => {
    const result = await VanStockService.returnToWarehouse(req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * DELETE /api/van-stock/items/:id
   * Soft-delete van stock item, auto-reconciling any remaining sellable stock back to warehouse.
   */
  deleteItem: catchAsync(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    const result = await VanStockService.softDeleteVanStockItem(id, req.user!);
    res.status(200).json({ success: true, ...result });
  }),

  /**
   * PUT /api/van-stock/damaged-goods/:id/status
   * Update status of damaged record (INSPECTED, WRITTEN_OFF, VENDOR_RETURN).
   */
  updateDamagedStatus: async (req: Request, res: Response) => {
    try {
      const parsedId = parseInt(String(req.params.id), 10);
      if (isNaN(parsedId) || parsedId <= 0 || parsedId > 2147483647) {
        return res.status(400).json({
          success: false,
          error: 'Damaged goods record ID must be a valid positive 32-bit integer.',
        });
      }

      const status = req.body.status || req.body.newStatus;
      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required.',
        });
      }

      const user = req.user || {
        userId: 'system',
        username: 'Warehouse Manager',
        role: 'ADMIN',
      };

      const result = await VanStockService.updateDamagedStatus(
        parsedId,
        {
          status,
          resolutionNotes: req.body.resolutionNotes,
        },
        user,
      );

      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      console.error(`[VanStockController.updateDamagedStatus] Error updating record ${req.params.id}:`, error);
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Internal server error updating damaged status',
      });
    }
  },
};

export default VanStockController;
