import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response } from 'express';
import prisma from '../lib/prisma.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Settings Controller
 * Handles System Configuration, Vehicle Profile persistence, and Base64 image
 * binary conversion with physical disk storage in public/images/van/.
 */
export const settingsController = {
  /**
   * GET /api/settings
   * Fetches general company settings including report signature configurations.
   */
  async getCompanySettings(req: Request, res: Response): Promise<void> {
    try {
      let settings = null;
      try {
        settings = await (prisma as any).companySettings.findFirst({
          orderBy: { id: 'asc' },
        });
      } catch (_e) {
        // Fallback to key-value SystemSetting if table not yet migrated
      }

      if (!settings) {
        const fallback = await prisma.systemSetting.findUnique({
          where: { key: 'REPORT_SIGNATURE_SETTINGS' },
        });
        if (fallback) {
          const parsed = JSON.parse(fallback.value);
          res.status(200).json({
            success: true,
            data: {
              reportSignatureRole: parsed.reportSignatureRole || 'Driver',
              reportSignatureName: parsed.reportSignatureName || '',
            },
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: {
            reportSignatureRole: 'Driver',
            reportSignatureName: '',
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          ...settings,
          reportSignatureRole: settings.reportSignatureRole || 'Driver',
        },
      });
    } catch (error: any) {
      console.error('[SettingsController.getCompanySettings] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch company settings',
      });
    }
  },

  /**
   * PUT or PATCH /api/settings
   * Persists company settings including report signature role and name.
   */
  async updateCompanySettings(req: Request, res: Response): Promise<void> {
    try {
      const {
        reportSignatureRole = 'Driver',
        reportSignatureName = '',
        companyName = 'Liyanage Distributors',
      } = req.body;

      const payload = {
        reportSignatureRole: String(reportSignatureRole || 'Driver').trim(),
        reportSignatureName: String(reportSignatureName || '').trim(),
        companyName: String(companyName || 'Liyanage Distributors').trim(),
        updatedBy: req.user?.username || 'SYSTEM',
      };

      let record = null;
      try {
        const existing = await (prisma as any).companySettings.findFirst({
          orderBy: { id: 'asc' },
        });

        if (existing) {
          record = await (prisma as any).companySettings.update({
            where: { id: existing.id },
            data: payload,
          });
        } else {
          record = await (prisma as any).companySettings.create({
            data: payload,
          });
        }
      } catch (_e) {
        // Soft fallback
      }

      // Also persist to SystemSetting key-value as safe fallback
      await prisma.systemSetting.upsert({
        where: { key: 'REPORT_SIGNATURE_SETTINGS' },
        update: {
          value: JSON.stringify(payload),
          updatedBy: req.user?.username || 'SYSTEM',
        },
        create: {
          key: 'REPORT_SIGNATURE_SETTINGS',
          value: JSON.stringify(payload),
          updatedBy: req.user?.username || 'SYSTEM',
        },
      });

      res.status(200).json({
        success: true,
        data: record || payload,
        message: 'Company report signature settings updated successfully',
      });
    } catch (error: any) {
      console.error('[SettingsController.updateCompanySettings] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update company settings',
      });
    }
  },

  /**
   * GET /api/settings/vehicle
   * Fetches the current vehicle profile and active image path.
   */
  async getVehicleProfile(req: Request, res: Response): Promise<void> {
    try {
      const vehicleId = (req.query.vehicleId as string) || 'VAN-01';
      const setting = await prisma.systemSetting.findUnique({
        where: { key: `VEHICLE_PROFILE_${vehicleId}` },
      });

      if (!setting) {
        // Fallback default vehicle details
        res.status(200).json({
          success: true,
          data: {
            id: vehicleId,
            plateNumber: 'WP KDK-4521',
            driver: 'Sunil Shantha',
            route: 'All Routes',
            warehouseLocation: 'Deiyandara Central Warehouse',
            vehicleImage: '/images/van/van_active.jpg',
          },
        });
        return;
      }

      const parsed = JSON.parse(setting.value);
      res.status(200).json({
        success: true,
        data: parsed,
      });
    } catch (error: any) {
      console.error('[SettingsController.getVehicleProfile] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch vehicle profile',
      });
    }
  },

  /**
   * POST /api/settings/vehicle
   * Extracts Base64 image payload, writes binary Buffer to public/images/van/,
   * and persists relative URL path in database (SystemSetting & InventoryLocation).
   */
  async saveVehicleProfile(req: Request, res: Response): Promise<void> {
    try {
      const {
        id = 'VAN-01',
        plateNumber = 'WP KDK-4521',
        driver = 'Sunil Shantha',
        route = 'All Routes',
        warehouseLocation = 'Deiyandara Central Warehouse',
        vehicleImage,
      } = req.body;

      let storedImagePath: string | null = vehicleImage || null;

      // When the frontend saves the Vehicle Profile containing a Base64 image,
      // extract the Base64 payload, convert to binary Buffer, and write to filesystem.
      if (typeof vehicleImage === 'string' && vehicleImage.startsWith('data:image')) {
        const matches = vehicleImage.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        const base64Data = matches ? matches[2] : vehicleImage.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');

        // Target directory resolution: ensure nested public/images/van exists at backend root
        const targetDir = path.resolve(__dirname, '../../public/images/van');
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // Save physical binary file (e.g. van_active.jpg)
        const filename = 'van_active.jpg';
        const filePath = path.join(targetDir, filename);
        fs.writeFileSync(filePath, buffer);

        // Synchronize with alternate working directory if applicable
        try {
          const cwdTargetDir = path.resolve(process.cwd(), 'public/images/van');
          if (cwdTargetDir !== targetDir) {
            if (!fs.existsSync(cwdTargetDir)) {
              fs.mkdirSync(cwdTargetDir, { recursive: true });
            }
            fs.writeFileSync(path.join(cwdTargetDir, filename), buffer);
          }
        } catch (_syncErr) {}

        // Relative URL path for web access via static file middleware
        storedImagePath = `/images/van/${filename}`;
      }

      const vehicleProfileData = {
        id: id.trim(),
        plateNumber: plateNumber.trim(),
        vehicleNumber: plateNumber.trim(),
        driver: driver.trim(),
        driverName: driver.trim(),
        route: route || 'All Routes',
        warehouseLocation: warehouseLocation || 'Deiyandara Central Warehouse',
        vehicleImage: storedImagePath,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.username || 'SYSTEM',
      };

      // Persist to SystemSetting key-value table
      await prisma.systemSetting.upsert({
        where: { key: `VEHICLE_PROFILE_${id.trim()}` },
        update: {
          value: JSON.stringify(vehicleProfileData),
          updatedBy: req.user?.username || 'SYSTEM',
        },
        create: {
          key: `VEHICLE_PROFILE_${id.trim()}`,
          value: JSON.stringify(vehicleProfileData),
          updatedBy: req.user?.username || 'SYSTEM',
        },
      });

      // Synchronize linked InventoryLocation vehicle attributes
      try {
        await prisma.inventoryLocation.updateMany({
          where: { vehicleId: id.trim() },
          data: {
            vehicleNumber: plateNumber.trim(),
            driverName: driver.trim(),
          },
        });
      } catch (_locErr) {
        // Soft fail if location record does not yet exist
      }

      res.status(200).json({
        success: true,
        data: vehicleProfileData,
        message: 'Vehicle profile saved and image persisted physically to public/images/van/van_active.jpg',
      });
    } catch (error: any) {
      console.error('[SettingsController.saveVehicleProfile] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to persist vehicle profile and image',
      });
    }
  },
};

export default settingsController;

