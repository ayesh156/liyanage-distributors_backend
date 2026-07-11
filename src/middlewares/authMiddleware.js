import prisma from '../config/prisma.js';
import authService from '../services/authService.js';

export async function authMiddleware(req, res, next) {
  try {
    const token = authService.extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.',
      });
    }

    const decoded = authService.verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token user',
      });
    }

    req.user = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };

    return next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }
}
