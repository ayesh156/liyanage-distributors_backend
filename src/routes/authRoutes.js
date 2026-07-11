import { Router } from 'express';
import authController from '../controllers/authController.js';

const router = Router();

router.options('/login', (req, res) => res.sendStatus(204));
router.post('/login', authController.login);
router.get('/me', authController.me);

export default router;
