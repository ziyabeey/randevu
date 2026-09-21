import { publicOperation } from './public-rpc.ts';
import { Hono } from 'hono';
import {
  canManage,
  first,
  readJson,
  requireMember,
  supabaseRequest,
  type AppContext,
  type AuthEnv,
} from './auth.ts';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';
import { PUBLIC_BOOKING_SUBMIT_WINDOW_SECONDS } from '../shared/public-booking-intent.ts';

type Env = AuthEnv & PublicAbuseEnv;
type BaseContext = AppContext<Env>;
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

const publicBooking = new Hono<{ Bindings: Env }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}
function integerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
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
  if (message === 'PUBLIC_OPERATION_UNAVAILABLE') return { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Rezervasyon bilgileri şu anda alınamıyor. Lütfen tekrar deneyin.', status: 503 as const };
  if (message.includes('PUBLIC_BOOKING_GATE_UNAVAILABLE') || message.includes('PUBLIC_BOOKING_GATE_INVALID_PROOF')) {
    return { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Rezervasyon güvenlik kontrolü şu anda hazır değil.', status: 503 as const };
  }
  if (message.includes('PUBLIC_BOOKING_NOT_FOUND') || message.includes('PUBLIC_BOOKING_DISABLED')) {
    return { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.', status: 404 as const };
  }
  if (message.includes('PUBLIC_BOOKING_NOT_READY')) {
    return { code: 'PUBLIC_BOOKING_NOT_READY', message: 'Yayınlamadan önce hizmet, personel ve çalışma saatlerini tamamlayın.', status: 409 as const };
  }
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
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
    return { code: 'PUBLIC_CONTACT_REQUIRED', message: 'Telefon bilgisi zorunlu. E-posta isteğe bağlıdır.', status: 400 as const };
  }
  if (message.includes('INVALID_CUSTOMER') || message.includes('NOTES_TOO_LONG') || message.includes('INVALID_START')) {
    return { code: 'INVALID_BOOKING', message: 'Rezervasyon bilgileri geçerli değil.', status: 400 as const };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.', status: 403 as const };
  }
  return { code: 'PUBLIC_BOOKING_FAILED', message: fallback, status: 400 as const };
}

function errorResponse(context: BaseContext, error: ReturnType<typeof rpcError>) {
  if ('retryAfter' in error && error.retryAfter) {
    const response = context.json(publicRateLimitedBody(error.retryAfter), 429);
    response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
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

  if (!result.ok) return errorResponse(context, rpcError(result.data, 'Public rezervasyon ayarları kaydedilemedi.'));
  return context.json({ settings: Array.isArray(result.data) ? first(result.data) : result.data });
});

// Public browsing is routed through guarded RPCs. The browser never receives the
// gate secret; it only keeps a signed HttpOnly client proof cookie.
publicBooking.get('/business/:slug', async (context) => {
  const slug = context.req.param('slug');
  if (!isSlug(slug)) return context.json({ error: { code: 'NOT_FOUND', message: 'Rezervasyon bağlantısı bulunamadı.' } }, 404);

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  const [business, services] = await Promise.all([
    publicOperation<PublicBusiness[]>(context.env, 'business', { p_slug: slug }, abuse),
    publicOperation<PublicService[]>(context.env, 'services', { p_slug: slug }, abuse),
  ]);
  if (!business.ok) return errorResponse(context, rpcError(business.data, 'Rezervasyon bağlantısı yüklenemedi.'));
  if (!services.ok) return errorResponse(context, rpcError(services.data, 'Hizmetler yüklenemedi.'));

  const publicBusiness = first(business.data);
  if (!publicBusiness) {
    return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.' } }, 404);
  }

  return context.json({
    business: publicBusiness,
    services: services.data ?? [],
    bookingClock: {
      serverNowEpochSeconds: Math.floor(Date.now() / 1000),
      submitWindowSeconds: PUBLIC_BOOKING_SUBMIT_WINDOW_SECONDS,
    },
  });
});

publicBooking.get('/business/:slug/staff', async (context) => {
  const slug = context.req.param('slug');
  const serviceId = context.req.query('serviceId');
  if (!isSlug(slug) || !isUuid(serviceId)) {
    return context.json({ error: { code: 'INVALID_PUBLIC_QUERY', message: 'Hizmet bilgisi geçerli değil.' } }, 400);
  }

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<PublicStaff[]>(context.env, 'staff', { p_slug: slug, p_service_id: serviceId }, abuse);
  if (!result.ok) return errorResponse(context, rpcError(result.data, 'Personel bilgileri yüklenemedi.'));
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

  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<PublicSlot[]>(context.env, 'slots', {
      p_slug: slug,
      p_service_id: serviceId,
      p_date: date,
      p_staff_id: staffId
    }, abuse);
  if (!result.ok) return errorResponse(context, rpcError(result.data, 'Uygun saatler hesaplanamadı.'));
  return context.json({ slots: result.data ?? [] });
});

export default publicBooking;
