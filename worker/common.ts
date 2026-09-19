import type { Context } from 'hono';

export type RpcError = {
  code?: string;
  message?: string;
  msg?: string;
  details?: string;
  hint?: string;
};

export function rpcErrorMessage(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    const err = data as RpcError;
    return String(err.message ?? err.msg ?? '');
  }
  return '';
}

export function dateInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function upstreamUnavailable(status: number): boolean {
  return status === 0 || status >= 500;
}

export function first<T>(items: T[] | null | undefined): T | null {
  return items?.[0] ?? null;
}

export function apiError(
  context: Context<any>,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 502 | 503 = 400,
  extra?: Record<string, unknown>,
) {
  return context.json({ error: { code, message, ...extra } }, status);
}
