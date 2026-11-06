/**
 * @file settingsController.js
 * @description Settings Controller for vehicle profile management and physical image persistence.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../src/lib/prisma.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const settingsController = {
  /**
   * GET /api/settings/vehicle
   */
  async getVehicleProfile(req, res) {
    try {
      const vehicleId = req.query.vehicleId || 'VAN-01';
      const setting = await prisma.systemSetting.findUnique({
        where: { key: `VEHICLE_PROFILE_${vehicleId}` },
      });

      if (!setting) {
        return res.status(200).json({
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
      }

      const parsed = JSON.parse(setting.value);
      return res.status(200).json({
        success: true,
        data: parsed,
      });
    } catch (error) {
      console.error('[settingsController.getVehicleProfile] Error:', error);
      return res.status(500).json({
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
  async saveVehicleProfile(req, res) {
    try {
      const {
        id = 'VAN-01',
        plateNumber = 'WP KDK-4521',
        driver = 'Sunil Shantha',
        route = 'All Routes',
        warehouseLocation = 'Deiyandara Central Warehouse',
        vehicleImage,
      } = req.body;

      let storedImagePath = vehicleImage || null;

      // When the frontend saves the Vehicle Profile containing a Base64 image,
      // extract the Base64 payload, convert to binary Buffer, and write to filesystem.
      if (typeof vehicleImage === 'string' && vehicleImage.startsWith('data:image')) {
        const matches = vehicleImage.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        const base64Data = matches ? matches[2] : vehicleImage.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');

        // Target directory: Ensure nested public/images/van exists at backend root
        const targetDir = path.resolve(__dirname, '../public/images/van');
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

        // Relative URL path for frontend access
        storedImagePath = `/images/van/${filename}`;
      }

      const vehicleProfileData = {
        id: String(id).trim(),
        plateNumber: String(plateNumber).trim(),
        vehicleNumber: String(plateNumber).trim(),
        driver: String(driver).trim(),
        driverName: String(driver).trim(),
        route: route || 'All Routes',
        warehouseLocation: warehouseLocation || 'Deiyandara Central Warehouse',
        vehicleImage: storedImagePath,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.username || 'SYSTEM',
      };

      // Persist to SystemSetting key-value table
      await prisma.systemSetting.upsert({
        where: { key: `VEHICLE_PROFILE_${String(id).trim()}` },
        update: {
          value: JSON.stringify(vehicleProfileData),
          updatedBy: req.user?.username || 'SYSTEM',
        },
        create: {
          key: `VEHICLE_PROFILE_${String(id).trim()}`,
          value: JSON.stringify(vehicleProfileData),
          updatedBy: req.user?.username || 'SYSTEM',
        },
      });

      // Synchronize linked InventoryLocation
      try {
        await prisma.inventoryLocation.updateMany({
          where: { vehicleId: String(id).trim() },
          data: {
            vehicleNumber: String(plateNumber).trim(),
            driverName: String(driver).trim(),
          },
        });
      } catch (_locErr) {
        // Soft fail
      }

      return res.status(200).json({
        success: true,
        data: vehicleProfileData,
        message: 'Vehicle profile saved and image persisted physically to public/images/van/van_active.jpg',
      });
    } catch (error) {
      console.error('[settingsController.saveVehicleProfile] Error:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to persist vehicle profile and image',
      });
    }
  },
};

export default settingsController;

