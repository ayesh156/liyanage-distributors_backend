import type { NextFunction, Request, Response } from 'express';
import prisma from '../lib/prisma.ts';
import authService from '../services/authService.ts';

/**
 * Authenticates requests using the JWT access token.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = authService.extractToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.',
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
        error: 'Invalid token user',
      });
      return;
    }

    req.user = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };

    next();
  } catch (_error) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }
}
