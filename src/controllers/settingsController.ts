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

