import express from 'express';
import { ManifestController } from '../controllers/manifest.controller.ts';
import { authMiddleware, adminOnly } from '../middlewares/authMiddleware.ts';

const router = express.Router();

// ── Authenticated Internal Endpoints ──
router.use(authMiddleware);
router.get('/daily', ManifestController.getDaily);
router.get('/history', ManifestController.getHistory);
router.post('/sign-owner', adminOnly, ManifestController.signByOwner);
router.post('/verify-rep', ManifestController.verifyByRep);
router.post('/sign', ManifestController.verifyByRep);
router.post('/reconcile-evening', ManifestController.reconcileEvening);
router.post('/toggle-item-check', ManifestController.toggleItemCheck);

// -- Unified In-App Saved Signatures Endpoints --
router.get('/saved-signatures', ManifestController.getSavedSignatures);
router.post('/saved-signatures', ManifestController.saveSignature);

export default router;

