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

type PublicSettings = {
  business_id: string;
  enabled: boolean;
  step_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
};
type PublicBusiness = {
  name: string;
  slug: string;
  timezone: string;
  local_date: string;
  max_date: string;
  step_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
};
type PublicService = {
  service_id: string;
  name: string;
  duration_minutes: number;
  price_minor: number;
  currency: string;
};
type PublicStaff = { staff_id: string; staff_name: string };
type PublicSlot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};
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
};

const publicBooking = new Hono<{ Bindings: Env }>();

function cookieOptions(env: Env, maxAge: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE !== 'false',
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
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

async function supabaseRequest<T = unknown>(
  env: Env,
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<{ ok: boolean; status: number; data: T | null }> {
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
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function first<T>(items: T[] | null): T | null { return items?.[0] ?? null; }
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
function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}
function integerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
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
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!refreshed.ok || !refreshed.data?.access_token || !refreshed.data.refresh_token || !refreshed.data.user) {
    clearSessionCookies(context);
    return null;
  }

  setSessionCookies(context, refreshed.data);
  return { accessToken: refreshed.data.access_token, user: refreshed.data.user };
}

async function activeMembership(context: AppContext, auth: AuthSession): Promise<Membership | null> {
  const businessId = getCookie(context, 'yzt_business');
  if (!businessId) return null;
  const query = new URLSearchParams({
    select: 'id,business_id,role,active',
    business_id: `eq.${businessId}`,
    user_id: `eq.${auth.user.id}`,
    active: 'eq.true',
    limit: '1',
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

function canManage(membership: Membership) {
  return membership.role === 'owner' || membership.role === 'manager';
}

function rpcError(data: unknown, fallback: string) {
  const message = typeof data === 'object' && data !== null ? String((data as SupabaseError).message ?? '') : '';
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
  if (message.includes('INVALID_CUSTOMER') || message.includes('NOTES_TOO_LONG') || message.includes('INVALID_START')) {
    return { code: 'INVALID_BOOKING', message: 'Rezervasyon bilgileri geçerli değil.', status: 400 as const };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.', status: 403 as const };
  }
  return { code: 'PUBLIC_BOOKING_FAILED', message: fallback, status: 400 as const };
}

// Authenticated business-side settings. Public booking is opt-in and manager-only mutable.
publicBooking.get('/settings', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const businessId = access.membership.business_id;

  const [business, settings] = await Promise.all([
    supabaseRequest<Array<{ id: string; name: string; slug: string; timezone: string }>>(
      context.env,
      `rest/v1/businesses?select=id,name,slug,timezone&id=eq.${businessId}&limit=1`,
      {},
      access.auth.accessToken,
    ),
    supabaseRequest<PublicSettings[]>(
      context.env,
      `rest/v1/public_booking_settings?select=business_id,enabled,step_minutes,min_notice_minutes,horizon_days&business_id=eq.${businessId}&limit=1`,
      {},
      access.auth.accessToken,
    ),
  ]);

  if (!business.ok || !settings.ok || !first(business.data) || !first(settings.data)) {
    return context.json({ error: { code: 'PUBLIC_SETTINGS_READ_FAILED', message: 'Public rezervasyon ayarları okunamadı.' } }, 502);
  }

  return context.json({
    membership: access.membership,
    business: first(business.data),
    settings: first(settings.data),
  });
});

publicBooking.put('/settings', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Public rezervasyon ayarlarını owner veya manager değiştirebilir.' } }, 403);
  }

  const body = await readJson(context);
  if (typeof body?.enabled !== 'boolean'
      || !integerIn(body?.stepMinutes, 5, 120)
      || !integerIn(body?.minNoticeMinutes, 0, 10080)
      || !integerIn(body?.horizonDays, 1, 366)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_SETTINGS', message: 'Public rezervasyon ayarları geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<PublicSettings | PublicSettings[]>(context.env, 'rest/v1/rpc/update_public_booking_settings', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_enabled: body.enabled,
      p_step_minutes: body.stepMinutes,
      p_min_notice_minutes: body.minNoticeMinutes,
      p_horizon_days: body.horizonDays,
    }),
  }, access.auth.accessToken);

  if (!result.ok) {
    const error = rpcError(result.data, 'Public rezervasyon ayarları kaydedilemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ settings: Array.isArray(result.data) ? first(result.data) : result.data });
});

// Everything below this point intentionally uses the anon Supabase key, not session cookies.
publicBooking.get('/business/:slug', async (context) => {
  const slug = context.req.param('slug');
  if (!isSlug(slug)) return context.json({ error: { code: 'NOT_FOUND', message: 'Rezervasyon bağlantısı bulunamadı.' } }, 404);

  const [business, services] = await Promise.all([
    supabaseRequest<PublicBusiness[]>(context.env, 'rest/v1/rpc/get_public_booking_business', {
      method: 'POST', body: JSON.stringify({ p_slug: slug }),
    }),
    supabaseRequest<PublicService[]>(context.env, 'rest/v1/rpc/get_public_booking_services', {
      method: 'POST', body: JSON.stringify({ p_slug: slug }),
    }),
  ]);
  const publicBusiness = business.ok ? first(business.data) : null;
  if (!publicBusiness) {
    return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.' } }, 404);
  }
  if (!services.ok) return context.json({ error: { code: 'PUBLIC_CATALOG_FAILED', message: 'Hizmetler yüklenemedi.' } }, 502);

  return context.json({ business: publicBusiness, services: services.data ?? [] });
});

publicBooking.get('/business/:slug/staff', async (context) => {
  const slug = context.req.param('slug');
  const serviceId = context.req.query('serviceId');
  if (!isSlug(slug) || !isUuid(serviceId)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_QUERY', message: 'Hizmet bilgisi geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<PublicStaff[]>(context.env, 'rest/v1/rpc/get_public_booking_staff', {
    method: 'POST', body: JSON.stringify({ p_slug: slug, p_service_id: serviceId }),
  });
  if (!result.ok) {
    const error = rpcError(result.data, 'Personel bilgileri yüklenemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ staff: result.data ?? [] });
});

publicBooking.get('/business/:slug/slots', async (context) => {
  const slug = context.req.param('slug');
  const serviceId = context.req.query('serviceId');
  const date = context.req.query('date');
  const staffRaw = context.req.query('staffId');
  const staffId = staffRaw && staffRaw !== 'any' ? staffRaw : null;
  if (!isSlug(slug) || !isUuid(serviceId) || !isDate(date) || (staffId !== null && !isUuid(staffId))) {
    return context.json({ error: { code: 'INVALID_PUBLIC_QUERY', message: 'Hizmet, tarih veya personel bilgisi geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<PublicSlot[]>(context.env, 'rest/v1/rpc/compute_public_booking_slots', {
    method: 'POST',
    body: JSON.stringify({ p_slug: slug, p_service_id: serviceId, p_date: date, p_staff_id: staffId }),
  });
  if (!result.ok) {
    const error = rpcError(result.data, 'Uygun saatler hesaplanamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ slots: result.data ?? [] });
});

publicBooking.post('/business/:slug/book', async (context) => {
  const slug = context.req.param('slug');
  const key = idempotencyKey(context);
  const body = await readJson(context);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 500);

  if (!isSlug(slug) || !key) {
    return context.json({ error: { code: 'INVALID_PUBLIC_BOOKING', message: 'Rezervasyon isteği geçerli değil.' } }, 400);
  }
  if (customerName.length < 2 || customerName.length > 120
      || customerPhone === undefined || customerEmail === undefined || notes === undefined
      || (customerPhone === null && customerEmail === null)
      || (customerEmail !== null && !customerEmail.includes('@'))
      || !isUuid(body?.serviceId) || !isUuid(body?.staffId) || !isTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_BOOKING', message: 'Ad, iletişim, hizmet veya saat bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<PublicConfirmation[]>(context.env, 'rest/v1/rpc/create_public_appointment', {
    method: 'POST',
    body: JSON.stringify({
      p_slug: slug,
      p_idempotency_key: key,
      p_customer_name: customerName,
      p_service_id: body.serviceId,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
      p_customer_phone: customerPhone,
      p_customer_email: customerEmail,
      p_notes: notes,
    }),
  });

  if (!result.ok) {
    const error = rpcError(result.data, 'Rezervasyon oluşturulamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }

  const confirmation = first(result.data);
  if (!confirmation) {
    return context.json({ error: { code: 'PUBLIC_BOOKING_FAILED', message: 'Rezervasyon sonucu alınamadı.' } }, 502);
  }
  return context.json({ appointment: confirmation }, 201);
});

export default publicBooking;
