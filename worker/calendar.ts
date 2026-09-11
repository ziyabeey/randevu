import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  COOKIE_SECURE?: string;
};
type AppContext = Context<{ Bindings: Env }>;
type AuthUser = { id: string; email?: string };
type AuthSession = { accessToken: string; user: AuthUser };
type Membership = { id: string; business_id: string; role: 'owner' | 'manager' | 'staff'; active: boolean };
type TokenResponse = { access_token: string; refresh_token: string; expires_in?: number; user: AuthUser };
type SupabaseError = { message?: string };

type CalendarAppointment = {
  appointment_id: string;
  staff_id: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  service_name: string;
  staff_name: string;
  price_minor: number;
  currency: string;
  notes: string | null;
  cancellation_reason: string | null;
  source: 'operator' | 'public';
};

type Staff = { id: string; name: string; active: boolean };
type Business = { id: string; name: string; timezone: string };

const calendar = new Hono<{ Bindings: Env }>();

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

function first<T>(items: T[] | null) { return items?.[0] ?? null; }
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

function rpcError(data: unknown) {
  const message = typeof data === 'object' && data !== null ? String((data as SupabaseError).message ?? '') : '';
  if (message.includes('NOT_ALLOWED')) return { code: 'NOT_ALLOWED', message: 'Bu işletmenin takvimine erişiminiz yok.', status: 403 as const };
  if (message.includes('INVALID_CALENDAR_RANGE')) return { code: 'INVALID_CALENDAR_RANGE', message: 'Takvim tarih aralığı geçerli değil.', status: 400 as const };
  return { code: 'CALENDAR_READ_FAILED', message: 'Takvim yüklenemedi.', status: 502 as const };
}

calendar.get('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;

  const requestedDate = context.req.query('date');
  const days = Number(context.req.query('days') ?? '1');
  const staffRaw = context.req.query('staffId');
  const staffId = staffRaw && staffRaw !== 'all' ? staffRaw : null;
  if ((requestedDate !== undefined && !isDate(requestedDate))
      || !Number.isInteger(days) || (days !== 1 && days !== 7)
      || (staffId !== null && !isUuid(staffId))) {
    return context.json({ error: { code: 'INVALID_CALENDAR_RANGE', message: 'Takvim tarihi, görünümü veya personel filtresi geçerli değil.' } }, 400);
  }

  const businessId = access.membership.business_id;
  const businessQuery = new URLSearchParams({ select: 'id,name,timezone', id: `eq.${businessId}`, limit: '1' });
  const staffQuery = new URLSearchParams({ select: 'id,name,active', business_id: `eq.${businessId}`, order: 'name.asc' });
  const [businessResult, staffResult] = await Promise.all([
    supabaseRequest<Business[]>(context.env, `rest/v1/businesses?${businessQuery}`, {}, access.auth.accessToken),
    supabaseRequest<Staff[]>(context.env, `rest/v1/staff_profiles?${staffQuery}`, {}, access.auth.accessToken),
  ]);

  const business = businessResult.ok ? first(businessResult.data) : null;
  if (!business || !staffResult.ok) {
    return context.json({ error: { code: 'CALENDAR_CONTEXT_FAILED', message: 'Takvim işletme veya ekip bilgileri yüklenemedi.' } }, 502);
  }

  const localDate = dateInTimezone(business.timezone);
  const date = requestedDate ?? localDate;
  const appointmentsResult = await supabaseRequest<CalendarAppointment[]>(context.env, 'rest/v1/rpc/get_calendar_appointments', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: businessId,
      p_start_date: date,
      p_days: days,
      p_staff_id: staffId,
    }),
  }, access.auth.accessToken);

  if (!appointmentsResult.ok) {
    const error = rpcError(appointmentsResult.data);
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }

  return context.json({
    membership: access.membership,
    business,
    localDate,
    date,
    days,
    staff: staffResult.data ?? [],
    appointments: appointmentsResult.data ?? [],
  });
});

export default calendar;
