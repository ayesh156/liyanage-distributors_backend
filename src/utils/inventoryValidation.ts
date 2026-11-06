import { AppError } from './appError.ts';

const MAX_SIGNATURE_SIZE_BYTES = 1.5 * 1024 * 1024; // 1.5 MB

/**
 * Validates a positive number (> 0)
 */
export function validatePositiveNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    throw new AppError(`${fieldName} must be a positive number greater than 0.`, 400);
  }
  return num;
}

/**
 * Validates a non-negative number (>= 0)
 */
export function validateNonNegativeNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    throw new AppError(`${fieldName} cannot be negative.`, 400);
  }
  return num;
}

/**
 * Validates a non-zero number (!= 0)
 */
export function validateNonZeroNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num === 0) {
    throw new AppError(`${fieldName} cannot be zero.`, 400);
  }
  return num;
}

/**
 * Validates a Base64 data URL signature string
 */
export function validateSignatureDataUrl(signatureData: unknown, fieldName: string = 'Signature'): string {
  if (typeof signatureData !== 'string' || !signatureData.trim()) {
    throw new AppError(`${fieldName} is required and must be a valid Base64 image data URL.`, 400);
  }

  const trimmed = signatureData.trim();
  if (!trimmed.startsWith('data:image/')) {
    throw new AppError(`${fieldName} must start with data:image/ (e.g. data:image/png;base64,...).`, 400);
  }

  // Check approximate payload size in bytes
  const base64Index = trimmed.indexOf(';base64,');
  if (base64Index === -1) {
    throw new AppError(`${fieldName} must be a base64-encoded image data URL.`, 400);
  }

  const base64Part = trimmed.slice(base64Index + 8);
  const approximateSizeBytes = (base64Part.length * 3) / 4;
  if (approximateSizeBytes > MAX_SIGNATURE_SIZE_BYTES) {
    throw new AppError(`${fieldName} size exceeds maximum allowed limit of 1.5MB.`, 400);
  }

  return trimmed;
}

/**
 * Validates string non-empty
 */
export function validateNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${fieldName} is required and cannot be empty.`, 400);
  }
  return value.trim();
}

