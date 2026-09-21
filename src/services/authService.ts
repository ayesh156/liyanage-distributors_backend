import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { Request } from 'express';
import prisma from '../lib/prisma.ts';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'liyanage-distributors-jwt-secret-change-in-production';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// JWT signing configuration for authentication tokens.
const signOptions: SignOptions = {
  expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'],
};

interface AuthServiceError extends Error {
  status?: number;
}

interface AuthTokenPayload extends JwtPayload {
  userId: string;
  username: string;
  role: string;
}

interface LoginInput {
  username: string;
  password: string;
}

const toSafeUser = (user: {
  id: string;
  username: string;
  role: string;
  createdAt: Date;
}) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  createdAt: user.createdAt,
});

const extractBearerToken = (authHeader = ''): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice(7).trim() || null;
};

const extractCookieToken = (cookieHeader = ''): string | null => {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const authService = {
  async login({ username, password }: LoginInput) {
    const normalizedUsername = String(username || '').trim();
    const normalizedPassword = String(password || '');

    if (!normalizedUsername || !normalizedPassword) {
      const error: AuthServiceError = new Error(
        'Username and password are required',
      );
      error.status = 400;
      throw error;
    }

    const user = await prisma.user.findUnique({
      where: { username: normalizedUsername },
    });

    if (!user) {
      const error: AuthServiceError = new Error('Invalid credentials');
      error.status = 401;
      throw error;
    }

    const passwordValid = await bcrypt.compare(
      normalizedPassword,
      user.password,
    );

    if (!passwordValid) {
      const error: AuthServiceError = new Error('Invalid credentials');
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

  verifyToken(token: string): AuthTokenPayload {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.username !== 'string' ||
      typeof decoded.role !== 'string'
    ) {
      throw new Error('Invalid token payload');
    }

    return decoded as AuthTokenPayload;
  },

  extractToken(req: Request): string | null {
    return (
      extractBearerToken(req.headers.authorization) ||
      extractCookieToken(req.headers.cookie) ||
      null
    );
  },

  toSafeUser,
};

export default authService;
