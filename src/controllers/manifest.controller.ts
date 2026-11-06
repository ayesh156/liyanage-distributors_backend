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
   */
  getPublicShare: catchAsync(async (req: Request, res: Response) => {
    const manifestNo = String(req.params.manifestNo);
    const result = await VanStockService.getPublicManifestShare(manifestNo);
    res.status(200).json({ success: true, data: result });
  }),

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
};

export default ManifestController;
