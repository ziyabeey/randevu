import { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  COOKIE_SECURE?: string;
};

type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string };
};

type AuthSession = {
  accessToken: string;
  user: AuthUser;
};

type Membership = {
  id: string;
  business_id: string;
  role: 'owner' | 'manager' | 'staff';
  active: boolean;
};

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (context, next) => {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  await next();
});

function cookieOptions(env: Env, maxAge: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE !== 'false',
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}

function setSessionCookies(context: AppContext, accessToken: string, refreshToken: string, expiresIn = 3600) {
  setCookie(context, 'yzt_access', accessToken, cookieOptions(context.env, Math.max(60, expiresIn)));
  setCookie(context, 'yzt_refresh', refreshToken, cookieOptions(context.env, 60 * 60 * 24 * 30));
}

function clearSessionCookies(context: AppContext) {
  deleteCookie(context, 'yzt_access', { path: '/' });
  deleteCookie(context, 'yzt_refresh', { path: '/' });
  deleteCookie(context, 'yzt_business', { path: '/' });
}

async function supabaseRequest<T>(
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
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

async function readJson(context: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await context.req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function resolveAuth(context: AppContext): Promise<AuthSession | null> {
  const currentAccess = getCookie(context, 'yzt_access');
  const refreshToken = getCookie(context, 'yzt_refresh');

  if (currentAccess) {
    const current = await supabaseRequest<AuthUser>(context.env, 'auth/v1/user', {}, currentAccess);
    if (current.ok && current.data) return { accessToken: currentAccess, user: current.data };
  }

  if (!refreshToken) return null;

  const refreshed = await supabaseRequest<{
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    user: AuthUser;
  }>(context.env, 'auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!refreshed.ok || !refreshed.data?.access_token || !refreshed.data.refresh_token || !refreshed.data.user) {
    clearSessionCookies(context);
    return null;
  }

  setSessionCookies(
    context,
    refreshed.data.access_token,
    refreshed.data.refresh_token,
    refreshed.data.expires_in,
  );

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
  return result.ok && result.data?.length ? result.data[0] : null;
}

function canManage(membership: Membership | null) {
  return membership?.role === 'owner' || membership?.role === 'manager';
}

function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function validName(value: unknown) {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120;
}

function integerIn(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

app.get('/api/health', (context) => context.json({ status: 'ok', service: 'yzt-randevu', phase: 3 }));

app.post('/api/auth/signup', async (context) => {
  const body = await readJson(context);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  if (!email.includes('@') || password.length < 8) {
    return context.json({ error: { code: 'INVALID_SIGNUP', message: 'Geçerli e-posta ve en az 8 karakter parola gerekli.' } }, 400);
  }

  const result = await supabaseRequest<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: AuthUser;
  }>(context.env, 'auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, data: { full_name: fullName || undefined } }),
  });

  if (!result.ok || !result.data) {
    return context.json({ error: { code: 'SIGNUP_FAILED', message: 'Kayıt oluşturulamadı.' } }, 400);
  }

  if (result.data.access_token && result.data.refresh_token) {
    setSessionCookies(context, result.data.access_token, result.data.refresh_token, result.data.expires_in);
  }

  return context.json({ ok: true, requiresEmailConfirmation: !result.data.access_token }, 201);
});

app.post('/api/auth/login', async (context) => {
  const body = await readJson(context);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const result = await supabaseRequest<{
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    user: AuthUser;
  }>(context.env, 'auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!result.ok || !result.data?.access_token || !result.data.refresh_token) {
    return context.json({ error: { code: 'LOGIN_FAILED', message: 'E-posta veya parola doğrulanamadı.' } }, 401);
  }

  setSessionCookies(context, result.data.access_token, result.data.refresh_token, result.data.expires_in);
  return context.json({ ok: true });
});

app.post('/api/auth/logout', async (context) => {
  const auth = await resolveAuth(context);
  if (auth) await supabaseRequest(context.env, 'auth/v1/logout', { method: 'POST' }, auth.accessToken);
  clearSessionCookies(context);
  return context.json({ ok: true });
});

app.get('/api/session', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ user: null, memberships: [], activeBusinessId: null });

  const query = new URLSearchParams({
    select: 'id,business_id,role,active,businesses(id,name,slug,timezone)',
    user_id: `eq.${auth.user.id}`,
    active: 'eq.true',
    order: 'created_at.asc',
  });
  const memberships = await supabaseRequest<unknown[]>(context.env, `rest/v1/memberships?${query}`, {}, auth.accessToken);
  const activeBusinessId = getCookie(context, 'yzt_business') ?? null;

  return context.json({
    user: { id: auth.user.id, email: auth.user.email ?? null, fullName: auth.user.user_metadata?.full_name ?? null },
    memberships: memberships.ok && memberships.data ? memberships.data : [],
    activeBusinessId,
  });
});

app.post('/api/businesses', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const body = await readJson(context);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const timezone = typeof body?.timezone === 'string' ? body.timezone.trim() : 'Europe/Istanbul';
  const slug = typeof body?.slug === 'string' && body.slug.trim() ? slugify(body.slug) : slugify(name);
  if (!validName(name) || !slug) {
    return context.json({ error: { code: 'INVALID_BUSINESS', message: 'İşletme adı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Array<{ id: string; name: string; slug: string; timezone: string; role: string }>>(
    context.env,
    'rest/v1/rpc/create_business_with_owner',
    { method: 'POST', body: JSON.stringify({ p_name: name, p_slug: slug, p_timezone: timezone }) },
    auth.accessToken,
  );
  if (!result.ok || !result.data?.[0]) {
    return context.json({ error: { code: 'BUSINESS_CREATE_FAILED', message: 'İşletme oluşturulamadı. Slug kullanımda olabilir.' } }, 400);
  }
  setCookie(context, 'yzt_business', result.data[0].id, cookieOptions(context.env, 60 * 60 * 24 * 30));
  return context.json({ business: result.data[0] }, 201);
});

app.post('/api/businesses/select', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const body = await readJson(context);
  const businessId = typeof body?.businessId === 'string' ? body.businessId : '';
  const query = new URLSearchParams({
    select: 'id,business_id,role,active',
    business_id: `eq.${businessId}`,
    user_id: `eq.${auth.user.id}`,
    active: 'eq.true',
    limit: '1',
  });
  const result = await supabaseRequest<Membership[]>(context.env, `rest/v1/memberships?${query}`, {}, auth.accessToken);
  if (!result.ok || !result.data?.length) {
    return context.json({ error: { code: 'TENANT_FORBIDDEN', message: 'Bu işletmeye erişiminiz yok.' } }, 403);
  }
  setCookie(context, 'yzt_business', businessId, cookieOptions(context.env, 60 * 60 * 24 * 30));
  return context.json({ ok: true });
});

app.get('/api/catalog', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const membership = await activeMembership(context, auth);
  if (!membership) return context.json({ error: { code: 'TENANT_REQUIRED', message: 'Aktif işletme seçin.' } }, 403);

  const business = membership.business_id;
  const [services, staff, assignments] = await Promise.all([
    supabaseRequest<unknown[]>(context.env, `rest/v1/services?select=id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active&business_id=eq.${business}&order=created_at.asc`, {}, auth.accessToken),
    supabaseRequest<unknown[]>(context.env, `rest/v1/staff_profiles?select=id,membership_id,name,phone,active&business_id=eq.${business}&order=created_at.asc`, {}, auth.accessToken),
    supabaseRequest<unknown[]>(context.env, `rest/v1/staff_services?select=staff_id,service_id,active&business_id=eq.${business}`, {}, auth.accessToken),
  ]);
  if (!services.ok || !staff.ok || !assignments.ok) {
    return context.json({ error: { code: 'CATALOG_READ_FAILED', message: 'Hizmet ve ekip bilgileri okunamadı.' } }, 502);
  }
  return context.json({ membership, services: services.data ?? [], staff: staff.data ?? [], assignments: assignments.data ?? [] });
});

app.post('/api/services', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const membership = await activeMembership(context, auth);
  if (!canManage(membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Hizmet yönetimi için owner veya manager rolü gerekli.' } }, 403);
  const body = await readJson(context);
  if (!validName(body?.name) || !integerIn(body?.durationMinutes, 5, 720) || !integerIn(body?.priceMinor, 0, 100000000)) {
    return context.json({ error: { code: 'INVALID_SERVICE', message: 'Hizmet adı, süre veya fiyat geçerli değil.' } }, 400);
  }
  const before = body?.bufferBeforeMinutes ?? 0;
  const after = body?.bufferAfterMinutes ?? 0;
  if (!integerIn(before, 0, 240) || !integerIn(after, 0, 240)) {
    return context.json({ error: { code: 'INVALID_BUFFER', message: 'Tampon süre 0–240 dakika olmalı.' } }, 400);
  }
  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/services', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      business_id: membership!.business_id,
      name: String(body!.name).trim(),
      duration_minutes: body!.durationMinutes,
      buffer_before_minutes: before,
      buffer_after_minutes: after,
      price_minor: body!.priceMinor,
      currency: 'TRY',
    }),
  }, auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'SERVICE_CREATE_FAILED', message: 'Hizmet kaydedilemedi.' } }, 400);
  return context.json({ service: result.data?.[0] ?? null }, 201);
});

app.patch('/api/services/:id', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const membership = await activeMembership(context, auth);
  if (!canManage(membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.' } }, 403);
  const body = await readJson(context);
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    if (!validName(body.name)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Hizmet adı geçerli değil.' } }, 400);
    patch.name = String(body.name).trim();
  }
  if (body?.durationMinutes !== undefined) {
    if (!integerIn(body.durationMinutes, 5, 720)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Süre 5–720 dakika olmalı.' } }, 400);
    patch.duration_minutes = body.durationMinutes;
  }
  if (body?.priceMinor !== undefined) {
    if (!integerIn(body.priceMinor, 0, 100000000)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Fiyat geçerli değil.' } }, 400);
    patch.price_minor = body.priceMinor;
  }
  if (typeof body?.active === 'boolean') patch.active = body.active;
  if (!Object.keys(patch).length) return context.json({ error: { code: 'EMPTY_PATCH', message: 'Değiştirilecek alan yok.' } }, 400);
  const result = await supabaseRequest<unknown[]>(context.env, `rest/v1/services?id=eq.${context.req.param('id')}&business_id=eq.${membership!.business_id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  }, auth.accessToken);
  if (!result.ok || !result.data?.length) return context.json({ error: { code: 'SERVICE_UPDATE_FAILED', message: 'Hizmet güncellenemedi.' } }, 400);
  return context.json({ service: result.data[0] });
});

app.post('/api/staff', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const membership = await activeMembership(context, auth);
  if (!canManage(membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Ekip yönetimi için owner veya manager rolü gerekli.' } }, 403);
  const body = await readJson(context);
  if (!validName(body?.name)) return context.json({ error: { code: 'INVALID_STAFF', message: 'Personel adı geçerli değil.' } }, 400);
  const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  if (phone && phone.length > 40) return context.json({ error: { code: 'INVALID_PHONE', message: 'Telefon alanı çok uzun.' } }, 400);
  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/staff_profiles', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ business_id: membership!.business_id, name: String(body!.name).trim(), phone }),
  }, auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'STAFF_CREATE_FAILED', message: 'Personel kaydedilemedi.' } }, 400);
  return context.json({ staff: result.data?.[0] ?? null }, 201);
});

app.patch('/api/staff/:id', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const membership = await activeMembership(context, auth);
  if (!canManage(membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.' } }, 403);
  const body = await readJson(context);
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    if (!validName(body.name)) return context.json({ error: { code: 'INVALID_STAFF', message: 'Personel adı geçerli değil.' } }, 400);
    patch.name = String(body.name).trim();
  }
  if (body?.phone !== undefined) patch.phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  if (typeof body?.active === 'boolean') patch.active = body.active;
  if (!Object.keys(patch).length) return context.json({ error: { code: 'EMPTY_PATCH', message: 'Değiştirilecek alan yok.' } }, 400);
  const result = await supabaseRequest<unknown[]>(context.env, `rest/v1/staff_profiles?id=eq.${context.req.param('id')}&business_id=eq.${membership!.business_id}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  }, auth.accessToken);
  if (!result.ok || !result.data?.length) return context.json({ error: { code: 'STAFF_UPDATE_FAILED', message: 'Personel güncellenemedi.' } }, 400);
  return context.json({ staff: result.data[0] });
});

app.put('/api/staff/:staffId/services/:serviceId', async (context) => {
  const auth = await resolveAuth(context);
  if (!auth) return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  const membership = await activeMembership(context, auth);
  if (!canManage(membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.' } }, 403);
  const body = await readJson(context);
  const active = body?.active !== false;
  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/staff_services?on_conflict=business_id,staff_id,service_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      business_id: membership!.business_id,
      staff_id: context.req.param('staffId'),
      service_id: context.req.param('serviceId'),
      active,
    }),
  }, auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'ASSIGNMENT_FAILED', message: 'Hizmet yetkinliği güncellenemedi.' } }, 400);
  return context.json({ assignment: result.data?.[0] ?? null });
});

app.all('/api/health', (context) => {
  context.header('Allow', 'GET, HEAD');
  return context.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Bu adres için GET veya HEAD kullanın.' } }, 405);
});

app.notFound((context) => context.json({ error: { code: 'NOT_FOUND', message: 'İstenen API adresi bulunamadı.' } }, 404));

app.onError((error, context) => {
  console.error('API request failed', { name: error.name });
  return context.json({ error: { code: 'INTERNAL_ERROR', message: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' } }, 500);
});

export default app;
