import { Hono } from 'hono';
import { base64UrlToBytes, bytesToBase64Url } from '../shared/base64.ts';
import {
  readJson,
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';
import { publicOperation } from './public-rpc.ts';
import { hasRequiredPublicBookingInformation, type PublicBookingInformationProjection } from './public-booking-information.ts';
import { customerNotificationStatus } from '../shared/customer-notification-status.ts';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';
import {
  PUBLIC_BOOKING_MAX_FUTURE_SECONDS,
  isCanonicalPublicBookingRecoveryId,
  isCanonicalPublicBookingSecret,
  looksLikePublicBookingIntentV2,
  sha256Hex,
  verifyPublicBookingIntentV2,
} from '../shared/public-booking-intent.ts';

type Env = AuthEnv & PublicAbuseEnv & {
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1?: string;
};

type SupabaseError = { message?: string };
type GroupLine = { serviceId: string; staffId: string | null };
type NotificationPreferenceInput = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  reminderMinutesBefore: number | null;
};
type PublicGroupCreateRow = {
  appointment_id: string;
  group_payload: Record<string, unknown>;
  recovery_expires_at: string;
  notification_status?: unknown;
};

const groups = new Hono<{ Bindings: Env }>();
const GROUP_LINE_LIMIT = 10;
const AAD_PREFIX = 'public-booking-recovery:v1|';

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 60
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function cleanOptional(value: unknown, max: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned.length <= max ? (cleaned || null) : undefined;
}
function idempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
}
function parseNotificationPreference(value: unknown): NotificationPreferenceInput | null | undefined {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.emailEnabled !== 'boolean' || typeof raw.smsEnabled !== 'boolean') return undefined;
  const reminder = raw.reminderMinutesBefore === null || raw.reminderMinutesBefore === undefined
    ? null
    : Number(raw.reminderMinutesBefore);
  if (reminder !== null && (!Number.isInteger(reminder) || reminder < 15 || reminder > 10080)) {
    return undefined;
  }
  return {
    emailEnabled: raw.emailEnabled,
    smsEnabled: raw.smsEnabled,
    reminderMinutesBefore: reminder,
  };
}
function parseLines(value: unknown): GroupLine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > GROUP_LINE_LIMIT) return null;
  const lines: GroupLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (!isUuid(item.serviceId)) return null;
    const staffId = item.staffId === null || item.staffId === undefined
      || item.staffId === '' || item.staffId === 'any'
      ? null : item.staffId;
    if (staffId !== null && !isUuid(staffId)) return null;
    lines.push({ serviceId: item.serviceId, staffId });
  }
  return lines;
}
function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
}
function groupError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işletme için işlem yetkiniz yok.', status: 403 as const };
  }
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { code: 'SERVICE_NOT_FOUND', message: 'Seçilen hizmetlerden biri aktif değil veya bu işletmeye ait değil.', status: 404 as const };
  }
  if (message.includes('MIXED_CURRENCY')) {
    return { code: 'MIXED_CURRENCY', message: 'Aynı rezervasyondaki hizmetler tek para birimi kullanmalıdır.', status: 409 as const };
  }
  if (message.includes('GROUP_LINE_LIMIT_EXCEEDED')) {
    return { code: 'GROUP_LINE_LIMIT_EXCEEDED', message: `Bir rezervasyonda en fazla ${GROUP_LINE_LIMIT} hizmet seçilebilir.`, status: 409 as const };
  }
  if (message.includes('GROUP_SLOT_BUDGET_EXCEEDED')) {
    return { code: 'GROUP_SLOT_BUDGET_EXCEEDED', message: 'Bu arama güvenli hesaplama sınırını aşıyor.', status: 409 as const };
  }
  if (message.includes('GROUP_SLOT_UNAVAILABLE') || message.includes('APPOINTMENT_CONFLICT')) {
    return { code: 'GROUP_SLOT_UNAVAILABLE', message: 'Seçilen hizmetler bu saatte artık birlikte planlanamıyor.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir rezervasyon için kullanılmış.', status: 409 as const };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { code: 'DATE_OUT_OF_RANGE', message: 'Seçilen tarih rezervasyon aralığının dışında.', status: 400 as const };
  }
  if (message.includes('INVALID_NOTIFICATION_PREFERENCE') || message.includes('INVALID_REMINDER_OFFSET')) {
    return { code: 'INVALID_NOTIFICATION_PREFERENCE', message: 'Bildirim tercihleri geçerli değil.', status: 400 as const };
  }
  return { code: 'GROUP_BOOKING_FAILED', message: 'Grup rezervasyonu işlenemedi.', status: 400 as const };
}
async function requireStandardMember(context: Parameters<typeof requireMember>[0]) {
  const access = await requireMember(context);
  if ('error' in access) return access;
  if (access.auth.passwordRecovery) {
    return {
      error: context.json({
        error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' },
      }, 403),
    } as const;
  }
  return access;
}

async function encryptionKey(env: Env) {
  const raw = env.MANAGEMENT_LINK_ENCRYPTION_KEY_V1?.trim();
  if (!raw) return null;
  try {
    const bytes = base64UrlToBytes(raw);
    if (bytes.length !== 32) return null;
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt']);
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

function publicFailure(data: unknown, fallback: string) {
  const retryAfter = rateLimitFromRpcError(data);
  if (retryAfter) return {
    code: 'PUBLIC_BOOKING_RATE_LIMITED',
    message: `Çok fazla istek yapıldı. ${retryAfter} saniye sonra tekrar deneyin.`,
    status: 429 as const,
    retryAfter,
  };
  const message = rpcMessage(data);
  if (message.includes('PUBLIC_BOOKING_NOT_FOUND') || message.includes('PUBLIC_BOOKING_DISABLED')) {
    return { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.', status: 404 as const };
  }
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { code: 'SERVICE_NOT_FOUND', message: 'Seçilen hizmetlerden biri aktif değil.', status: 404 as const };
  }
  if (message.includes('MIXED_CURRENCY')) {
    return { code: 'MIXED_CURRENCY', message: 'Aynı rezervasyondaki hizmetler tek para birimi kullanmalıdır.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir rezervasyon için kullanılmış.', status: 409 as const };
  }
  if (message.includes('GROUP_SLOT_UNAVAILABLE') || message.includes('APPOINTMENT_CONFLICT')) {
    return { code: 'GROUP_SLOT_UNAVAILABLE', message: 'Bu saat az önce doldu. Lütfen başka bir saat seçin.', status: 409 as const };
  }
  if (message.includes('GROUP_SLOT_BUDGET_EXCEEDED') || message.includes('GROUP_LINE_LIMIT_EXCEEDED')) {
    return { code: 'GROUP_LIMIT_EXCEEDED', message: 'Rezervasyon isteği güvenli hesaplama sınırını aşıyor.', status: 409 as const };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { code: 'DATE_OUT_OF_RANGE', message: 'Seçilen tarih rezervasyon aralığının dışında.', status: 400 as const };
  }
  if (message.includes('PUBLIC_CONTACT_REQUIRED')) {
    return { code: 'PUBLIC_CONTACT_REQUIRED', message: 'Telefon bilgisi zorunlu. E-posta isteğe bağlıdır.', status: 400 as const };
  }
  if (message.includes('INVALID_') || message.includes('BOOKING_INTENT_')) {
    return { code: 'INVALID_PUBLIC_BOOKING', message: 'Rezervasyon isteği geçerli değil.', status: 400 as const };
  }
  return { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: fallback, status: 503 as const };
}
function publicErrorResponse(context: any, error: ReturnType<typeof publicFailure>) {
  if ('retryAfter' in error && error.retryAfter) {
    const response = context.json(publicRateLimitedBody(error.retryAfter), 429);
    response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

groups.post('/availability/group-slots', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const body = await readJson(context);
  const date = body?.date;
  const lines = parseLines(body?.lines);
  const step = Number(body?.step ?? 15);
  if (!isDate(date) || lines === null || !Number.isInteger(step) || step < 5 || step > 120) {
    return context.json({ error: { code: 'INVALID_GROUP_SLOT_QUERY', message: 'Tarih, hizmet listesi veya slot adımı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Record<string, unknown>[]>(
    context.env,
    'rest/v1/rpc/compute_group_availability_slots',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_date: date,
        p_lines: lines,
        p_step_minutes: step,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_AVAILABILITY_UNAVAILABLE', message: 'Grup müsaitliği şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503);
    }
    const error = groupError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ slots: result.data ?? [] });
});

groups.post('/bookings/groups', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 1000);
  const lines = parseLines(body?.lines);
  const notifications = parseNotificationPreference(body?.notifications);
  if (!key || customerName.length < 2 || customerName.length > 120
      || customerPhone === undefined || customerEmail === undefined || notes === undefined
      || notifications === undefined
      || lines === null || !isTimestamp(body?.startsAt)
      || (customerEmail !== null && !customerEmail.includes('@'))) {
    return context.json({ error: { code: 'INVALID_BOOKING', message: 'Müşteri, hizmet listesi veya saat bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Record<string, unknown>>(
    context.env,
    notifications
      ? 'rest/v1/rpc/create_appointment_group_with_notifications'
      : 'rest/v1/rpc/create_appointment_group',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_idempotency_key: key,
        p_customer_name: customerName,
        p_lines: lines,
        p_starts_at: body.startsAt,
        p_customer_phone: customerPhone,
        p_customer_email: customerEmail,
        p_notes: notes,
        ...(notifications ? {
          p_email_enabled: notifications.emailEnabled,
          p_sms_enabled: notifications.smsEnabled,
          p_reminder_minutes_before: notifications.reminderMinutesBefore,
        } : {}),
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_BOOKING_UNAVAILABLE', message: 'Grup rezervasyonu şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503);
    }
    const error = groupError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ group: result.data }, 201);
});

groups.post('/public/business/:slug/group-slots', async (context) => {
  const slug = context.req.param('slug');
  const body = await readJson(context);
  const date = body?.date;
  const lines = parseLines(body?.lines);
  if (!isSlug(slug) || !isDate(date) || lines === null) {
    return context.json({ error: { code: 'INVALID_GROUP_SLOT_QUERY', message: 'Tarih veya hizmet listesi geçerli değil.' } }, 400);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const result = await publicOperation<Record<string, unknown>[]>(context.env, 'group_slots', {
    p_slug: slug,
    p_date: date,
    p_lines: lines,
  }, abuse);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Grup müsaitliği şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503);
    }
    return publicErrorResponse(context, publicFailure(result.data, 'Grup müsaitliği şu anda doğrulanamıyor.'));
  }
  return context.json({ slots: result.data ?? [] });
});

groups.post('/public/business/:slug/group-book', async (context) => {
  const slug = context.req.param('slug');
  const rawKey = context.req.header('Idempotency-Key');
  const key = idempotencyKey(rawKey);
  const body = await readJson(context);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 1000);
  const lines = parseLines(body?.lines);
  const recoveryId = body?.recoveryId;
  const recoverySecret = body?.recoverySecret;
  const managementToken = body?.managementToken;

  if (!isSlug(slug) || !key || !looksLikePublicBookingIntentV2(rawKey)
      || !isCanonicalPublicBookingRecoveryId(recoveryId)
      || !isCanonicalPublicBookingSecret(recoverySecret)
      || !isCanonicalPublicBookingSecret(managementToken)
      || customerName.length < 2 || customerName.length > 120
      || customerPhone === undefined || customerEmail === undefined || notes === undefined
      || (customerEmail !== null && !customerEmail.includes('@'))
      || lines === null || !isTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_BOOKING', message: 'Rezervasyon isteği geçerli değil.' } }, 400);
  }
  if (customerPhone === null) {
    return context.json({ error: { code: 'PUBLIC_CONTACT_REQUIRED', message: 'Telefon bilgisi zorunlu. E-posta isteğe bağlıdır.' } }, 400);
  }

  const proof = await verifyPublicBookingIntentV2(rawKey, recoveryId, recoverySecret);
  const now = Math.floor(Date.now() / 1000);
  if (!proof || proof.deadlineEpochSeconds > now + PUBLIC_BOOKING_MAX_FUTURE_SECONDS) {
    return context.json({ error: { code: 'INVALID_PUBLIC_BOOKING', message: 'Rezervasyon isteği geçerli değil.' } }, 400);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const encrypted = await encryptManagementToken(context.env, managementToken, recoveryId);
  if (!encrypted) {
    return context.json({ error: { code: 'BOOKING_RECOVERY_UNAVAILABLE', message: 'Rezervasyon güvenli olarak hazırlanamadı.' } }, 503);
  }
  const information = await publicOperation<PublicBookingInformationProjection[]>(context.env, 'profile', { p_slug: slug }, abuse);
  if (!information.ok) {
    return publicErrorResponse(context, publicFailure(information.data, 'Rezervasyon bilgilendirmeleri şu anda doğrulanamıyor.'));
  }
  const informationProfile = information.data?.[0];
  if (!informationProfile) {
    return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.' } }, 404);
  }
  if (!hasRequiredPublicBookingInformation(informationProfile)) {
    return context.json({ error: { code: 'PUBLIC_INFORMATION_REQUIRED', message: 'İşletme rezervasyon bilgilendirmelerini henüz tamamlamadı.' } }, 409);
  }

  const managementTokenHash = await sha256Hex(managementToken);

  const result = await publicOperation<PublicGroupCreateRow[]>(context.env, 'group_book', {
    p_slug: slug,
    p_idempotency_key: key,
    p_customer_name: customerName,
    p_lines: lines,
    p_starts_at: body.startsAt,
    p_management_token_hash: managementTokenHash,
    p_recovery_id: recoveryId,
    p_recovery_secret_hash: proof.secretHash,
    p_management_token_ciphertext: encrypted.ciphertext,
    p_management_token_iv: encrypted.iv,
    p_key_version: encrypted.keyVersion,
    p_customer_phone: customerPhone,
    p_customer_email: customerEmail,
    p_notes: notes,
  }, abuse);

  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Rezervasyon sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
    }
    return publicErrorResponse(context, publicFailure(result.data, 'Rezervasyon sonucu doğrulanamadı. Aynı işlem anahtarıyla tekrar deneyin.'));
  }
  const created = result.data?.[0];
  if (!created?.appointment_id || !created.group_payload || !created.recovery_expires_at) {
    return context.json({ error: { code: 'BOOKING_RESULT_UNKNOWN', message: 'Rezervasyon sonucu doğrulanamadı. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
  }

  return context.json({
    group: created.group_payload,
    appointmentId: created.appointment_id,
    notification: customerNotificationStatus(created.notification_status),
    management: { url: `/m#${encodeURIComponent(managementToken)}` },
    recovery: { expiresAt: created.recovery_expires_at },
  }, 201);
});

export default groups;
