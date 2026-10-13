import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.ts';
import authService from '../services/authService.ts';

/**
 * Controller for User Management and Profile Settings.
 * Handles self-service profile updates and administrative staff management.
 */
const userController = {
  /**
   * GET /api/users/profile
   * Returns current authenticated user's profile details.
   */
  async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const currentUserId = req.user?.userId;
      if (!currentUserId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: currentUserId },
      });

      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      res.json({
        success: true,
        data: authService.toSafeUser(user),
      });
    } catch (error: any) {
      console.error('[userController.getProfile]', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch profile' });
    }
  },

  /**
   * PUT /api/users/profile
   * Updates the authenticated user's profile (username, name, email, and optionally password).
   */
  async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const currentUserId = req.user?.userId;
      if (!currentUserId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { username, name, email, currentPassword, newPassword } = req.body || {};

      const existingUser = await prisma.user.findUnique({
        where: { id: currentUserId },
      });

      if (!existingUser) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      const updateData: {
        username?: string;
        name?: string;
        email?: string;
        password?: string;
      } = {};

      // Validate and update username if changed
      if (username && username.trim() !== existingUser.username) {
        const cleanUsername = username.trim().toLowerCase();
        if (cleanUsername.length < 3) {
          res.status(400).json({ success: false, error: 'Username must be at least 3 characters long' });
          return;
        }

        const duplicate = await prisma.user.findUnique({
          where: { username: cleanUsername },
        });

        if (duplicate && duplicate.id !== currentUserId) {
          res.status(409).json({ success: false, error: 'Username is already taken' });
          return;
        }

        updateData.username = cleanUsername;
      }

      if (name !== undefined) {
        updateData.name = name ? String(name).trim() : null as any;
      }

      if (email !== undefined) {
        updateData.email = email ? String(email).trim() : null as any;
      }

      // Password change verification
      if (newPassword) {
        if (!currentPassword) {
          res.status(400).json({ success: false, error: 'Current password is required to set a new password' });
          return;
        }

        const isMatch = await bcrypt.compare(currentPassword, existingUser.password);
        if (!isMatch) {
          res.status(400).json({ success: false, error: 'Incorrect current password' });
          return;
        }

        if (String(newPassword).length < 6) {
          res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
          return;
        }

        updateData.password = await bcrypt.hash(String(newPassword), 12);
      }

      const updatedUser = await prisma.user.update({
        where: { id: currentUserId },
        data: updateData,
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: authService.toSafeUser(updatedUser),
      });
    } catch (error: any) {
      console.error('[userController.updateProfile]', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to update profile' });
    }
  },

  /**
   * GET /api/users
   * Lists all staff and administrative users.
   */
  async listUsers(_req: Request, res: Response): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        data: users.map(authService.toSafeUser),
      });
    } catch (error: any) {
      console.error('[userController.listUsers]', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch users' });
    }
  },

  /**
   * POST /api/users
   * Creates a new staff or admin user.
   */
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { username, password, name, email, role = 'STAFF', status = 'ACTIVE' } = req.body || {};

      if (!username || !password) {
        res.status(400).json({ success: false, error: 'Username and password are required' });
        return;
      }

      const cleanUsername = String(username).trim().toLowerCase();
      if (cleanUsername.length < 3) {
        res.status(400).json({ success: false, error: 'Username must be at least 3 characters long' });
        return;
      }

      if (String(password).length < 6) {
        res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
        return;
      }

      const existing = await prisma.user.findUnique({
        where: { username: cleanUsername },
      });

      if (existing) {
        res.status(409).json({ success: false, error: 'Username already exists' });
        return;
      }

      const hashedPassword = await bcrypt.hash(String(password), 12);

      const newUser = await prisma.user.create({
        data: {
          username: cleanUsername,
          password: hashedPassword,
          name: name ? String(name).trim() : null,
          email: email ? String(email).trim() : null,
          role: String(role).toUpperCase(),
          status: String(status).toUpperCase(),
        },
      });

      res.status(201).json({
        success: true,
        message: 'Staff account created successfully',
        data: authService.toSafeUser(newUser),
      });
    } catch (error: any) {
      console.error('[userController.createUser]', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to create user' });
    }
  },

  /**
   * PUT /api/users/:id
   * Updates an existing user's information, role, or status.
   */
  async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const { name, email, role, status, password } = req.body || {};

      const existing = await prisma.user.findUnique({
        where: { id },
      });

      if (!existing) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name ? String(name).trim() : null;
      if (email !== undefined) updateData.email = email ? String(email).trim() : null;
      if (role !== undefined) updateData.role = String(role).toUpperCase();
      if (status !== undefined) updateData.status = String(status).toUpperCase();
      if (password && String(password).trim().length >= 6) {
        updateData.password = await bcrypt.hash(String(password).trim(), 12);
      }

      const updated = await prisma.user.update({
        where: { id },
        data: updateData,
      });

      res.json({
        success: true,
        message: 'User updated successfully',
        data: authService.toSafeUser(updated),
      });
    } catch (error: any) {
      console.error('[userController.updateUser]', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to update user' });
    }
  },

  /**
   * PUT /api/users/:id/reset-password
   * Directly resets a staff member's password.
   */
  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const { newPassword } = req.body || {};

      if (!newPassword || String(newPassword).length < 6) {
        res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      const hashedPassword = await bcrypt.hash(String(newPassword), 12);
      await prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
      });

      res.json({
        success: true,
        message: 'Password reset successfully',
      });
    } catch (error: any) {
      console.error('[userController.resetPassword]', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to reset password' });
    }
  },

  /**
   * DELETE /api/users/:id
   * Removes a staff user account. Protects against self-deletion.
   */
  async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const currentUserId = req.user?.userId;

      if (id === currentUserId) {
        res.status(400).json({ success: false, error: 'You cannot delete your own account' });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      // Check if this is the last ADMIN
      if (existing.role === 'ADMIN') {
        const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
        if (adminCount <= 1) {
          res.status(400).json({ success: false, error: 'Cannot delete the last remaining Administrator' });
          return;
        }
      }

      await prisma.user.delete({ where: { id } });

      res.json({
        success: true,
        message: 'User deleted successfully',
      });
    } catch (error: any) {
      console.error('[userController.deleteUser]', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to delete user' });
    }
  },
};

export default userController;
