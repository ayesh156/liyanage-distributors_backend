import { Router } from 'express';
import { ManifestController } from '../controllers/manifest.controller.ts';
import { authMiddleware, adminOnly } from '../middlewares/authMiddleware.ts';

const router = Router();

// ── Public WhatsApp Field Manifest Verification Endpoints (Zero-Login) ──
router.get('/share/:manifestNo', ManifestController.getPublicShare);
router.post('/share/:manifestNo/verify', ManifestController.verifyPublicShare);

// ── Authenticated Internal Endpoints ──
router.get('/daily', authMiddleware, ManifestController.getDaily);
router.get('/history', authMiddleware, ManifestController.getHistory);
router.post('/sign-owner', authMiddleware, adminOnly, ManifestController.signByOwner);
router.post('/verify-rep', authMiddleware, ManifestController.verifyByRep);

export default router;

