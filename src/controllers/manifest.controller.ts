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
    const date = req.query.date as string | undefined;
    const result = await VanStockService.getDailyManifest(vehicleId, date);
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
   * Internal rep verification endpoint with discrepancy analysis and morning check persistence.
   */
  verifyByRep: catchAsync(async (req: Request, res: Response) => {
    const manifestNo = req.body.manifestNo;
    const result = await VanStockService.verifyManifestByRep(manifestNo, req.body);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/manifests/reconcile-evening
   * Persists the evening reconciliation checklist items for the specified date.
   */
  reconcileEvening: catchAsync(async (req: Request, res: Response) => {
    const result = await VanStockService.saveEveningChecks(req.body);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * GET /api/manifests/saved-signatures
   * Retrieves saved digital signatures for Owner and designated Sales Rep from SystemSetting.
   */
  getSavedSignatures: catchAsync(async (req: Request, res: Response) => {
    const repId = req.query.repId as string | undefined;
    const result = await VanStockService.getSavedSignatures(repId);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/manifests/saved-signatures
   * Persists or updates saved digital signatures in SystemSetting for one-click re-use.
   */
  saveSignature: catchAsync(async (req: Request, res: Response) => {
    const { type, repId, signatureData } = req.body;
    const result = await VanStockService.saveSignature({ type, repId, signatureData }, req.user);
    res.status(200).json({ success: true, data: result });
  }),

  /**
   * POST /api/manifests/toggle-item-check
   * Immediately persists Morning Check or Evening Reconciliation Check to DB.
   */
  toggleItemCheck: catchAsync(async (req: Request, res: Response) => {
    const { itemId, type, checked, vehicleId, date } = req.body;
    const result = await VanStockService.toggleItemCheck(
      Number(itemId),
      type as 'morning' | 'evening',
      Boolean(checked),
      vehicleId,
      date as string | undefined
    );
    res.status(200).json({ success: true, data: result });
  }),
};

export default ManifestController;
