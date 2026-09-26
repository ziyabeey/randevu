import { bytesToBase64Url, randomBase64Url, textToBase64Url, base64UrlToText } from '../shared/base64.ts';

export type ZernioWhatsappEnv = {
  ZERNIO_API_KEY?: string;
  ZERNIO_WHATSAPP_ACCOUNT_ID?: string;
  ZERNIO_WHATSAPP_TEMPLATE_NAME?: string;
  ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE?: string;
  PUBLIC_BOOKING_GATE_SECRET?: string;
};

export type VerifySendResult =
  | { status: 'sent'; providerMessageId: string; conversationId: string }
  | { status: 'failed'; errorClass: string; retryable: boolean; retryAfterSeconds?: number };

const ZERNIO_ROOT = 'https://zernio.com/api/v1';
const REQUEST_TIMEOUT_MS = 10_000;
const PROOF_TTL_SECONDS = 10 * 60;
const OTP_TTL_SECONDS = 10 * 60;

function clean(value: string | undefined) {
  const result = value?.trim() ?? '';
  return result || null;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function retryAfter(response: Response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(600, Math.floor(seconds));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(1, Math.min(600, Math.ceil((at - Date.now()) / 1000))) : undefined;
}

async function jsonWithTimeout(url: string, init: RequestInit, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let data: Record<string, unknown> | null = null;
    try { data = raw ? JSON.parse(raw) as Record<string, unknown> : null; }
    catch { data = null; }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

async function hmac(secret: string, purpose: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}|${value}`)),
  ));
}

async function phoneHash(phone: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(phone));
  return bytesToBase64Url(new Uint8Array(digest));
}

// Per-phone OTP rate key: an HMAC of the normalized number, so the database
// budget never stores a reversible phone number.
export async function whatsappPhoneRateKey(secret: string, phone: string) {
  const normalized = normalizeWhatsappPhone(phone);
  if (secret.trim().length < 43 || !normalized) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`public-booking-phone|${normalized}`)));
  return [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeWhatsappPhone(value: string) {
  const compact = value.replace(/[\s()-]/g, '');
  const digits = compact.replace(/^\+/, '');
  if (/^90(5\d{9})$/.test(digits)) return `+${digits}`;
  if (/^0(5\d{9})$/.test(digits)) return `+90${digits.slice(1)}`;
  if (/^5\d{9}$/.test(digits)) return `+90${digits}`;
  return null;
}

export function zernioWhatsappConfigured(env: ZernioWhatsappEnv) {
  const apiKey = clean(env.ZERNIO_API_KEY);
  const accountId = clean(env.ZERNIO_WHATSAPP_ACCOUNT_ID);
  const templateName = clean(env.ZERNIO_WHATSAPP_TEMPLATE_NAME);
  const templateLanguage = clean(env.ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE) ?? 'tr';

  if (!apiKey || !/^sk_[0-9a-f]{64}$/i.test(apiKey)) return null;
  if (!accountId || !/^[0-9a-f]{24}$/i.test(accountId)) return null;
  if (!templateName || !/^[a-z0-9_]{1,128}$/.test(templateName)) return null;
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(templateLanguage)) return null;

  return { apiKey, accountId, templateName, templateLanguage };
}

export function generateWhatsappOtpCode() {
  const bucket = new Uint32Array(1);
  crypto.getRandomValues(bucket);
  return String((bucket[0] ?? 0) % 1_000_000).padStart(6, '0');
}

export async function sendWhatsappVerificationCode(
  env: ZernioWhatsappEnv,
  phone: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifySendResult> {
  const config = zernioWhatsappConfigured(env);
  const normalized = normalizeWhatsappPhone(phone);
  if (!config || !normalized || !/^\d{6}$/.test(code)) {
    return { status: 'failed', errorClass: 'zernio_whatsapp_not_configured_or_invalid_phone', retryable: false };
  }

  try {
    const { response, data } = await jsonWithTimeout(
      `${ZERNIO_ROOT}/inbox/conversations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          accountId: config.accountId,
          participantId: normalized.slice(1),
          templateName: config.templateName,
          templateLanguage: config.templateLanguage,
          templateParams: [code],
        }),
      },
      fetchImpl,
    );

    const nested = data?.data && typeof data.data === 'object'
      ? data.data as Record<string, unknown>
      : null;
    const providerMessageId = typeof nested?.messageId === 'string' ? nested.messageId.trim() : '';
    const conversationId = typeof nested?.conversationId === 'string' ? nested.conversationId.trim() : '';
    if (response.ok && providerMessageId && conversationId) {
      return { status: 'sent', providerMessageId, conversationId };
    }

    const rawCode = typeof data?.code === 'number' || typeof data?.code === 'string'
      ? String(data.code)
      : `http_${response.status}`;
    return {
      status: 'failed',
      errorClass: `zernio_whatsapp_${rawCode}`.slice(0, 120),
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      retryAfterSeconds: retryAfter(response),
    };
  } catch (error) {
    return {
      status: 'failed',
      errorClass: error instanceof DOMException && error.name === 'AbortError'
        ? 'zernio_whatsapp_send_timeout'
        : 'zernio_whatsapp_send_network_error',
      retryable: true,
    };
  }
}

export async function issueWhatsappOtpChallenge(
  secret: string,
  slug: string,
  phone: string,
  code: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (secret.trim().length < 43 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) || !/^\d{6}$/.test(code)) return null;
  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized) return null;

  const nonce = randomBase64Url(16);
  const normalizedSlug = slug.toLowerCase();
  const payload = {
    v: 1,
    slug: normalizedSlug,
    phoneHash: await phoneHash(normalized),
    exp: nowSeconds + OTP_TTL_SECONDS,
    nonce,
    codeMac: await hmac(
      secret.trim(),
      'whatsapp-otp-code',
      `${normalizedSlug}|${normalized}|${nonce}|${code}`,
    ),
  };
  const encoded = textToBase64Url(JSON.stringify(payload));
  return `${encoded}.${await hmac(secret.trim(), 'whatsapp-otp-challenge', encoded)}`;
}

export async function verifyWhatsappOtpChallenge(
  secret: string,
  token: string,
  slug: string,
  phone: string,
  code: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (secret.trim().length < 43 || token.length > 4096 || !/^\d{6}$/.test(code)) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded = '', signature = ''] = parts;
  if (!safeEqual(signature, await hmac(secret.trim(), 'whatsapp-otp-challenge', encoded))) return false;

  let payload: {
    v?: unknown;
    slug?: unknown;
    phoneHash?: unknown;
    exp?: unknown;
    nonce?: unknown;
    codeMac?: unknown;
  };
  try { payload = JSON.parse(base64UrlToText(encoded)) as typeof payload; }
  catch { return false; }

  const normalized = normalizeWhatsappPhone(phone);
  const normalizedSlug = slug.toLowerCase();
  if (!normalized || payload.v !== 1 || payload.slug !== normalizedSlug) return false;
  if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || payload.exp < nowSeconds || payload.exp > nowSeconds + OTP_TTL_SECONDS) return false;
  if (typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(payload.nonce)) return false;
  if (payload.phoneHash !== await phoneHash(normalized) || typeof payload.codeMac !== 'string') return false;

  const expectedCodeMac = await hmac(
    secret.trim(),
    'whatsapp-otp-code',
    `${normalizedSlug}|${normalized}|${payload.nonce}|${code}`,
  );
  return safeEqual(payload.codeMac, expectedCodeMac);
}

export async function issueWhatsappPhoneProof(
  secret: string,
  slug: string,
  phone: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (secret.trim().length < 43 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return null;
  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized) return null;
  const payload = {
    v: 1,
    slug: slug.toLowerCase(),
    phoneHash: await phoneHash(normalized),
    exp: nowSeconds + PROOF_TTL_SECONDS,
    nonce: randomBase64Url(16),
  };
  const encoded = textToBase64Url(JSON.stringify(payload));
  return `${encoded}.${await hmac(secret.trim(), 'whatsapp-phone-proof', encoded)}`;
}

export async function verifyWhatsappPhoneProof(
  secret: string,
  token: string,
  slug: string,
  phone: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (secret.trim().length < 43 || token.length > 2048) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded = '', signature = ''] = parts;
  if (!safeEqual(signature, await hmac(secret.trim(), 'whatsapp-phone-proof', encoded))) return false;

  let payload: { v?: unknown; slug?: unknown; phoneHash?: unknown; exp?: unknown; nonce?: unknown };
  try { payload = JSON.parse(base64UrlToText(encoded)) as typeof payload; }
  catch { return false; }

  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized || payload.v !== 1 || payload.slug !== slug.toLowerCase()) return false;
  if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || payload.exp < nowSeconds || payload.exp > nowSeconds + PROOF_TTL_SECONDS) return false;
  if (typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(payload.nonce)) return false;
  return payload.phoneHash === await phoneHash(normalized);
}
