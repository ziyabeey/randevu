import { bytesToBase64Url, randomBase64Url, textToBase64Url, base64UrlToText } from '../shared/base64.ts';

export type TwilioVerifyEnv = {
  TWILLO_ID?: string;
  TWILLO_SECRET_API?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
  PUBLIC_BOOKING_GATE_SECRET?: string;
};

export type VerifyStartResult =
  | { status: 'pending'; verificationSid: string }
  | { status: 'failed'; errorClass: string; retryable: boolean; retryAfterSeconds?: number };

export type VerifyCheckResult =
  | { status: 'approved' }
  | { status: 'pending' | 'failed'; errorClass?: string; retryable?: boolean };

const VERIFY_ROOT = 'https://verify.twilio.com/v2';
const REQUEST_TIMEOUT_MS = 10_000;
const PROOF_TTL_SECONDS = 10 * 60;

function clean(value: string | undefined) {
  const result = value?.trim() ?? '';
  return result || null;
}

function basicAuth(username: string, password: string) {
  const raw = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
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

export function normalizeWhatsappPhone(value: string) {
  const compact = value.replace(/[\s()-]/g, '');
  const digits = compact.replace(/^\+/, '');
  if (/^90(5\d{9})$/.test(digits)) return `+${digits}`;
  if (/^0(5\d{9})$/.test(digits)) return `+90${digits.slice(1)}`;
  if (/^5\d{9}$/.test(digits)) return `+90${digits}`;
  return null;
}

export function twilioVerifyConfigured(env: TwilioVerifyEnv) {
  const accountSid = clean(env.TWILLO_ID);
  const authToken = clean(env.TWILLO_SECRET_API);
  const serviceSid = clean(env.TWILIO_VERIFY_SERVICE_SID);
  if (!accountSid || !/^AC[0-9a-fA-F]{32}$/.test(accountSid)) return null;
  if (!authToken || authToken.length < 16 || authToken.length > 256) return null;
  if (!serviceSid || !/^VA[0-9a-fA-F]{32}$/.test(serviceSid)) return null;
  return { accountSid, authToken, serviceSid };
}

export async function startWhatsappVerification(
  env: TwilioVerifyEnv,
  phone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyStartResult> {
  const config = twilioVerifyConfigured(env);
  const normalized = normalizeWhatsappPhone(phone);
  if (!config || !normalized) {
    return { status: 'failed', errorClass: 'whatsapp_verify_not_configured_or_invalid_phone', retryable: false };
  }

  const form = new URLSearchParams({ To: normalized, Channel: 'whatsapp' });
  try {
    const { response, data } = await jsonWithTimeout(
      `${VERIFY_ROOT}/Services/${config.serviceSid}/Verifications`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuth(config.accountSid, config.authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      },
      fetchImpl,
    );

    const sid = typeof data?.sid === 'string' ? data.sid.trim() : '';
    const status = typeof data?.status === 'string' ? data.status.trim().toLowerCase() : '';
    if (response.ok && /^VE[0-9a-fA-F]{32}$/.test(sid) && status === 'pending') {
      return { status: 'pending', verificationSid: sid };
    }

    const code = typeof data?.code === 'number' || typeof data?.code === 'string'
      ? String(data.code) : `http_${response.status}`;
    return {
      status: 'failed',
      errorClass: `twilio_verify_${code}`.slice(0, 120),
      retryable: response.status === 429 || response.status >= 500,
      retryAfterSeconds: retryAfter(response),
    };
  } catch (error) {
    return {
      status: 'failed',
      errorClass: error instanceof DOMException && error.name === 'AbortError'
        ? 'twilio_verify_start_timeout'
        : 'twilio_verify_start_network_error',
      retryable: true,
    };
  }
}

export async function checkWhatsappVerification(
  env: TwilioVerifyEnv,
  phone: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyCheckResult> {
  const config = twilioVerifyConfigured(env);
  const normalized = normalizeWhatsappPhone(phone);
  if (!config || !normalized || !/^\d{4,10}$/.test(code)) {
    return { status: 'failed', errorClass: 'whatsapp_verify_invalid_check', retryable: false };
  }

  const form = new URLSearchParams({ To: normalized, Code: code });
  try {
    const { response, data } = await jsonWithTimeout(
      `${VERIFY_ROOT}/Services/${config.serviceSid}/VerificationCheck`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuth(config.accountSid, config.authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      },
      fetchImpl,
    );

    const status = typeof data?.status === 'string' ? data.status.trim().toLowerCase() : '';
    if (response.ok && status === 'approved') return { status: 'approved' };
    if (response.ok && status === 'pending') return { status: 'pending' };

    const codeValue = typeof data?.code === 'number' || typeof data?.code === 'string'
      ? String(data.code) : `http_${response.status}`;
    return {
      status: 'failed',
      errorClass: `twilio_verify_check_${codeValue}`.slice(0, 120),
      retryable: response.status === 429 || response.status >= 500,
    };
  } catch (error) {
    return {
      status: 'failed',
      errorClass: error instanceof DOMException && error.name === 'AbortError'
        ? 'twilio_verify_check_timeout'
        : 'twilio_verify_check_network_error',
      retryable: true,
    };
  }
}

async function phoneHash(phone: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(phone));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function signProof(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`whatsapp-phone-proof|${payload}`)),
  ));
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
  return `${encoded}.${await signProof(secret.trim(), encoded)}`;
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
  const expected = await signProof(secret.trim(), encoded);
  if (!safeEqual(signature, expected)) return false;

  let payload: { v?: unknown; slug?: unknown; phoneHash?: unknown; exp?: unknown; nonce?: unknown };
  try { payload = JSON.parse(base64UrlToText(encoded)) as typeof payload; }
  catch { return false; }

  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized || payload.v !== 1 || payload.slug !== slug.toLowerCase()) return false;
  if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || payload.exp < nowSeconds || payload.exp > nowSeconds + PROOF_TTL_SECONDS) return false;
  if (typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(payload.nonce)) return false;
  return payload.phoneHash === await phoneHash(normalized);
}
