/**
 * @file vanStockController.js
 * @description Van Stock Controller with resilient error handling and clean 404 fallbacks
 * for public WhatsApp share routes and manifest lookups.
 */

import prisma from '../src/lib/prisma.ts';

export const vanStockController = {
  /**
   * GET /api/manifests/share/:manifestNo
   * Public manifest lookup with try-catch wrapping and clean 404 response.
   */
  async getPublicManifestShare(req, res) {
    try {
      const rawManifestNo = req.params?.manifestNo;
      if (!rawManifestNo || typeof rawManifestNo !== 'string' || !rawManifestNo.trim()) {
        return res.status(404).json({
          success: false,
          error: 'Manifest not found',
        });
      }

      const manifestNo = rawManifestNo.trim();
      const manifest = await prisma.dailyVanManifest.findUnique({
        where: { manifestNo },
      });

      if (!manifest) {
        return res.status(404).json({
          success: false,
          error: 'Manifest not found',
        });
      }

      return res.status(200).json({
        success: true,
        data: manifest,
      });
    } catch (error) {
      console.error(`[vanStockController.getPublicManifestShare] Error querying manifest:`, error);
      if (error?.code === 'P2025' || error?.message?.toLowerCase().includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Manifest not found',
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Database connection or query failure while fetching manifest',
      });
    }
  },

  /**
   * PUT/POST /api/manifests/share/:manifestNo/sign
   * Representative signature submission and manifest acceptance.
   * Explicitly sets status = 'REP_ACCEPTED', saves signature,
   * updates manifest items to repChecked = true, status = 'APPROVED',
   * and returns the updated manifest object.
   */
  async signManifest(req, res) {
    try {
      const rawManifestNo = req.params?.manifestNo;
      if (!rawManifestNo || typeof rawManifestNo !== 'string' || !rawManifestNo.trim()) {
        return res.status(404).json({
          success: false,
          error: 'Manifest not found',
        });
      }

      const manifestNo = rawManifestNo.trim();
      const manifest = await prisma.dailyVanManifest.findUnique({
        where: { manifestNo },
      });

      if (!manifest) {
        return res.status(404).json({
          success: false,
          error: 'Manifest not found',
        });
      }

      // Allow signing for any manifest that is DISPATCHED or PENDING regardless of revision number
      if (manifest.status !== 'DISPATCHED' && manifest.status !== 'PENDING') {
        return res.status(400).json({
          error: 'This manifest is archived or already signed.',
        });
      }

      const repSignature = req.body?.repSignature || req.body?.signatureData || req.body?.signature;
      if (!repSignature || typeof repSignature !== 'string' || repSignature.length < 100) {
        return res.status(400).json({
          error: 'Please provide a valid signature.',
        });
      }

      const repName = req.body?.repName?.trim() || manifest.repName || 'Sales Representative';
      const now = new Date();

      // Update related vehicle stock items if vehicle exists
      if (manifest.vehicleId) {
        const vehicleLoc = await prisma.inventoryLocation.findFirst({
          where: { vehicleId: manifest.vehicleId, isActive: true },
        });

        if (vehicleLoc) {
          await prisma.stockItem.updateMany({
            where: {
              locationId: vehicleLoc.id,
              quantity: { gt: 0 },
              isActive: true,
            },
            data: {
              status: 'APPROVED',
              repChecked: true,
              repCheckedAt: now,
              discrepancyFlag: false,
              confirmedBy: repName,
              confirmedAt: now,
            },
          });
        }
      }

      // Re-map items snapshot to ensure all items reflect repChecked = true
      let itemsSnapshot = Array.isArray(manifest.itemsSnapshot) ? manifest.itemsSnapshot : [];
      if (itemsSnapshot.length > 0) {
        itemsSnapshot = itemsSnapshot.map((item) => ({
          ...item,
          repChecked: true,
          repCheckedAt: now.toISOString(),
          discrepancyFlag: false,
          status: 'APPROVED',
        }));
      }

      const updatedManifest = await prisma.dailyVanManifest.update({
        where: { id: manifest.id },
        data: {
          status: 'REP_ACCEPTED',
          repSignatureData: repSignature,
          repSignedBy: repName,
          repSignedAt: now,
          uncheckedCount: 0,
          itemsSnapshot: itemsSnapshot.length > 0 ? itemsSnapshot : undefined,
        },
      });

      return res.status(200).json({
        success: true,
        data: {
          ...updatedManifest,
          repSignature,
        },
        message: 'Manifest signed and accepted successfully.',
      });
    } catch (error) {
      console.error('[vanStockController.signManifest] Error signing manifest:', error);
      return res.status(500).json({
        success: false,
        error: 'Database error occurred while processing representative signature.',
      });
    }
  },
};

export default vanStockController;

