import { Hono, type Context } from 'hono';
import {
  AuthUnavailableError,
  clearBusinessCookie,
  clearSessionCookies,
  ensureCsrfToken,
  first,
  getActiveBusinessId,
  requireMember,
  resolveAuth,
  supabaseRequest,
  type AuthEnv,
  type Membership,
} from './auth.ts';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';
import { publicOperation } from './public-rpc.ts';
import { PUBLIC_BOOKING_SUBMIT_WINDOW_SECONDS } from '../shared/public-booking-intent.ts';
import { SNAPSHOT_LIMITS, snapshotOverflow, snapshotProbeLimit } from './snapshot-bounds.ts';

type Env = AuthEnv & PublicAbuseEnv;
type SnapshotContext = Context<{ Bindings: Env }>;
type MembershipWithBusiness = Membership & {
  businesses: null | { id: string; name: string; slug: string; timezone: string };
};
type CatalogSnapshot = {
  services: unknown[];
  staff: unknown[];
  assignments: unknown[];
};
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
type PublicServiceV2 = {
  service_id: string;
  name: string;
  category: string;
  sort_order: number;
  duration_minutes: number;
  price_type: 'fixed' | 'range';
  price_min_minor: number;
  price_max_minor: number;
  currency: string;
  price_policy_version: number;
};
type PublicStaff = { staff_id: string; staff_name: string };
type SupabaseError = { message?: string };

const snapshotReads = new Hono<{ Bindings: Env }>();

snapshotReads.use('*', async (context, next) => {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  await next();
});

function limitExceeded(context: SnapshotContext, code: string, message: string) {
  return context.json({ error: { code, message } }, 409);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSlug(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 60
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
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

function errorMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
}

function calendarRpcError(data: unknown) {
  const message = errorMessage(data);
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işletmenin takvimine erişiminiz yok.', status: 403 as const };
  }
  if (message.includes('INVALID_CALENDAR_RANGE')) {
    return { code: 'INVALID_CALENDAR_RANGE', message: 'Takvim tarih aralığı geçerli değil.', status: 400 as const };
  }
  return { code: 'CALENDAR_READ_FAILED', message: 'Takvim yüklenemedi.', status: 502 as const };
}

function publicSnapshotError(data: unknown, fallback: string) {
  const retryAfter = rateLimitFromRpcError(data);
  if (retryAfter) {
    return {
      code: 'PUBLIC_BOOKING_RATE_LIMITED',
      message: `Çok fazla istek yapıldı. ${retryAfter} saniye sonra tekrar deneyin.`,
      status: 429 as const,
      retryAfter,
    };
  }
  const message = errorMessage(data);
  if (message.includes('PUBLIC_SERVICES_LIMIT_EXCEEDED')) {
    return {
      code: 'PUBLIC_SERVICES_LIMIT_EXCEEDED',
      message: 'Hizmet kataloğu bu sürümün güvenli snapshot sınırını aşıyor.',
      status: 409 as const,
    };
  }
  if (message.includes('PUBLIC_STAFF_LIMIT_EXCEEDED')) {
    return {
      code: 'PUBLIC_STAFF_LIMIT_EXCEEDED',
      message: 'Personel kataloğu bu sürümün güvenli snapshot sınırını aşıyor.',
      status: 409 as const,
    };
  }
  if (message === 'PUBLIC_OPERATION_UNAVAILABLE'
      || message.includes('PUBLIC_BOOKING_GATE_UNAVAILABLE')
      || message.includes('PUBLIC_BOOKING_GATE_INVALID_PROOF')) {
    return {
      code: 'PUBLIC_BOOKING_UNAVAILABLE',
      message: 'Rezervasyon bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.',
      status: 503 as const,
    };
  }
  if (message.includes('PUBLIC_BOOKING_NOT_FOUND') || message.includes('PUBLIC_BOOKING_DISABLED')) {
    return {
      code: 'PUBLIC_BOOKING_NOT_FOUND',
      message: 'Bu rezervasyon bağlantısı şu anda aktif değil.',
      status: 404 as const,
    };
  }
  return { code: 'PUBLIC_BOOKING_FAILED', message: fallback, status: 400 as const };
}

function publicErrorResponse(context: SnapshotContext, error: ReturnType<typeof publicSnapshotError>) {
  if ('retryAfter' in error && error.retryAfter) {
    const response = context.json(publicRateLimitedBody(error.retryAfter), 429);
    response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

snapshotReads.get('/api/session', async (context) => {
  const csrfToken = ensureCsrfToken(context);
  try {
    const auth = await resolveAuth(context);
    if (!auth) {
      return context.json({
        user: null,
        memberships: [],
        activeBusinessId: null,
        passwordRecovery: false,
        csrfToken,
      });
    }

    const query = new URLSearchParams({
      select: 'id,business_id,role,active,businesses!memberships_business_id_fkey(id,name,slug,timezone)',
      user_id: `eq.${auth.user.id}`,
      active: 'eq.true',
      order: 'created_at.asc',
      limit: String(snapshotProbeLimit(SNAPSHOT_LIMITS.memberships)),
    });
    const memberships = await supabaseRequest<MembershipWithBusiness[]>(
      context.env,
      `rest/v1/memberships?${query}`,
      {},
      auth.accessToken,
    );
    if (memberships.status === 0 || memberships.status >= 500) throw new AuthUnavailableError();
    if (!memberships.ok) {
      clearSessionCookies(context);
      return context.json({
        user: null,
        memberships: [],
        activeBusinessId: null,
        passwordRecovery: false,
        csrfToken,
      });
    }

    const activeMemberships = memberships.data ?? [];
    if (snapshotOverflow(activeMemberships, SNAPSHOT_LIMITS.memberships)) {
      return limitExceeded(
        context,
        'MEMBERSHIP_LIMIT_EXCEEDED',
        'Aktif işletme üyeliği bu sürümün güvenli snapshot sınırını aşıyor.',
      );
    }

    const selected = getActiveBusinessId(context);
    const activeBusinessId = selected && activeMemberships.some((membership) => membership.business_id === selected)
      ? selected
      : null;
    if (selected && !activeBusinessId) clearBusinessCookie(context);

    return context.json({
      user: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        fullName: auth.user.user_metadata?.full_name ?? null,
      },
      memberships: activeMemberships,
      activeBusinessId,
      passwordRecovery: auth.passwordRecovery,
      csrfToken,
    });
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      return context.json({
        error: {
          code: 'SESSION_UNAVAILABLE',
          message: 'Oturum şu anda doğrulanamıyor. Lütfen tekrar deneyin.',
        },
      }, 503);
    }
    throw error;
  }
});

snapshotReads.get('/api/catalog', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;

  const result = await supabaseRequest<CatalogSnapshot[]>(
    context.env,
    'rest/v1/rpc/get_catalog_snapshot',
    {
      method: 'POST',
      body: JSON.stringify({ p_business_id: access.membership.business_id }),
    },
    access.auth.accessToken,
  );

  if (!result.ok) {
    const message = errorMessage(result.data);
    if (message.includes('CATALOG_SERVICES_LIMIT_EXCEEDED')) {
      return limitExceeded(context, 'CATALOG_SERVICES_LIMIT_EXCEEDED', 'Hizmet kataloğu güvenli snapshot sınırını aşıyor.');
    }
    if (message.includes('CATALOG_STAFF_LIMIT_EXCEEDED')) {
      return limitExceeded(context, 'CATALOG_STAFF_LIMIT_EXCEEDED', 'Personel kataloğu güvenli snapshot sınırını aşıyor.');
    }
    if (message.includes('CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED')) {
      return limitExceeded(context, 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED', 'Personel-hizmet eşleşmeleri güvenli snapshot sınırını aşıyor.');
    }
    if (message.includes('NOT_ALLOWED')) {
      return context.json({ error: { code: 'TENANT_FORBIDDEN', message: 'Bu işletmeye erişiminiz yok.' } }, 403);
    }
    return context.json({ error: { code: 'CATALOG_READ_FAILED', message: 'Hizmet ve ekip bilgileri okunamadı.' } }, 502);
  }

  const snapshot = first(result.data);
  if (!snapshot
      || !Array.isArray(snapshot.services)
      || !Array.isArray(snapshot.staff)
      || !Array.isArray(snapshot.assignments)) {
    return context.json({ error: { code: 'CATALOG_READ_FAILED', message: 'Hizmet ve ekip bilgileri okunamadı.' } }, 502);
  }

  return context.json({
    membership: access.membership,
    services: snapshot.services,
    staff: snapshot.staff,
    assignments: snapshot.assignments,
  });
});

snapshotReads.get('/api/calendar', async (context) => {
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
  const staffQuery = new URLSearchParams({
    select: 'id,name,active',
    business_id: `eq.${businessId}`,
    order: 'name.asc',
    limit: String(snapshotProbeLimit(SNAPSHOT_LIMITS.staff)),
  });
  const [businessResult, staffResult] = await Promise.all([
    supabaseRequest<Business[]>(context.env, `rest/v1/businesses?${businessQuery}`, {}, access.auth.accessToken),
    supabaseRequest<Staff[]>(context.env, `rest/v1/staff_profiles?${staffQuery}`, {}, access.auth.accessToken),
  ]);

  const business = businessResult.ok ? first(businessResult.data) : null;
  if (!business || !staffResult.ok) {
    return context.json({ error: { code: 'CALENDAR_CONTEXT_FAILED', message: 'Takvim işletme veya ekip bilgileri yüklenemedi.' } }, 502);
  }
  if (snapshotOverflow(staffResult.data, SNAPSHOT_LIMITS.staff)) {
    return limitExceeded(
      context,
      'CALENDAR_STAFF_LIMIT_EXCEEDED',
      'Takvim personel seçicisi güvenli snapshot sınırını aşıyor.',
    );
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
    const error = calendarRpcError(appointmentsResult.data);
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

snapshotReads.get('/api/public/business/:slug', async (context) => {
  const slug = context.req.param('slug');
  if (!isSlug(slug)) {
    return context.json({ error: { code: 'NOT_FOUND', message: 'Rezervasyon bağlantısı bulunamadı.' } }, 404);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const [business, services] = await Promise.all([
    publicOperation<PublicBusiness[]>(context.env, 'business', { p_slug: slug }, abuse),
    publicOperation<PublicService[]>(context.env, 'services', { p_slug: slug }, abuse),
  ]);
  if (!business.ok) return publicErrorResponse(context, publicSnapshotError(business.data, 'Rezervasyon bağlantısı yüklenemedi.'));
  if (!services.ok) return publicErrorResponse(context, publicSnapshotError(services.data, 'Hizmetler yüklenemedi.'));
  if (snapshotOverflow(services.data, SNAPSHOT_LIMITS.services)) {
    return limitExceeded(context, 'PUBLIC_SERVICES_LIMIT_EXCEEDED', 'Hizmet kataloğu güvenli snapshot sınırını aşıyor.');
  }

  const publicBusiness = first(business.data);
  if (!publicBusiness) {
    return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.' } }, 404);
  }

  return context.json({
    business: publicBusiness,
    services: services.data,
    bookingClock: {
      serverNowEpochSeconds: Math.floor(Date.now() / 1000),
      submitWindowSeconds: PUBLIC_BOOKING_SUBMIT_WINDOW_SECONDS,
    },
  });
});

snapshotReads.get('/api/public/business/:slug/services-v2', async (context) => {
  const slug = context.req.param('slug');
  if (!isSlug(slug)) {
    return context.json({ error: { code: 'NOT_FOUND', message: 'Rezervasyon bağlantısı bulunamadı.' } }, 404);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const services = await publicOperation<PublicServiceV2[]>(
    context.env,
    'services_v2',
    { p_slug: slug },
    abuse,
  );
  if (!services.ok) {
    return publicErrorResponse(context, publicSnapshotError(services.data, 'Hizmetler yüklenemedi.'));
  }
  if (snapshotOverflow(services.data, SNAPSHOT_LIMITS.services)) {
    return limitExceeded(context, 'PUBLIC_SERVICES_LIMIT_EXCEEDED', 'Hizmet kataloğu güvenli snapshot sınırını aşıyor.');
  }

  return context.json({ services: services.data });
});

snapshotReads.get('/api/public/business/:slug/staff', async (context) => {
  const slug = context.req.param('slug');
  const serviceId = context.req.query('serviceId');
  if (!isSlug(slug) || !isUuid(serviceId)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_QUERY', message: 'Hizmet bilgisi geçerli değil.' } }, 400);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const result = await publicOperation<PublicStaff[]>(context.env, 'staff', {
    p_slug: slug,
    p_service_id: serviceId,
  }, abuse);
  if (!result.ok) return publicErrorResponse(context, publicSnapshotError(result.data, 'Personel bilgileri yüklenemedi.'));
  if (snapshotOverflow(result.data, SNAPSHOT_LIMITS.staff)) {
    return limitExceeded(context, 'PUBLIC_STAFF_LIMIT_EXCEEDED', 'Personel kataloğu güvenli snapshot sınırını aşıyor.');
  }
  return context.json({ staff: result.data });
});

export default snapshotReads;
