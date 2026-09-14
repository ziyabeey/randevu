import { Hono } from 'hono';
import {
  first,
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';

type Readiness = {
  business_id: string;
  has_active_service: boolean;
  has_active_staff: boolean;
  has_active_assignment: boolean;
  has_business_hours: boolean;
  has_staff_hours: boolean;
  has_overlapping_hours: boolean;
  publishable: boolean;
  missing_reasons: string[];
};

type PublicSettings = {
  business_id: string;
  enabled: boolean;
  step_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
};

const onboarding = new Hono<{ Bindings: AuthEnv }>();

onboarding.get('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (access.auth.passwordRecovery) {
    return context.json({
      error: {
        code: 'PASSWORD_UPDATE_REQUIRED',
        message: 'Devam etmeden önce yeni parolanızı belirleyin.',
      },
    }, 403);
  }

  const businessId = access.membership.business_id;
  const token = access.auth.accessToken;
  const [business, services, staff, assignments, businessHours, staffHours, settings, readiness] = await Promise.all([
    supabaseRequest<Array<{ id: string; name: string; slug: string; timezone: string }>>(
      context.env,
      `rest/v1/businesses?select=id,name,slug,timezone&id=eq.${businessId}&limit=1`,
      {},
      token,
    ),
    supabaseRequest<unknown[]>(
      context.env,
      `rest/v1/services?select=id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active&business_id=eq.${businessId}&order=created_at.asc`,
      {},
      token,
    ),
    supabaseRequest<unknown[]>(
      context.env,
      `rest/v1/staff_profiles?select=id,membership_id,name,phone,active&business_id=eq.${businessId}&order=created_at.asc`,
      {},
      token,
    ),
    supabaseRequest<unknown[]>(
      context.env,
      `rest/v1/staff_services?select=staff_id,service_id,active&business_id=eq.${businessId}`,
      {},
      token,
    ),
    supabaseRequest<unknown[]>(
      context.env,
      `rest/v1/business_hours?select=id,weekday,starts_local,ends_local,active&business_id=eq.${businessId}&active=eq.true&order=weekday.asc,starts_local.asc`,
      {},
      token,
    ),
    supabaseRequest<unknown[]>(
      context.env,
      `rest/v1/staff_hours?select=id,staff_id,weekday,starts_local,ends_local,active&business_id=eq.${businessId}&active=eq.true&order=staff_id.asc,weekday.asc,starts_local.asc`,
      {},
      token,
    ),
    supabaseRequest<PublicSettings[]>(
      context.env,
      `rest/v1/public_booking_settings?select=business_id,enabled,step_minutes,min_notice_minutes,horizon_days&business_id=eq.${businessId}&limit=1`,
      {},
      token,
    ),
    supabaseRequest<Readiness[]>(context.env, 'rest/v1/rpc/get_business_onboarding_readiness', {
      method: 'POST',
      body: JSON.stringify({ p_business_id: businessId }),
    }, token),
  ]);

  const results = [business, services, staff, assignments, businessHours, staffHours, settings, readiness];
  if (results.some((result) => upstreamUnavailable(result.status))) {
    return context.json({
      error: {
        code: 'ONBOARDING_UNAVAILABLE',
        message: 'Kurulum bilgileri şu anda doğrulanamıyor. Lütfen tekrar deneyin.',
      },
    }, 503);
  }

  const businessRow = business.ok ? first(business.data) : null;
  const settingsRow = settings.ok ? first(settings.data) : null;
  const readinessRow = readiness.ok ? first(readiness.data) : null;
  if (!business.ok || !services.ok || !staff.ok || !assignments.ok
      || !businessHours.ok || !staffHours.ok || !settings.ok || !readiness.ok
      || !businessRow || !settingsRow || !readinessRow) {
    return context.json({
      error: {
        code: 'ONBOARDING_READ_FAILED',
        message: 'Kurulum bilgileri okunamadı.',
      },
    }, 502);
  }

  return context.json({
    membership: access.membership,
    business: businessRow,
    services: services.data ?? [],
    staff: staff.data ?? [],
    assignments: assignments.data ?? [],
    businessHours: businessHours.data ?? [],
    staffHours: staffHours.data ?? [],
    settings: settingsRow,
    readiness: readinessRow,
  });
});

export default onboarding;
