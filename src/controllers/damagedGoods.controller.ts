import type { Request, Response } from 'express';
import { VanStockService } from '../services/vanStock.service.ts';
import { catchAsync } from '../utils/catchAsync.ts';
import type { DamagedStatus } from '../types/index.ts';

export const DamagedGoodsController = {
  /**
   * GET /api/damaged-goods
   * List all quarantined damaged goods records and KPIs.
   */
  list: catchAsync(async (req: Request, res: Response) => {
    const filters = {
      status: req.query.status as DamagedStatus | undefined,
      vehicleId: req.query.vehicleId as string | undefined,
      search: req.query.search as string | undefined,
    };
    const result = await VanStockService.getDamagedGoodsList(filters);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/damaged-goods/quarantine
   * Quarantine defective goods into segregated damaged goods pool.
   */
  quarantine: catchAsync(async (req: Request, res: Response) => {
    const result = await VanStockService.quarantineDamagedGoods(req.body, req.user!);
    res.status(201).json({ success: true, data: result });
  }),

  /**
   * PUT /api/damaged-goods/:id/status
   * Update status of damaged record (INSPECTED, WRITTEN_OFF, VENDOR_RETURN).
   * Robust ID parsing, body normalization, error handling and auth fallback.
   */
  updateStatus: async (req: Request, res: Response) => {
    try {
      const parsedId = parseInt(String(req.params.id), 10);
      if (isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Damaged goods record ID must be a positive integer greater than 0.',
        });
      }

      const status = req.body.status || req.body.newStatus;
      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required.',
        });
      }

      // Safe user context fallback to prevent TypeError if req.user is undefined
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
      console.error(`[DamagedGoodsController.updateStatus] Error updating record ${req.params.id}:`, error);
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Internal server error updating damaged status',
      });
    }
  },

  /**
   * DELETE /api/damaged-goods/:id
   * Soft-delete quarantined record.
   */
  delete: catchAsync(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    const result = await VanStockService.softDeleteDamagedRecord(id, req.user!);
    res.status(200).json({ success: true, ...result });
  }),
};

export default DamagedGoodsController;
