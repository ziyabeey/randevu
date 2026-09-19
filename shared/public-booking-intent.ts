import { base64UrlToBytes, bytesToBase64Url } from './base64.ts';

const V2_KEY_PATTERN = /^pub2_([1-9][0-9]{9})_([0-9a-f]{64})$/;
const V2_LOOKALIKE_PATTERN = /^\s*pub2_/i;
const CANONICAL_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INTENT_DOMAIN = 'yzt:public-booking:intent:v2';

export const PUBLIC_BOOKING_SUBMIT_WINDOW_SECONDS = 300;
export const PUBLIC_BOOKING_MAX_FUTURE_SECONDS = 330;

export function isCanonicalPublicBookingRecoveryId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && CANONICAL_UUID_V4_PATTERN.test(value);
}

export function isCanonicalPublicBookingSecret(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_SECRET_PATTERN.test(value)) return false;
  try {
    const bytes = base64UrlToBytes(value);
    return bytes.length === 32 && bytesToBase64Url(bytes) === value;
  } catch {
    return false;
  }
}

export function looksLikePublicBookingIntentV2(value: unknown): value is string {
  return typeof value === 'string' && V2_LOOKALIKE_PATTERN.test(value);
}

export function parsePublicBookingIntentV2Key(value: unknown) {
  if (typeof value !== 'string' || value.length !== 80) return null;
  const match = V2_KEY_PATTERN.exec(value);
  if (!match) return null;
  return { deadlineEpochSeconds: Number(match[1]), binding: match[2] };
}

export async function sha256Hex(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function derivePublicBookingIntentV2(
  recoveryId: string,
  deadlineEpochSeconds: number,
  recoverySecret: string,
) {
  if (!isCanonicalPublicBookingRecoveryId(recoveryId)
      || !Number.isInteger(deadlineEpochSeconds)
      || deadlineEpochSeconds < 1_000_000_000
      || deadlineEpochSeconds > 9_999_999_999
      || !isCanonicalPublicBookingSecret(recoverySecret)) {
    return null;
  }
  const secretHash = await sha256Hex(recoverySecret);
  const preimage = `${INTENT_DOMAIN}\n${recoveryId}\n${deadlineEpochSeconds}\n${secretHash}`;
  const binding = await sha256Hex(preimage);
  return {
    deadlineEpochSeconds,
    secretHash,
    idempotencyKey: `pub2_${deadlineEpochSeconds}_${binding}`,
  };
}

export async function verifyPublicBookingIntentV2(
  idempotencyKey: unknown,
  recoveryId: unknown,
  recoverySecret: unknown,
) {
  const parsed = parsePublicBookingIntentV2Key(idempotencyKey);
  if (!parsed
      || !isCanonicalPublicBookingRecoveryId(recoveryId)
      || !isCanonicalPublicBookingSecret(recoverySecret)) {
    return null;
  }
  const derived = await derivePublicBookingIntentV2(
    recoveryId,
    parsed.deadlineEpochSeconds,
    recoverySecret,
  );
  if (!derived || derived.idempotencyKey !== idempotencyKey) return null;
  return derived;
}
