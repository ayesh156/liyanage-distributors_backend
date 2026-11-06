import { Router } from 'express';
import { settingsController } from '../controllers/settingsController.ts';
import { adminOnly } from '../middlewares/authMiddleware.ts';

const router = Router();

// Vehicle Profile & Physical Image Persistence Routes
router.get('/vehicle', settingsController.getVehicleProfile);
router.post('/vehicle', adminOnly, settingsController.saveVehicleProfile);
router.put('/vehicle', adminOnly, settingsController.saveVehicleProfile);

export default router;

