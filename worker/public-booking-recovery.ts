import { Hono } from 'hono';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';

type Env = PublicAbuseEnv & {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1?: string;
};
type SupabaseError = { message?: string };
type PublicConfirmation = {
  appointment_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  service_name: string;
  staff_name: string;
  price_minor: number;
  currency: string;
  recovery_expires_at: string;
};
type RecoveryRow = {
  appointment_id: string;
  business_name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  service_name: string;
  staff_name: string;
  price_minor: number;
  currency: string;
  management_token_ciphertext: string;
  management_token_iv: string;
  key_version: number;
  recovery_expires_at: string;
};

const bookingRecovery = new Hono<{ Bindings: Env }>();
const AAD_PREFIX = 'public-booking-recovery:v1|';

async function supabaseRequest<T>(env: Env, path: string, init: RequestInit): Promise<{ ok: boolean; data: T | null }> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY}`);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/${path}`, { ...init, headers });
    const text = await response.text();
    if (!text) return { ok: response.ok, data: null };
    try { return { ok: response.ok, data: JSON.parse(text) as T }; }
    catch { return { ok: response.ok, data: null }; }
  } catch {
    return { ok: false, data: null };
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function first<T>(items: T[] | null): T | null { return items?.[0] ?? null; }
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}
function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function validSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}
function validIdempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
}
function cleanOptional(value: unknown, max: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result.length <= max ? (result || null) : undefined;
}
function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function encryptionKey(env: Env) {
  const raw = env.MANAGEMENT_LINK_ENCRYPTION_KEY_V1?.trim();
  if (!raw) return null;
  try {
    const bytes = base64UrlToBytes(raw);
    if (bytes.length !== 32) return null;
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}
async function encryptManagementToken(env: Env, token: string, recoveryId: string) {
  const key = await encryptionKey(env);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${AAD_PREFIX}${recoveryId}`) },
    key,
    new TextEncoder().encode(token),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv),
    keyVersion: 1,
  };
}
async function decryptManagementToken(env: Env, row: RecoveryRow, recoveryId: string) {
  if (row.key_version !== 1) return null;
  const key = await encryptionKey(env);
  if (!key) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(row.management_token_iv),
        additionalData: new TextEncoder().encode(`${AAD_PREFIX}${recoveryId}`),
      },
      key,
      base64UrlToBytes(row.management_token_ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

function rpcError(data: unknown, fallback: string) {
  const retryAfter = rateLimitFromRpcError(data);
  if (retryAfter) {
    return {
      code: 'PUBLIC_BOOKING_RATE_LIMITED',
      message: `Çok fazla istek yapıldı. ${retryAfter} saniye sonra tekrar deneyin.`,
      status: 429 as const,
      retryAfter,
    };
  }
  const message = typeof data === 'object' && data !== null ? String((data as SupabaseError).message ?? '') : '';
  if (message.includes('PUBLIC_BOOKING_GATE_UNAVAILABLE') || message.includes('PUBLIC_BOOKING_GATE_INVALID_PROOF')) {
    return { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Rezervasyon güvenlik kontrolü şu anda hazır değil.', status: 503 as const };
  }
  if (message.includes('PUBLIC_BOOKING_NOT_FOUND') || message.includes('PUBLIC_BOOKING_DISABLED')) {
    return { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.', status: 404 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir rezervasyon için kullanılmış.', status: 409 as const };
  }
  if (message.includes('APPOINTMENT_CONFLICT') || message.includes('SLOT_UNAVAILABLE')) {
    return { code: 'SLOT_UNAVAILABLE', message: 'Bu saat az önce doldu. Lütfen başka bir saat seçin.', status: 409 as const };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { code: 'DATE_OUT_OF_RANGE', message: 'Seçilen tarih rezervasyon aralığının dışında.', status: 400 as const };
  }
  if (message.includes('PUBLIC_CONTACT_REQUIRED')) {
    return { code: 'PUBLIC_CONTACT_REQUIRED', message: 'Telefon veya e-posta bilgilerinden en az biri gerekli.', status: 400 as const };
  }
  if (message.includes('INVALID_CUSTOMER') || message.includes('NOTES_TOO_LONG') || message.includes('INVALID_START') || message.includes('INVALID_BOOKING_RECOVERY_BOOTSTRAP')) {
    return { code: 'INVALID_PUBLIC_BOOKING', message: 'Rezervasyon bilgileri geçerli değil.', status: 400 as const };
  }
  return { code: 'BOOKING_RESULT_UNKNOWN', message: fallback, status: 503 as const };
}

function errorResponse(context: any, error: ReturnType<typeof rpcError>) {
  if ('retryAfter' in error && error.retryAfter) {
    const response = context.json(publicRateLimitedBody(error.retryAfter), 429);
    response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

bookingRecovery.post('/business/:slug/book', async (context) => {
  const slug = context.req.param('slug');
  const key = validIdempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context.req.raw);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 500);
  const managementToken = body?.managementToken;
  const recoveryId = body?.recoveryId;
  const recoverySecret = body?.recoverySecret;

  if (!validSlug(slug) || !key || !validSecret(managementToken) || !validUuid(recoveryId) || !validSecret(recoverySecret)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_BOOKING', message: 'Rezervasyon isteği geçerli değil.' } }, 400);
  }
  if (customerName.length < 2 || customerName.length > 120
      || customerPhone === undefined || customerEmail === undefined || notes === undefined
      || (customerPhone === null && customerEmail === null)
      || (customerEmail !== null && !customerEmail.includes('@'))
      || !validUuid(body?.serviceId) || !validUuid(body?.staffId) || !validTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_BOOKING', message: 'Ad, iletişim, hizmet veya saat bilgileri geçerli değil.' } }, 400);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const encrypted = await encryptManagementToken(context.env, managementToken, recoveryId);
  if (!encrypted) {
    return context.json({ error: { code: 'BOOKING_RECOVERY_UNAVAILABLE', message: 'Rezervasyon güvenli olarak hazırlanamadı. Lütfen tekrar deneyin.' } }, 503);
  }

  const [managementTokenHash, recoverySecretHash] = await Promise.all([
    sha256Hex(managementToken),
    sha256Hex(recoverySecret),
  ]);

  const result = await supabaseRequest<PublicConfirmation[]>(context.env, 'rest/v1/rpc/create_public_appointment_with_recovery_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_slug: slug,
      p_idempotency_key: key,
      p_customer_name: customerName,
      p_service_id: body.serviceId,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
      p_management_token_hash: managementTokenHash,
      p_recovery_id: recoveryId,
      p_recovery_secret_hash: recoverySecretHash,
      p_management_token_ciphertext: encrypted.ciphertext,
      p_management_token_iv: encrypted.iv,
      p_key_version: encrypted.keyVersion,
      p_gate_secret: abuse.gateSecret,
      p_actor_hash: abuse.actorHash,
      p_network_hash: abuse.networkHash,
      p_customer_phone: customerPhone,
      p_customer_email: customerEmail,
      p_notes: notes,
    }),
  });

  if (!result.ok) {
    return errorResponse(context, rpcError(result.data, 'Rezervasyon sonucunuz doğrulanamadı. Aynı işlemle sonucu kontrol edin.'));
  }

  const appointment = first(result.data);
  if (!appointment) {
    return context.json({ error: { code: 'BOOKING_RESULT_UNKNOWN', message: 'Rezervasyon sonucunuz doğrulanamadı. Aynı işlemle sonucu kontrol edin.' } }, 503);
  }

  return context.json({
    appointment,
    management: { url: `/m#${encodeURIComponent(managementToken)}` },
    recovery: { expiresAt: appointment.recovery_expires_at },
  }, 201);
});

bookingRecovery.post('/booking/recover', async (context) => {
  const body = await readJson(context.req.raw);
  const recoveryId = body?.recoveryId;
  const key = typeof body?.idempotencyKey === 'string' ? validIdempotencyKey(body.idempotencyKey) : null;
  const recoverySecret = body?.recoverySecret;
  if (!validUuid(recoveryId) || !key || !validSecret(recoverySecret)) {
    return context.json({ error: { code: 'BOOKING_RECOVERY_NOT_FOUND', message: 'Randevu sonucu bulunamadı.' } }, 404);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const recoverySecretHash = await sha256Hex(recoverySecret);
  const result = await supabaseRequest<RecoveryRow[]>(context.env, 'rest/v1/rpc/recover_public_appointment_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_recovery_id: recoveryId,
      p_idempotency_key: key,
      p_recovery_secret_hash: recoverySecretHash,
      p_gate_secret: abuse.gateSecret,
      p_actor_hash: abuse.actorHash,
      p_network_hash: abuse.networkHash,
    }),
  });
  if (!result.ok) {
    const error = rpcError(result.data, 'Randevu sonucu bulunamadı.');
    if (error.status === 429 || error.status === 503) return errorResponse(context, error);
  }
  const row = result.ok ? first(result.data) : null;
  if (!row) {
    return context.json({ error: { code: 'BOOKING_RECOVERY_NOT_FOUND', message: 'Randevu sonucu bulunamadı.' } }, 404);
  }

  const managementToken = await decryptManagementToken(context.env, row, recoveryId);
  if (!managementToken || !validSecret(managementToken)) {
    return context.json({ error: { code: 'BOOKING_RECOVERY_UNAVAILABLE', message: 'Randevu bulundu ancak yönetim bağlantısı şu anda açılamıyor.' } }, 503);
  }

  return context.json({
    appointment: {
      appointment_id: row.appointment_id,
      business_name: row.business_name,
      status: row.status,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      timezone: row.timezone,
      service_name: row.service_name,
      staff_name: row.staff_name,
      price_minor: row.price_minor,
      currency: row.currency,
    },
    management: { url: `/m#${encodeURIComponent(managementToken)}` },
    recovery: { expiresAt: row.recovery_expires_at },
  });
});

export default bookingRecovery;
