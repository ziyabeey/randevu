import { Hono } from 'hono';
import authRoutes from './auth-routes.ts';
import {
  canManage,
  first,
  mutationSecurityError,
  readJson,
  requireAuth,
  requireMember,
  setBusinessCookie,
  supabaseRequest,
  type AppContext,
  type AuthEnv,
  type Membership,
  type Role,
} from './auth.ts';

type Env = AuthEnv;
type BaseContext = AppContext<Env>;

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (context, next) => {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  await next();
});

function accountMutationPath(path: string) {
  return path.startsWith('/api/auth/')
    || path === '/api/businesses'
    || path === '/api/businesses/select'
    || path.startsWith('/api/services')
    || path.startsWith('/api/staff');
}

app.use('/api/*', async (context, next) => {
  if (accountMutationPath(context.req.path)) {
    const security = mutationSecurityError(context);
    if (security) return context.json({ error: security }, 403);
  }
  await next();
});

app.route('/api', authRoutes);

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

async function requireStandardAuth(context: BaseContext) {
  const access = await requireAuth(context);
  if ('error' in access) return access;
  if (access.auth.passwordRecovery) {
    return {
      error: context.json({
        error: {
          code: 'PASSWORD_UPDATE_REQUIRED',
          message: 'Devam etmeden önce yeni parolanızı belirleyin.',
        },
      }, 403),
    } as const;
  }
  return access;
}

async function requireStandardMember(context: BaseContext) {
  const access = await requireMember(context);
  if ('error' in access) return access;
  if (access.auth.passwordRecovery) {
    return {
      error: context.json({
        error: {
          code: 'PASSWORD_UPDATE_REQUIRED',
          message: 'Devam etmeden önce yeni parolanızı belirleyin.',
        },
      }, 403),
    } as const;
  }
  return access;
}

app.get('/api/health', (context) => context.json({ status: 'ok', service: 'yzt-randevu', phase: 10 }));

app.post('/api/businesses', async (context) => {
  const access = await requireStandardAuth(context);
  if ('error' in access) return access.error;

  const body = await readJson(context);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const timezone = typeof body?.timezone === 'string' ? body.timezone.trim() : 'Europe/Istanbul';
  const slug = typeof body?.slug === 'string' && body.slug.trim() ? slugify(body.slug) : slugify(name);
  if (!validName(name) || !slug) {
    return context.json({ error: { code: 'INVALID_BUSINESS', message: 'İşletme adı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Array<{ id: string; name: string; slug: string; timezone: string; role: Role }>>(
    context.env,
    'rest/v1/rpc/create_business_with_owner',
    { method: 'POST', body: JSON.stringify({ p_name: name, p_slug: slug, p_timezone: timezone }) },
    access.auth.accessToken,
  );
  const business = result.ok ? first(result.data) : null;
  if (!business) {
    return context.json({ error: { code: 'BUSINESS_CREATE_FAILED', message: 'İşletme oluşturulamadı. Adres kullanımda olabilir.' } }, 400);
  }

  setBusinessCookie(context, business.id);
  return context.json({ business }, 201);
});

app.post('/api/businesses/select', async (context) => {
  const access = await requireStandardAuth(context);
  if ('error' in access) return access.error;

  const body = await readJson(context);
  const businessId = typeof body?.businessId === 'string' ? body.businessId : '';
  const query = new URLSearchParams({
    select: 'id,business_id,role,active',
    business_id: `eq.${businessId}`,
    user_id: `eq.${access.auth.user.id}`,
    active: 'eq.true',
    limit: '1',
  });
  const result = await supabaseRequest<Membership[]>(context.env, `rest/v1/memberships?${query}`, {}, access.auth.accessToken);
  if (!result.ok || !first(result.data)) {
    return context.json({ error: { code: 'TENANT_FORBIDDEN', message: 'Bu işletmeye erişiminiz yok.' } }, 403);
  }

  setBusinessCookie(context, businessId);
  return context.json({ ok: true });
});

app.get('/api/catalog', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;

  const businessId = access.membership.business_id;
  const [services, staff, assignments] = await Promise.all([
    supabaseRequest<unknown[]>(context.env, `rest/v1/services?select=id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active&business_id=eq.${businessId}&order=created_at.asc`, {}, access.auth.accessToken),
    supabaseRequest<unknown[]>(context.env, `rest/v1/staff_profiles?select=id,membership_id,name,phone,active&business_id=eq.${businessId}&order=created_at.asc`, {}, access.auth.accessToken),
    supabaseRequest<unknown[]>(context.env, `rest/v1/staff_services?select=staff_id,service_id,active&business_id=eq.${businessId}`, {}, access.auth.accessToken),
  ]);

  if (!services.ok || !staff.ok || !assignments.ok) {
    return context.json({ error: { code: 'CATALOG_READ_FAILED', message: 'Hizmet ve ekip bilgileri okunamadı.' } }, 502);
  }

  return context.json({
    membership: access.membership,
    services: services.data ?? [],
    staff: staff.data ?? [],
    assignments: assignments.data ?? [],
  });
});

app.post('/api/services', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Hizmet yönetimi için yetkiniz yok.' } }, 403);
  }

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
      business_id: access.membership.business_id,
      name: String(body?.name).trim(),
      duration_minutes: body?.durationMinutes,
      buffer_before_minutes: before,
      buffer_after_minutes: after,
      price_minor: body?.priceMinor,
      currency: 'TRY',
    }),
  }, access.auth.accessToken);

  if (!result.ok) return context.json({ error: { code: 'SERVICE_CREATE_FAILED', message: 'Hizmet kaydedilemedi.' } }, 400);
  return context.json({ service: first(result.data) }, 201);
});

app.patch('/api/services/:id', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.' } }, 403);
  }

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

  const result = await supabaseRequest<unknown[]>(context.env, `rest/v1/services?id=eq.${context.req.param('id')}&business_id=eq.${access.membership.business_id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  }, access.auth.accessToken);
  const service = result.ok ? first(result.data) : null;
  if (!service) return context.json({ error: { code: 'SERVICE_UPDATE_FAILED', message: 'Hizmet güncellenemedi.' } }, 400);
  return context.json({ service });
});

app.post('/api/staff', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Ekip yönetimi için yetkiniz yok.' } }, 403);
  }

  const body = await readJson(context);
  if (!validName(body?.name)) return context.json({ error: { code: 'INVALID_STAFF', message: 'Personel adı geçerli değil.' } }, 400);
  const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  if (phone && phone.length > 40) return context.json({ error: { code: 'INVALID_PHONE', message: 'Telefon alanı çok uzun.' } }, 400);

  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/staff_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ business_id: access.membership.business_id, name: String(body?.name).trim(), phone }),
  }, access.auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'STAFF_CREATE_FAILED', message: 'Personel kaydedilemedi.' } }, 400);
  return context.json({ staff: first(result.data) }, 201);
});

app.patch('/api/staff/:id', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.' } }, 403);
  }

  const body = await readJson(context);
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    if (!validName(body.name)) return context.json({ error: { code: 'INVALID_STAFF', message: 'Personel adı geçerli değil.' } }, 400);
    patch.name = String(body.name).trim();
  }
  if (body?.phone !== undefined) patch.phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  if (typeof body?.active === 'boolean') patch.active = body.active;
  if (!Object.keys(patch).length) return context.json({ error: { code: 'EMPTY_PATCH', message: 'Değiştirilecek alan yok.' } }, 400);

  const result = await supabaseRequest<unknown[]>(context.env, `rest/v1/staff_profiles?id=eq.${context.req.param('id')}&business_id=eq.${access.membership.business_id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  }, access.auth.accessToken);
  const staff = result.ok ? first(result.data) : null;
  if (!staff) return context.json({ error: { code: 'STAFF_UPDATE_FAILED', message: 'Personel güncellenemedi.' } }, 400);
  return context.json({ staff });
});

app.put('/api/staff/:staffId/services/:serviceId', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.' } }, 403);
  }

  const body = await readJson(context);
  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/staff_services?on_conflict=business_id,staff_id,service_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      business_id: access.membership.business_id,
      staff_id: context.req.param('staffId'),
      service_id: context.req.param('serviceId'),
      active: body?.active !== false,
    }),
  }, access.auth.accessToken);

  if (!result.ok) return context.json({ error: { code: 'ASSIGNMENT_FAILED', message: 'Hizmet yetkinliği güncellenemedi.' } }, 400);
  return context.json({ assignment: first(result.data) });
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
