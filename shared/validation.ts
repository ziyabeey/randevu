export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CANONICAL_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isCanonicalUuidV4(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && CANONICAL_UUID_V4_PATTERN.test(value);
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validName(value: unknown, minLength = 2, maxLength = 120): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength;
}

export function validCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim());
}

export function cleanOptional(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result.length <= maxLength ? (result || null) : undefined;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function integerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
