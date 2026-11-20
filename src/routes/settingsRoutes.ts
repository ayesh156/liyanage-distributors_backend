import express from 'express';
import { settingsController } from '../controllers/settingsController.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = express.Router();

// General Company Settings & Report Signature Routes
router.get('/', settingsController.getCompanySettings);
router.put('/', adminOnly, settingsController.updateCompanySettings);
router.patch('/', adminOnly, settingsController.updateCompanySettings);

// Vehicle Profile & Physical Image Persistence Routes
router.get('/vehicle', settingsController.getVehicleProfile);
router.post('/vehicle', adminOnly, settingsController.saveVehicleProfile);
router.put('/vehicle', adminOnly, settingsController.saveVehicleProfile);

export default router;

