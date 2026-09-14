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

type Business = { id: string; name: string; slug: string; timezone: string };
type OnboardingSnapshot = {
  business: Business;
  services: unknown[];
  staff: unknown[];
  assignments: unknown[];
  business_hours: unknown[];
  staff_hours: unknown[];
  settings: PublicSettings;
  readiness: Readiness;
};
type SupabaseError = { message?: string };

const onboarding = new Hono<{ Bindings: AuthEnv }>();

function errorMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
}

function limitError(message: string) {
  if (message.includes('CATALOG_SERVICES_LIMIT_EXCEEDED')) {
    return { code: 'CATALOG_SERVICES_LIMIT_EXCEEDED', message: 'Hizmet kataloğu güvenli snapshot sınırını aşıyor.' };
  }
  if (message.includes('CATALOG_STAFF_LIMIT_EXCEEDED')) {
    return { code: 'CATALOG_STAFF_LIMIT_EXCEEDED', message: 'Personel kataloğu güvenli snapshot sınırını aşıyor.' };
  }
  if (message.includes('CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED')) {
    return { code: 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED', message: 'Personel-hizmet eşleşmeleri güvenli snapshot sınırını aşıyor.' };
  }
  if (message.includes('ONBOARDING_BUSINESS_HOURS_LIMIT_EXCEEDED')) {
    return { code: 'ONBOARDING_BUSINESS_HOURS_LIMIT_EXCEEDED', message: 'İşletme çalışma saatleri güvenli snapshot sınırını aşıyor.' };
  }
  if (message.includes('ONBOARDING_STAFF_HOURS_LIMIT_EXCEEDED')) {
    return { code: 'ONBOARDING_STAFF_HOURS_LIMIT_EXCEEDED', message: 'Personel çalışma saatleri güvenli snapshot sınırını aşıyor.' };
  }
  return null;
}

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
  const result = await supabaseRequest<OnboardingSnapshot[]>(
    context.env,
    'rest/v1/rpc/get_business_onboarding_snapshot',
    {
      method: 'POST',
      body: JSON.stringify({ p_business_id: businessId }),
    },
    access.auth.accessToken,
  );

  if (upstreamUnavailable(result.status)) {
    return context.json({
      error: {
        code: 'ONBOARDING_UNAVAILABLE',
        message: 'Kurulum bilgileri şu anda doğrulanamıyor. Lütfen tekrar deneyin.',
      },
    }, 503);
  }

  if (!result.ok) {
    const message = errorMessage(result.data);
    const overflow = limitError(message);
    if (overflow) return context.json({ error: overflow }, 409);
    if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
      return context.json({
        error: {
          code: 'PASSWORD_UPDATE_REQUIRED',
          message: 'Devam etmeden önce yeni parolanızı belirleyin.',
        },
      }, 403);
    }
    if (message.includes('NOT_ALLOWED')) {
      return context.json({
        error: {
          code: 'TENANT_FORBIDDEN',
          message: 'Bu işletmeye erişiminiz yok.',
        },
      }, 403);
    }
    return context.json({
      error: {
        code: 'ONBOARDING_READ_FAILED',
        message: 'Kurulum bilgileri okunamadı.',
      },
    }, 502);
  }

  const snapshot = first(result.data);
  if (!snapshot
      || !snapshot.business
      || !snapshot.settings
      || !snapshot.readiness
      || !Array.isArray(snapshot.services)
      || !Array.isArray(snapshot.staff)
      || !Array.isArray(snapshot.assignments)
      || !Array.isArray(snapshot.business_hours)
      || !Array.isArray(snapshot.staff_hours)) {
    return context.json({
      error: {
        code: 'ONBOARDING_READ_FAILED',
        message: 'Kurulum bilgileri okunamadı.',
      },
    }, 502);
  }

  return context.json({
    membership: access.membership,
    business: snapshot.business,
    services: snapshot.services,
    staff: snapshot.staff,
    assignments: snapshot.assignments,
    businessHours: snapshot.business_hours,
    staffHours: snapshot.staff_hours,
    settings: snapshot.settings,
    readiness: snapshot.readiness,
  });
});

export default onboarding;
