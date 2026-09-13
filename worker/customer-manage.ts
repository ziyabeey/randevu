import { publicOperation } from './public-rpc.ts';
import { Hono, type Context } from 'hono';
import { publicGateUnavailableBody, publicRateLimitedBody, rateLimitFromRpcError, resolvePublicAbuseIdentity, type PublicAbuseEnv } from './public-abuse.ts';

type Env = PublicAbuseEnv & {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};
type SupabaseError = { message?: string };
type ManagedAppointment = {
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
  can_reschedule?: boolean;
  can_cancel?: boolean;
  local_date?: string;
  max_date?: string;
};
type ManagedSlot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};

const customerManage = new Hono<{ Bindings: Env }>();


function first<T>(items: T[] | null): T | null {
  return items?.[0] ?? null;
}

function validToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 43
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function idempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
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

function rpcError(data: unknown, fallback: string) {
  const retryAfter = rateLimitFromRpcError(data);
  if (retryAfter) return { code: 'PUBLIC_BOOKING_RATE_LIMITED', message: 'Çok fazla istek yapıldı.', status: 429 as const, retryAfter };
  const message = typeof data === 'object' && data !== null ? String((data as SupabaseError).message ?? '') : '';
  if (message.includes('PUBLIC_BOOKING_GATE_') || message === 'PUBLIC_OPERATION_UNAVAILABLE') {
    return { code: 'MANAGEMENT_UNAVAILABLE', message: 'Randevu yönetimi şu anda kullanılamıyor. Lütfen tekrar deneyin.', status: 503 as const };
  }
  if (message.includes('MANAGEMENT_NOT_FOUND') || message.includes('INVALID_MANAGEMENT_TOKEN')) {
    return { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.', status: 404 as const };
  }
  if (message.includes('APPOINTMENT_NOT_MANAGEABLE')) {
    return { code: 'APPOINTMENT_NOT_MANAGEABLE', message: 'Bu randevu artık müşteri tarafından değiştirilemez.', status: 409 as const };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { code: 'DATE_OUT_OF_RANGE', message: 'Seçilen tarih izin verilen rezervasyon aralığının dışında.', status: 400 as const };
  }
  if (message.includes('SLOT_UNAVAILABLE') || message.includes('APPOINTMENT_CONFLICT')) {
    return { code: 'SLOT_UNAVAILABLE', message: 'Bu saat artık uygun değil. Başka bir saat seçin.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir değişiklik için kullanılmış.', status: 409 as const };
  }
  if (message.includes('REASON_TOO_LONG')) {
    return { code: 'INVALID_REASON', message: 'İptal nedeni çok uzun.', status: 400 as const };
  }
  return { code: 'MANAGEMENT_FAILED', message: fallback, status: 400 as const };
}

function errorResponse(context: Context<{ Bindings: Env }>, error: ReturnType<typeof rpcError>) {
  if ('retryAfter' in error && error.retryAfter) {
    context.header('Retry-After', String(error.retryAfter));
    return context.json(publicRateLimitedBody(error.retryAfter), 429);
  }
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

// The bearer token is always carried in a POST body, never in a URL path/query.
// This keeps it out of ordinary HTTP access logs. The browser page itself stores
// the capability in the URL fragment (`/m#token`), which is not sent to the server.
customerManage.post('/view', async (context) => {
  const body = await readJson(context.req.raw);
  const token = body?.token;
  if (!validToken(token)) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<ManagedAppointment[]>(context.env, 'manage_view', { p_token: token }, abuse);
  if (!result.ok) return errorResponse(context, rpcError(result.data, 'Randevu bilgisi alınamadı.'));
  const appointment = first(result.data);
  if (!appointment) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }
  return context.json({ appointment });
});

customerManage.post('/slots', async (context) => {
  const body = await readJson(context.req.raw);
  const token = body?.token;
  const date = body?.date;
  const staffRaw = body?.staffId;
  const staffId = staffRaw && staffRaw !== 'any' ? staffRaw : null;
  if (!validToken(token) || !validDate(date) || (staffId !== null && !validUuid(staffId))) {
    return context.json({ error: { code: 'INVALID_MANAGEMENT_QUERY', message: 'Tarih veya personel bilgisi geçerli değil.' } }, 400);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<ManagedSlot[]>(context.env, 'manage_slots', { p_token: token, p_date: date, p_staff_id: staffId }, abuse);
  if (!result.ok) {
    const error = rpcError(result.data, 'Uygun saatler hesaplanamadı.');
    return errorResponse(context, error);
  }
  return context.json({ slots: result.data ?? [] });
});

customerManage.post('/reschedule', async (context) => {
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context.req.raw);
  const token = body?.token;
  if (!validToken(token) || !key || !validUuid(body?.staffId) || !validTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_RESCHEDULE', message: 'Yeni randevu saati geçerli değil.' } }, 400);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<ManagedAppointment[]>(context.env, 'manage_reschedule', {
      p_token: token,
      p_idempotency_key: key,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
    }, abuse);
  if (!result.ok) {
    const error = rpcError(result.data, 'Randevu taşınamadı.');
    return errorResponse(context, error);
  }
  const appointment = first(result.data);
  if (!appointment) return context.json({ error: { code: 'MANAGEMENT_FAILED', message: 'Randevu sonucu alınamadı.' } }, 502);
  return context.json({ appointment });
});

customerManage.post('/cancel', async (context) => {
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context.req.raw);
  const token = body?.token;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!validToken(token) || !key || reason.length > 240) {
    return context.json({ error: { code: 'INVALID_CANCEL', message: 'İptal isteği geçerli değil.' } }, 400);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<ManagedAppointment[]>(context.env, 'manage_cancel', {
      p_token: token,
      p_idempotency_key: key,
      p_reason: reason || null,
    }, abuse);
  if (!result.ok) {
    const error = rpcError(result.data, 'Randevu iptal edilemedi.');
    return errorResponse(context, error);
  }
  const appointment = first(result.data);
  if (!appointment) return context.json({ error: { code: 'MANAGEMENT_FAILED', message: 'Randevu sonucu alınamadı.' } }, 502);
  return context.json({ appointment });
});

export default customerManage;
