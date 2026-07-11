import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'liyanage-distributors-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const signOptions = { expiresIn: JWT_EXPIRES_IN };

const toSafeUser = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  createdAt: user.createdAt,
});

const extractBearerToken = (authHeader = '') => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
};

const extractCookieToken = (cookieHeader = '') => {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const authService = {
  async login({ username, password }) {
    const normalizedUsername = String(username || '').trim();
    const normalizedPassword = String(password || '');

    if (!normalizedUsername || !normalizedPassword) {
      const error = new Error('Username and password are required');
      error.status = 400;
      throw error;
    }

    const user = await prisma.user.findUnique({
      where: { username: normalizedUsername },
    });

    if (!user) {
      const error = new Error('Invalid credentials');
      error.status = 401;
      throw error;
    }

    const passwordValid = await bcrypt.compare(normalizedPassword, user.password);
    if (!passwordValid) {
      const error = new Error('Invalid credentials');
      error.status = 401;
      throw error;
    }

    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      signOptions,
    );

    return {
      token,
      user: toSafeUser(user),
    };
  },

  verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
  },

  extractToken(req) {
    return (
      extractBearerToken(req.headers.authorization) ||
      extractCookieToken(req.headers.cookie) ||
      null
    );
  },

  toSafeUser,
};

export default authService;
