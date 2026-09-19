import { ApiRequestError } from './api.ts';

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function isRetryableApiError(error: unknown): boolean {
  return error instanceof ApiRequestError
    && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}
