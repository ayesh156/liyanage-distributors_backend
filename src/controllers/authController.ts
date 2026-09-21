import type { Request, Response } from 'express';
import prisma from '../lib/prisma.ts';
import authService from '../services/authService.ts';

interface ControllerError extends Error {
  status?: number;
}

const cookieSecure = process.env.NODE_ENV === 'production';

// Handles authentication login and current-user endpoints.
const authController = {
  async login(req: Request, res: Response): Promise<void> {
    try {
      const result = await authService.login(req.body || {});

      res.cookie('auth_token', result.token, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      const controllerError = error as ControllerError;

      res.status(controllerError.status || 500).json({
        success: false,
        error: controllerError.message || 'Login failed',
      });
    }
  },

  async me(req: Request, res: Response): Promise<void> {
    try {
      const token = authService.extractToken(req);

      if (!token) {
        res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const decoded = authService.verifyToken(token);

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        res.status(401).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      res.json({
        success: true,
        data: authService.toSafeUser(user),
      });
    } catch (_error) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
  },
};

export default authController;
