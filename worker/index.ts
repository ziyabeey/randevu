import { boundedRpc } from './public-rpc.ts';
import { rateLimitFromRpcError } from './public-abuse.ts';
import { Hono } from 'hono';
import authRoutes from './auth-routes.ts';
import catalogManagement from './catalog-management.ts';
import {
  first,
  readJson,
  requireAuth,
  requireMember,
  setBusinessCookie,
  supabaseRequest,
  upstreamUnavailable,
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

app.route('/api', authRoutes);
app.route('/api', catalogManagement);

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

  const result = await boundedRpc<Array<{ id: string; name: string; slug: string; timezone: string; role: Role }>>(
    context.env,
    'create_business_with_owner_guarded',
    { p_name: name, p_slug: slug, p_timezone: timezone },
    access.auth.accessToken,
  );
  if (!result.ok) {
    const retryAfter = rateLimitFromRpcError(result.data);
    if (retryAfter) {
      context.header('Retry-After', String(retryAfter));
      return context.json({ error: { code: 'BUSINESS_CREATE_RATE_LIMITED', message: 'Kısa sürede çok fazla işletme oluşturma isteği yapıldı. Lütfen daha sonra tekrar deneyin.', retryAfterSeconds: retryAfter } }, 429);
    }
    if (result.data.message === 'PUBLIC_OPERATION_UNAVAILABLE') {
      return context.json({ error: { code: 'BUSINESS_CREATE_UNAVAILABLE', message: 'İşletme oluşturma sonucu doğrulanamadı. İşletme listenizi kontrol edin.' } }, 503);
    }
  }
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
  if (upstreamUnavailable(result.status)) {
    return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Üyelik şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503);
  }
  if (!result.ok || !first(result.data)) {
    return context.json({ error: { code: 'TENANT_FORBIDDEN', message: 'Bu işletmeye erişiminiz yok.' } }, 403);
  }

  setBusinessCookie(context, businessId);
  return context.json({ ok: true });
});

// SnapshotReads owns the bounded /api/catalog route in the composed application.
// This compatibility read stays member-scoped for coreApp-only tests and callers.
app.get('/api/catalog', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;

  const result = await supabaseRequest<Array<{ services: unknown[]; staff: unknown[]; assignments: unknown[] }>>(
    context.env,
    'rest/v1/rpc/get_catalog_snapshot',
    { method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id }) },
    access.auth.accessToken,
  );
  const snapshot = result.ok ? first(result.data) : null;
  if (!snapshot || !Array.isArray(snapshot.services) || !Array.isArray(snapshot.staff) || !Array.isArray(snapshot.assignments)) {
    return context.json({ error: { code: 'CATALOG_READ_FAILED', message: 'Hizmet ve ekip bilgileri okunamadı.' } }, 502);
  }
  return context.json({ membership: access.membership, ...snapshot });
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
