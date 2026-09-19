import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { bytesToBase64Url } from '../shared/base64.ts';

export type PublicAbuseEnv = {
  PUBLIC_BOOKING_GATE_SECRET?: string;
  COOKIE_SECURE?: string;
};

type AbuseContext = Context<any>;

export type PublicAbuseIdentity = {
  gateSecret: string;
  actorHash: string;
  networkHash: string;
};

const COOKIE_NAME = 'yzt_public_client_v2';
const COOKIE_TTL_SECONDS = 60 * 60 * 24;

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validGateSecret(value: string | undefined) {
  const secret = value?.trim() ?? '';
  return secret.length >= 43 && secret.length <= 256 ? secret : null;
}

async function hmacBytes(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function hmacHex(secret: string, value: string) {
  return hex(await hmacBytes(secret, value));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function expandIpv6(value: string) {
  const lower = value.toLowerCase();
  if (!lower.includes(':')) return null;
  const [leftRaw, rightRaw = ''] = lower.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  if (!lower.includes('::') && left.length !== 8) return null;
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const parts = lower.includes('::')
    ? [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    : left;
  return parts.length === 8 ? parts.map((part) => part.padStart(4, '0')) : null;
}

function networkKey(ipRaw: string | undefined) {
  const ip = ipRaw?.trim() ?? '';
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.every((part) => part >= 0 && part <= 255)) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }
  }
  const ipv6 = expandIpv6(ip);
  if (ipv6) return `${ipv6.slice(0, 4).join(':')}::/64`;
  return 'unknown-network';
}

async function signClient(secret: string, clientId: string, expiresAt: number) {
  const payload = `v1.${clientId}.${expiresAt}`;
  const signature = bytesToBase64Url(await hmacBytes(secret, `public-booking-client|${payload}`));
  return `${payload}.${signature}`;
}

async function verifyClient(secret: string, value: string | undefined) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const clientId = parts[1] ?? '';
  const expiresAt = Number(parts[2]);
  const signature = parts[3] ?? '';
  if (!/^[A-Za-z0-9_-]{22}$/.test(clientId) || !Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  const expected = await signClient(secret, clientId, expiresAt);
  const expectedSignature = expected.split('.')[3] ?? '';
  return safeEqual(signature, expectedSignature) ? clientId : null;
}

async function issueClient(context: AbuseContext, secret: string) {
  const clientId = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const value = await signClient(secret, clientId, expiresAt);
  setCookie(context, COOKIE_NAME, value, {
    httpOnly: true,
    secure: context.env.COOKIE_SECURE !== 'false',
    sameSite: 'Lax',
    path: '/api',
    maxAge: COOKIE_TTL_SECONDS,
  });
  return clientId;
}

export async function resolvePublicAbuseIdentity(context: AbuseContext): Promise<PublicAbuseIdentity | null> {
  const gateSecret = validGateSecret(context.env.PUBLIC_BOOKING_GATE_SECRET);
  if (!gateSecret) return null;

  let clientId = await verifyClient(gateSecret, getCookie(context, COOKIE_NAME));
  if (!clientId) clientId = await issueClient(context, gateSecret);

  const network = networkKey(context.req.header('CF-Connecting-IP'));
  const [actorHash, networkHash] = await Promise.all([
    hmacHex(gateSecret, `public-booking-actor|${clientId}`),
    hmacHex(gateSecret, `public-booking-network|${network}`),
  ]);

  return { gateSecret, actorHash, networkHash };
}

export function rateLimitFromRpcError(data: unknown) {
  const message = typeof data === 'object' && data !== null
    ? String((data as { message?: string }).message ?? '')
    : '';
  const match = message.match(/PUBLIC_BOOKING_RATE_LIMITED:(\d+)/);
  if (!match) return null;
  const retryAfter = Math.max(1, Math.min(Number(match[1] ?? 1), 86400));
  return Number.isFinite(retryAfter) ? retryAfter : 1;
}

export function publicGateUnavailableBody() {
  return {
    error: {
      code: 'PUBLIC_BOOKING_UNAVAILABLE',
      message: 'Rezervasyon güvenlik kontrolü şu anda hazır değil. Lütfen biraz sonra tekrar deneyin.',
    },
  };
}

export function publicRateLimitedBody(retryAfter: number) {
  return {
    error: {
      code: 'PUBLIC_BOOKING_RATE_LIMITED',
      message: `Çok fazla istek yapıldı. ${retryAfter} saniye sonra tekrar deneyin.`,
      retryAfterSeconds: retryAfter,
    },
  };
}
