import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError.js';
import { Prisma } from '@prisma/client';

/**
 * Handles Prisma's P2002 unique constraint violation error.
 */
function handlePrismaUniqueConstraintError(err: Prisma.PrismaClientKnownRequestError): AppError {
  const target = (err.meta?.target as string[]) ?? ['field'];
  const field = target.join(', ');
  const message = `A record with this ${field} already exists. Please use a different value.`;
  return new AppError(message, 409);
}

/**
 * Handles Prisma's P2025 "Record not found" error.
 */
function handlePrismaNotFoundError(err: Prisma.PrismaClientKnownRequestError): AppError {
  const modelName = (err.meta?.modelName as string) ?? 'Record';
  const message = `${modelName} not found. It may have been deleted or the provided ID is invalid.`;
  return new AppError(message, 404);
}

/**
 * Handles Prisma's P2003 foreign key constraint violation.
 */
function handlePrismaForeignKeyError(err: Prisma.PrismaClientKnownRequestError): AppError {
  const field = (err.meta?.field_name as string) ?? 'related record';
  const message = `Operation failed because this record is linked to a ${field} that does not exist.`;
  return new AppError(message, 409);
}

/**
 * Maps known Prisma error codes to user-friendly AppError instances.
 */
function handlePrismaError(err: Prisma.PrismaClientKnownRequestError): AppError {
  switch (err.code) {
    case 'P2002':
      return handlePrismaUniqueConstraintError(err);
    case 'P2025':
      return handlePrismaNotFoundError(err);
    case 'P2003':
      return handlePrismaForeignKeyError(err);
    default:
      console.error(`[PRISMA] Unhandled error code ${err.code}:`, err.message);
      return new AppError('A database error occurred. Please try again.', 500);
  }
}

/**
 * Global error handler middleware.
 *
 * Handles:
 * 1. AppError instances (known operational errors)
 * 2. Prisma client known request errors (P2002, P2025, P2003)
 * 3. Prisma validation errors
 * 4. JSON parse errors (malformed body)
 * 5. Generic/unexpected errors (sanitised in production)
 */
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let error: AppError;

  if (err instanceof AppError) {
    error = err;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    error = handlePrismaError(err);
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    error = new AppError('Invalid database query. Check your request data.', 400);
  } else if (err instanceof SyntaxError && 'body' in err) {
    error = new AppError('Invalid JSON payload. Please check your request body.', 400);
  } else if (err.name === 'ValidationError') {
    error = new AppError(err.message || 'Invalid input data.', 400);
  } else {
    const message =
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message || 'Internal server error';
    error = new AppError(message, 500);
    error.isOperational = false;
  }

  // Logging
  if (error.statusCode >= 500) {
    console.error(`[ERROR] ${error.statusCode} — ${error.message}`);
    if (!error.isOperational) {
      console.error(err.stack);
    }
  } else {
    console.warn(`[WARN] ${error.statusCode} — ${error.message}`);
  }

  // Response
  res.status(error.statusCode).json({
    success: false,
    error: error.message,
    status: error.status,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}