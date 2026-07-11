import prisma from '../config/prisma.js';
import authService from '../services/authService.js';

const cookieSecure = process.env.NODE_ENV === 'production';

const authController = {
  async login(req, res) {
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
      res.status(error.status || 500).json({
        success: false,
        error: error.message || 'Login failed',
      });
    }
  },

  async me(req, res) {
    try {
      const token = authService.extractToken(req);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
      }

      const decoded = authService.verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found',
        });
      }

      return res.json({
        success: true,
        data: authService.toSafeUser(user),
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
  },
};

export default authController;
