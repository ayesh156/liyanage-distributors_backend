import { Router } from 'express';
import userController from '../controllers/userController.ts';

const userRoutes = Router();

/**
 * Self-service Profile Routes
 */
userRoutes.get('/profile', userController.getProfile);
userRoutes.put('/profile', userController.updateProfile);

/**
 * Staff & User Management Routes (Protected by authMiddleware in parent router)
 */
userRoutes.get('/', userController.listUsers);
userRoutes.post('/', userController.createUser);
userRoutes.put('/:id', userController.updateUser);
userRoutes.put('/:id/reset-password', userController.resetPassword);
userRoutes.delete('/:id', userController.deleteUser);

export default userRoutes;
