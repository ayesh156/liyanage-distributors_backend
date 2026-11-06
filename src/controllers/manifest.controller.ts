import type { Request, Response } from 'express';
import { VanStockService } from '../services/vanStock.service.ts';
import { catchAsync } from '../utils/catchAsync.ts';

export const ManifestController = {
  /**
   * GET /api/manifests/daily
   * Retrieves today's Daily Delivery Van Manifest with items snapshot.
   */
  getDaily: catchAsync(async (req: Request, res: Response) => {
    const vehicleId = (req.query.vehicleId as string) || 'VAN-01';
    const result = await VanStockService.getDailyManifest(vehicleId);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * GET /api/manifests/history
   * Retrieves list of historical manifests.
   */
  getHistory: catchAsync(async (req: Request, res: Response) => {
    const vehicleId = (req.query.vehicleId as string) || 'VAN-01';
    const result = await VanStockService.getManifestHistory(vehicleId);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/manifests/sign-owner
   * Dispatches manifest stamped with Owner official digital signature.
   */
  signByOwner: catchAsync(async (req: Request, res: Response) => {
    const manifestId = req.body.manifestId as string | undefined;
    const result = await VanStockService.signManifestByOwner(manifestId, req.body, req.user!);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/manifests/verify-rep
   * Internal rep verification endpoint with discrepancy analysis.
   */
  verifyByRep: catchAsync(async (req: Request, res: Response) => {
    const manifestNo = req.body.manifestNo;
    const result = await VanStockService.verifyManifestByRep(manifestNo, req.body);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * GET /api/manifests/share/:manifestNo
   * PUBLIC endpoint (Zero-login required for WhatsApp field link).
   * Strictly returns non-sensitive manifest data and line-item snapshot.
   * Wrapped in robust try/catch block to return clean 404 on missing records
   * and graceful 500 responses on unexpected database query failures.
   */
  getPublicShare: async (req: Request, res: Response) => {
    try {
      const rawManifestNo = req.params?.manifestNo;
      if (!rawManifestNo || typeof rawManifestNo !== 'string' || !rawManifestNo.trim()) {
        return res.status(404).json({ success: false, error: 'Manifest not found' });
      }

      const manifestNo = rawManifestNo.trim();
      const result = await VanStockService.getPublicManifestShare(manifestNo);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Manifest not found' });
      }

      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      const statusCode = error?.statusCode || (typeof error?.status === 'number' ? error.status : null);
      if (
        statusCode === 404 ||
        error?.code === 'P2025' ||
        error?.message?.toLowerCase().includes('not found')
      ) {
        return res.status(404).json({ success: false, error: 'Manifest not found' });
      }

      console.error(`[ManifestController.getPublicShare] Database query error for manifest "${req.params?.manifestNo}":`, error);
      return res.status(500).json({
        success: false,
        error: 'Database connection or query failure while fetching manifest',
      });
    }
  },

  /**
   * POST /api/manifests/share/:manifestNo/verify
   * PUBLIC endpoint (Zero-login WhatsApp rep acceptance).
   * Validates digital signature and item-level check status.
   */
  verifyPublicShare: catchAsync(async (req: Request, res: Response) => {
    const manifestNo = String(req.params.manifestNo);
    const result = await VanStockService.verifyManifestByRep(manifestNo, req.body);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * PUT/POST /api/manifests/share/:manifestNo/sign
   * PUBLIC endpoint (Zero-login WhatsApp rep acceptance).
   * Validates digital signature, explicitly sets status = "REP_ACCEPTED",
   * updates manifest items to repChecked = true, and returns the updated manifest.
   */
  signPublicShare: catchAsync(async (req: Request, res: Response) => {
    const manifestNo = String(req.params.manifestNo);
    const result = await VanStockService.verifyManifestByRep(manifestNo, req.body);
    res.status(200).json({ success: true, data: result.manifest || result });
  }),
};

export default ManifestController;
