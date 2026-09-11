import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  COOKIE_SECURE?: string;
};
type AppContext = Context<{ Bindings: Env }>;
type Role = 'owner' | 'manager' | 'staff';
type AuthUser = { id: string; email?: string };
type AuthSession = { accessToken: string; user: AuthUser };
type Membership = { id: string; business_id: string; role: Role; active: boolean };
type TokenResponse = { access_token: string; refresh_token: string; expires_in?: number; user: AuthUser };
type SupabaseError = { message?: string; code?: string; details?: string };

type Appointment = {
  id: string;
  business_id: string;
  customer_id: string;
  service_id: string;
  staff_id: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  customer_email_snapshot: string | null;
  service_name_snapshot: string;
  staff_name_snapshot: string;
  price_minor_snapshot: number;
  currency_snapshot: string;
  notes: string | null;
  cancellation_reason: string | null;
};

type Slot = { staff_id: string; staff_name: string; starts_at: string; ends_at: string; timezone: string };

const bookings = new Hono<{ Bindings: Env }>();

function cookieOptions(env: Env, maxAge: number) {
  return { httpOnly: true, secure: env.COOKIE_SECURE !== 'false', sameSite: 'Lax' as const, path: '/', maxAge };
}

function setSessionCookies(context: AppContext, token: TokenResponse) {
  setCookie(context, 'yzt_access', token.access_token, cookieOptions(context.env, Math.max(60, token.expires_in ?? 3600)));
  setCookie(context, 'yzt_refresh', token.refresh_token, cookieOptions(context.env, 60 * 60 * 24 * 30));
}

function clearSessionCookies(context: AppContext) {
  deleteCookie(context, 'yzt_access', { path: '/' });
  deleteCookie(context, 'yzt_refresh', { path: '/' });
  deleteCookie(context, 'yzt_business', { path: '/' });
}

async function supabaseRequest<T = unknown>(env: Env, path: string, init: RequestInit = {}, accessToken?: string) {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${accessToken ?? env.SUPABASE_ANON_KEY}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/${path}`, { ...init, headers });
  const text = await response.text();
  let data: T | null = null;
  if (text) {
    try { data = JSON.parse(text) as T; } catch { data = null; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function readJson(context: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await context.req.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function first<T>(items: T[] | null) { return items?.[0] ?? null; }
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
  const result = value.trim();
  return result.length <= max ? (result || null) : undefined;
}
function idempotencyKey(context: AppContext) {
  const value = context.req.header('Idempotency-Key')?.trim() ?? '';
  return value.length >= 8 && value.length <= 128 ? value : null;
}

async function resolveAuth(context: AppContext): Promise<AuthSession | null> {
  const accessToken = getCookie(context, 'yzt_access');
  const refreshToken = getCookie(context, 'yzt_refresh');
  if (accessToken) {
    const current = await supabaseRequest<AuthUser>(context.env, 'auth/v1/user', {}, accessToken);
    if (current.ok && current.data) return { accessToken, user: current.data };
  }
  if (!refreshToken) return null;
  const refreshed = await supabaseRequest<TokenResponse>(context.env, 'auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!refreshed.ok || !refreshed.data?.access_token || !refreshed.data.refresh_token || !refreshed.data.user) {
    clearSessionCookies(context); return null;
  }
  setSessionCookies(context, refreshed.data);
  return { accessToken: refreshed.data.access_token, user: refreshed.data.user };
}

async function activeMembership(context: AppContext, auth: AuthSession): Promise<Membership | null> {
  const businessId = getCookie(context, 'yzt_business');
  if (!businessId) return null;
  const query = new URLSearchParams({
    select: 'id,business_id,role,active', business_id: `eq.${businessId}`,
    user_id: `eq.${auth.user.id}`, active: 'eq.true', limit: '1',
  });
  const result = await supabaseRequest<Membership[]>(context.env, `rest/v1/memberships?${query}`, {}, auth.accessToken);
  return result.ok ? first(result.data) : null;
}

async function requireMember(context: AppContext) {
  const auth = await resolveAuth(context);
  if (!auth) return { error: context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401) } as const;
  const membership = await activeMembership(context, auth);
  if (!membership) return { error: context.json({ error: { code: 'TENANT_REQUIRED', message: 'Aktif işletme seçin.' } }, 403) } as const;
  return { auth, membership } as const;
}

function rpcMessage(data: unknown, fallback: string) {
  const message = typeof data === 'object' && data !== null ? String((data as SupabaseError).message ?? '') : '';
  if (message.includes('IDEMPOTENCY_CONFLICT')) return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir istek için zaten kullanılmış.', status: 409 as const };
  if (message.includes('APPOINTMENT_CONFLICT')) return { code: 'APPOINTMENT_CONFLICT', message: 'Bu saat az önce başka bir randevu tarafından alındı.', status: 409 as const };
  if (message.includes('SLOT_UNAVAILABLE')) return { code: 'SLOT_UNAVAILABLE', message: 'Seçilen saat artık müsait değil.', status: 409 as const };
  if (message.includes('APPOINTMENT_NOT_FOUND')) return { code: 'APPOINTMENT_NOT_FOUND', message: 'Randevu bulunamadı.', status: 404 as const };
  if (message.includes('APPOINTMENT_NOT_RESCHEDULABLE') || message.includes('INVALID_STATUS_TRANSITION')) return { code: 'INVALID_TRANSITION', message: 'Randevunun mevcut durumunda bu işlem yapılamaz.', status: 409 as const };
  if (message.includes('NOT_ALLOWED')) return { code: 'NOT_ALLOWED', message: 'Bu işletme için işlem yetkiniz yok.', status: 403 as const };
  return { code: 'BOOKING_FAILED', message: fallback, status: 400 as const };
}

bookings.get('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const params = new URLSearchParams({
    select: 'id,business_id,customer_id,service_id,staff_id,status,starts_at,ends_at,timezone,customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,service_name_snapshot,staff_name_snapshot,price_minor_snapshot,currency_snapshot,notes,cancellation_reason,created_at,updated_at',
    business_id: `eq.${access.membership.business_id}`,
    order: 'starts_at.asc',
    limit: '250',
  });
  const result = await supabaseRequest<Appointment[]>(context.env, `rest/v1/appointments?${params}`, {}, access.auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'BOOKINGS_READ_FAILED', message: 'Randevular okunamadı.' } }, 502);
  return context.json({ membership: access.membership, appointments: result.data ?? [] });
});

bookings.post('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context);
  const body = await readJson(context);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 1000);
  if (!key) return context.json({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'İşlem anahtarı eksik.' } }, 400);
  if (customerName.length < 2 || customerName.length > 120 || customerPhone === undefined || customerEmail === undefined || notes === undefined ||
      !isUuid(body?.serviceId) || !isUuid(body?.staffId) || !isTimestamp(body?.startsAt) ||
      (customerEmail !== null && !customerEmail.includes('@'))) {
    return context.json({ error: { code: 'INVALID_BOOKING', message: 'Müşteri, hizmet, personel veya saat bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Appointment | Appointment[]>(context.env, 'rest/v1/rpc/create_appointment', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_idempotency_key: key,
      p_customer_name: customerName,
      p_service_id: body.serviceId,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
      p_customer_phone: customerPhone,
      p_customer_email: customerEmail,
      p_notes: notes,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Randevu oluşturulamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const appointment = Array.isArray(result.data) ? first(result.data) : result.data;
  return context.json({ appointment }, 201);
});

bookings.get('/:id/reschedule-slots', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  const date = context.req.query('date');
  const staffRaw = context.req.query('staffId');
  const step = Number(context.req.query('step') ?? '15');
  const staffId = staffRaw && staffRaw !== 'any' ? staffRaw : null;
  if (!isUuid(appointmentId) || !isDate(date) || (staffId !== null && !isUuid(staffId)) || !Number.isInteger(step) || step < 5 || step > 120) {
    return context.json({ error: { code: 'INVALID_SLOT_QUERY', message: 'Tarih, personel veya slot adımı geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<Slot[]>(context.env, 'rest/v1/rpc/compute_reschedule_slots', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_appointment_id: appointmentId,
      p_date: date,
      p_staff_id: staffId,
      p_step_minutes: step,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Taşıma için uygun saatler hesaplanamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ slots: result.data ?? [] });
});

bookings.post('/:id/reschedule', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  const key = idempotencyKey(context);
  const body = await readJson(context);
  if (!isUuid(appointmentId) || !key || !isUuid(body?.staffId) || !isTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_RESCHEDULE', message: 'Yeni personel veya saat geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<Appointment | Appointment[]>(context.env, 'rest/v1/rpc/reschedule_appointment', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_appointment_id: appointmentId,
      p_idempotency_key: key,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Randevu taşınamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ appointment: Array.isArray(result.data) ? first(result.data) : result.data });
});

bookings.post('/:id/status', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  const key = idempotencyKey(context);
  const body = await readJson(context);
  const status = body?.status;
  const reason = cleanOptional(body?.reason, 240);
  if (!isUuid(appointmentId) || !key || !['confirmed','completed','no_show','cancelled'].includes(String(status)) || reason === undefined) {
    return context.json({ error: { code: 'INVALID_STATUS', message: 'Randevu durumu veya açıklama geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<Appointment | Appointment[]>(context.env, 'rest/v1/rpc/set_appointment_status', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_appointment_id: appointmentId,
      p_idempotency_key: key,
      p_status: status,
      p_reason: reason,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Randevu durumu güncellenemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ appointment: Array.isArray(result.data) ? first(result.data) : result.data });
});

bookings.get('/:id/events', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  if (!isUuid(appointmentId)) return context.json({ error: { code: 'INVALID_APPOINTMENT', message: 'Randevu kimliği geçerli değil.' } }, 400);
  const params = new URLSearchParams({
    select: 'id,event_type,actor_user_id,from_status,to_status,payload,created_at',
    business_id: `eq.${access.membership.business_id}`,
    appointment_id: `eq.${appointmentId}`,
    order: 'created_at.asc',
  });
  const result = await supabaseRequest<unknown[]>(context.env, `rest/v1/appointment_events?${params}`, {}, access.auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'EVENTS_READ_FAILED', message: 'Randevu geçmişi okunamadı.' } }, 502);
  return context.json({ events: result.data ?? [] });
});

export default bookings;
