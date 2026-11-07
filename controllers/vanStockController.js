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

      // Relaxed Status Check: Allow signing and item verification updates if manifest is DISPATCHED,
      // PENDING, REP_ACCEPTED, or PARTIAL_DISCREPANCY.
      // Only block the update if the status is strictly ARCHIVED, COMPLETED, or RETURNED.
      const currentStatus = (manifest.status || '').toUpperCase();
      const blockedStatuses = ['ARCHIVED', 'COMPLETED', 'RETURNED'];
      if (blockedStatuses.includes(currentStatus)) {
        return res.status(400).json({
          error: 'This manifest is archived or already closed.',
        });
      }

      const repSignature =
        req.body?.repSignature ||
        req.body?.signatureData ||
        req.body?.signature ||
        manifest.repSignatureData;
      if (!repSignature || typeof repSignature !== 'string' || repSignature.length < 50) {
        return res.status(400).json({
          error: 'Please provide a valid signature.',
        });
      }

      const repName = req.body?.repName?.trim() || manifest.repName || 'Sales Representative';
      const now = new Date();

      // Process item-level check states if items payload provided
      const checkedItemMap = new Map();
      const hasItemizedPayload = Array.isArray(req.body?.items) && req.body.items.length > 0;
      if (hasItemizedPayload) {
        req.body.items.forEach((i) => checkedItemMap.set(Number(i.itemId || i.id), Boolean(i.repChecked)));
      }

      let uncheckedCount = 0;

      // Update related vehicle stock items if vehicle exists
      if (manifest.vehicleId) {
        const vehicleLoc = await prisma.inventoryLocation.findFirst({
          where: { vehicleId: manifest.vehicleId, isActive: true },
        });

        if (vehicleLoc) {
          const liveItems = await prisma.stockItem.findMany({
            where: { locationId: vehicleLoc.id, quantity: { gt: 0 }, isActive: true },
          });

          for (const item of liveItems) {
            const isChecked = hasItemizedPayload
              ? (checkedItemMap.has(item.id) ? checkedItemMap.get(item.id) : item.repChecked)
              : true;

            if (isChecked) {
              await prisma.stockItem.update({
                where: { id: item.id },
                data: {
                  status: 'APPROVED',
                  repChecked: true,
                  repCheckedAt: item.repCheckedAt || now,
                  discrepancyFlag: false,
                  confirmedBy: repName,
                  confirmedAt: now,
                },
              });
            } else {
              uncheckedCount += 1;
              await prisma.stockItem.update({
                where: { id: item.id },
                data: {
                  status: 'PENDING_CONFIRMATION',
                  repChecked: false,
                  repCheckedAt: null,
                  discrepancyFlag: true,
                  confirmedBy: null,
                  confirmedAt: null,
                },
              });
            }
          }
        }
      }

      // Re-map items snapshot to ensure items reflect current repChecked state
      let itemsSnapshot = Array.isArray(manifest.itemsSnapshot) ? manifest.itemsSnapshot : [];
      if (itemsSnapshot.length > 0) {
        itemsSnapshot = itemsSnapshot.map((item) => {
          const itemId = Number(item.id || item.itemId);
          const isChecked = hasItemizedPayload
            ? (checkedItemMap.has(itemId) ? checkedItemMap.get(itemId) : item.repChecked)
            : true;
          return {
            ...item,
            repChecked: isChecked,
            repCheckedAt: isChecked ? (item.repCheckedAt || now.toISOString()) : null,
            discrepancyFlag: !isChecked,
            status: isChecked ? 'APPROVED' : 'PENDING_CONFIRMATION',
          };
        });
      }

      const finalStatus = uncheckedCount === 0 ? 'REP_ACCEPTED' : 'PARTIAL_DISCREPANCY';

      const updatedManifest = await prisma.dailyVanManifest.update({
        where: { id: manifest.id },
        data: {
          status: finalStatus,
          repSignatureData: repSignature,
          repSignedBy: repName,
          repSignedAt: manifest.repSignedAt || now,
          uncheckedCount: 0,
          itemsSnapshot: itemsSnapshot.length > 0 ? itemsSnapshot : undefined,
        },
      });

      // Synchronize perpetual VanInventory when manifest is accepted by representative
      if (finalStatus === 'REP_ACCEPTED' && manifest.vehicleId) {
        const itemsToIncrement = itemsSnapshot.length > 0 ? itemsSnapshot : [];
        for (const item of itemsToIncrement) {
          const sku = item.sku;
          const qty = Math.round(Number(item.quantity) || 0);
          if (sku && qty > 0) {
            await prisma.vanInventory.upsert({
              where: {
                vanId_skuId: {
                  vanId: manifest.vehicleId,
                  skuId: sku,
                },
              },
              update: {
                quantity: { increment: qty },
              },
              create: {
                vanId: manifest.vehicleId,
                skuId: sku,
                quantity: qty,
              },
            });
          }
        }
      }

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

  /**
   * POST /api/van-stock/sales (Perpetual Inventory Deduction)
   * Decrements quantity in VanInventory upon completing a Road Sale.
   */
  async recordRoadSale(req, res) {
    try {
      const { vehicleId = 'VAN-01', items, customerName, invoiceNo, performedBy } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Sale items array is required.' });
      }

      const results = [];
      for (const item of items) {
        const sku = item.sku || item.skuId;
        const qty = Math.round(Number(item.quantity) || 0);
        if (!sku || qty <= 0) continue;

        const current = await prisma.vanInventory.findUnique({
          where: { vanId_skuId: { vanId: vehicleId, skuId: sku } },
        });

        const newQty = current ? Math.max(0, current.quantity - qty) : 0;
        const updated = await prisma.vanInventory.upsert({
          where: { vanId_skuId: { vanId: vehicleId, skuId: sku } },
          update: { quantity: newQty },
          create: { vanId: vehicleId, skuId: sku, quantity: 0 },
        });

        results.push(updated);
      }

      return res.status(200).json({
        success: true,
        message: 'Road sale recorded and perpetual inventory decremented.',
        data: results,
      });
    } catch (error) {
      console.error('[vanStockController.recordRoadSale] Error recording road sale:', error);
      return res.status(500).json({ success: false, error: 'Failed to record road sale perpetual inventory.' });
    }
  },

  /**
   * POST /api/van-stock/quarantine-defect (Perpetual Inventory Quarantine)
   * Decrements quantity in VanInventory when a defect is quarantined from van.
   */
  async quarantineDefect(req, res) {
    try {
      const { vehicleId = 'VAN-01', sku, quantity, reason } = req.body || {};
      const qty = Math.round(Number(quantity) || 0);
      if (!sku || qty <= 0) {
        return res.status(400).json({ success: false, error: 'Valid SKU and positive quantity required.' });
      }

      const current = await prisma.vanInventory.findUnique({
        where: { vanId_skuId: { vanId: vehicleId, skuId: sku } },
      });

      const newQty = current ? Math.max(0, current.quantity - qty) : 0;
      const updated = await prisma.vanInventory.upsert({
        where: { vanId_skuId: { vanId: vehicleId, skuId: sku } },
        update: { quantity: newQty },
        create: { vanId: vehicleId, skuId: sku, quantity: 0 },
      });

      return res.status(200).json({
        success: true,
        message: 'Defect quarantined and perpetual inventory decremented.',
        data: updated,
      });
    } catch (error) {
      console.error('[vanStockController.quarantineDefect] Error quarantining defect:', error);
      return res.status(500).json({ success: false, error: 'Failed to quarantine defect from van inventory.' });
    }
  },

  /**
   * POST /api/van-stock/return (Perpetual Inventory Return to Warehouse)
   * Decrements quantity in VanInventory when stock is returned to central warehouse.
   */
  async returnToWarehouse(req, res) {
    try {
      const { vehicleId = 'VAN-01', sku, quantity } = req.body || {};
      const qty = Math.round(Number(quantity) || 0);
      if (!sku || qty <= 0) {
        return res.status(400).json({ success: false, error: 'Valid SKU and positive quantity required.' });
      }

      const current = await prisma.vanInventory.findUnique({
        where: { vanId_skuId: { vanId: vehicleId, skuId: sku } },
      });

      const newQty = current ? Math.max(0, current.quantity - qty) : 0;
      const updated = await prisma.vanInventory.upsert({
        where: { vanId_skuId: { vanId: vehicleId, skuId: sku } },
        update: { quantity: newQty },
        create: { vanId: vehicleId, skuId: sku, quantity: 0 },
      });

      return res.status(200).json({
        success: true,
        message: 'Stock returned to warehouse and perpetual inventory decremented.',
        data: updated,
      });
    } catch (error) {
      console.error('[vanStockController.returnToWarehouse] Error returning to warehouse:', error);
      return res.status(500).json({ success: false, error: 'Failed to return stock to warehouse.' });
    }
  },
  },
};

export default vanStockController;

