import { Hono } from 'hono';
import {
  first,
  readJson,
  requireMember,
  supabaseRequest,
  type AppContext,
  type AuthEnv,
} from './auth.ts';

type Env = AuthEnv;
type BaseContext = AppContext<Env>;
type SupabaseError = { message?: string };

type GroupLineIntent = {
  serviceId: string;
  staffId?: string | null;
};

type GroupPlan = {
  startsAt: string;
  endsAt: string;
  timezone: string;
  currency: string;
  lowerMinor: number;
  upperMinor: number;
  fingerprint: string;
  lines: unknown[];
};

type GroupPlans = {
  plans: GroupPlan[];
  truncated: boolean;
  stepMinutes: number;
  date: string;
  timezone: string;
};

type BookingGroup = {
  groupId: string;
  businessId: string;
  customerId: string;
  status: string;
  source: string;
  version: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  currency: string;
  lowerMinor: number;
  upperMinor: number;
  lines: unknown[];
};

const bookingGroups = new Hono<{ Bindings: Env }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function idempotencyKey(context: BaseContext) {
  const value = context.req.header('Idempotency-Key')?.trim() ?? '';
  return value.length >= 8 && value.length <= 128 ? value : null;
}

function readLines(value: unknown): GroupLineIntent[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const lines: GroupLineIntent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const raw = entry as Record<string, unknown>;
    if (Object.keys(raw).some((key) => key !== 'serviceId' && key !== 'staffId')) return null;
    if (!isUuid(raw.serviceId)) return null;
    if (raw.staffId !== undefined && raw.staffId !== null && !isUuid(raw.staffId)) return null;
    lines.push({
      serviceId: raw.serviceId,
      ...(raw.staffId === undefined ? {} : { staffId: raw.staffId as string | null }),
    });
  }
  return lines;
}

function scalar<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return first(value) ?? null;
  return value;
}

function rpcError(data: unknown, fallback: string) {
  const message = typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işletme için işlem yetkiniz yok.', status: 403 as const };
  }
  if (message.includes('BOOKING_PLAN_STALE')) {
    return { code: 'BOOKING_PLAN_STALE', message: 'Seçtiğiniz plan değişti. Müsaitliği yenileyip tekrar seçin.', status: 409 as const };
  }
  if (message.includes('APPOINTMENT_CONFLICT') || message.includes('SLOT_UNAVAILABLE')) {
    return { code: 'SLOT_UNAVAILABLE', message: 'Bu plan az önce doldu. Lütfen başka bir saat seçin.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir rezervasyon için kullanılmış.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_IN_PROGRESS')) {
    return { code: 'BOOKING_IN_PROGRESS', message: 'Bu rezervasyon hâlâ işleniyor. Aynı işlem anahtarıyla tekrar deneyin.', status: 409 as const };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { code: 'DATE_OUT_OF_RANGE', message: 'Seçilen tarih desteklenen rezervasyon aralığının dışında.', status: 400 as const };
  }
  if (message.includes('BOOKING_CANDIDATE_BUDGET_EXCEEDED')) {
    return { code: 'BOOKING_CANDIDATE_BUDGET_EXCEEDED', message: 'Bu hizmet kombinasyonu tek sorguda planlanamayacak kadar fazla personel adayı üretiyor.', status: 400 as const };
  }
  if (message.includes('BOOKING_ESTIMATE_LIMIT_EXCEEDED')) {
    return { code: 'BOOKING_ESTIMATE_LIMIT_EXCEEDED', message: 'Rezervasyon toplamı desteklenen sınırı aşıyor.', status: 400 as const };
  }
  if (message.includes('CURRENCY_MISMATCH')) {
    return { code: 'CURRENCY_MISMATCH', message: 'Aynı rezervasyon grubundaki hizmetlerin para birimi aynı olmalı.', status: 400 as const };
  }
  if (message.includes('STAFF_NOT_ELIGIBLE')) {
    return { code: 'STAFF_NOT_ELIGIBLE', message: 'Seçilen personel bu hizmetlerden biri için uygun değil.', status: 400 as const };
  }
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { code: 'SERVICE_NOT_FOUND', message: 'Seçilen hizmetlerden biri artık kullanılamıyor.', status: 404 as const };
  }
  if (message.includes('INVALID_BOOKING_GROUP')
      || message.includes('INVALID_BOOKING_GROUP_LINES')
      || message.includes('INVALID_GROUP_PLAN_QUERY')) {
    return { code: 'INVALID_BOOKING_GROUP', message: 'Çok hizmetli rezervasyon bilgileri geçerli değil.', status: 400 as const };
  }
  const unavailable = message.length === 0;
  return {
    code: unavailable ? 'BOOKING_GROUP_UNAVAILABLE' : 'BOOKING_GROUP_FAILED',
    message: unavailable ? `${fallback} Lütfen tekrar deneyin.` : fallback,
    status: unavailable ? 503 as const : 400 as const,
  };
}

bookingGroups.post('/group/plans', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const body = await readJson(context);
  const lines = readLines(body?.lines);
  const stepMinutes = body?.stepMinutes === undefined ? 15 : Number(body.stepMinutes);
  const limit = body?.limit === undefined ? 25 : Number(body.limit);
  if (!lines || !isDate(body?.date)
      || !Number.isInteger(stepMinutes) || stepMinutes < 5 || stepMinutes > 120
      || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return context.json({ error: { code: 'INVALID_BOOKING_GROUP', message: 'Hizmet sırası, tarih veya planlama sınırı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupPlans | GroupPlans[]>(
    context.env,
    'rest/v1/rpc/compute_booking_group_plans',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_lines: lines,
        p_date: body.date,
        p_step_minutes: stepMinutes,
        p_limit: limit,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    const error = rpcError(result.data, 'Çok hizmetli müsaitlik hesaplanamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const plans = scalar(result.data);
  if (!plans || !Array.isArray(plans.plans)) {
    return context.json({ error: { code: 'BOOKING_GROUP_UNAVAILABLE', message: 'Çok hizmetli müsaitlik sonucu doğrulanamadı.' } }, 503);
  }
  return context.json({ membership: access.membership, ...plans });
});

bookingGroups.post('/group', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context);
  const body = await readJson(context);
  const lines = readLines(body?.lines);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 1000);
  const fingerprint = typeof body?.planFingerprint === 'string' ? body.planFingerprint.trim().toLowerCase() : '';

  if (!key) {
    return context.json({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'İşlem anahtarı eksik.' } }, 400);
  }
  if (!lines || customerName.length < 2 || customerName.length > 120
      || customerPhone === undefined || customerEmail === undefined || notes === undefined
      || (customerEmail !== null && !customerEmail.includes('@'))
      || !isTimestamp(body?.startsAt) || !/^[0-9a-f]{64}$/.test(fingerprint)) {
    return context.json({ error: { code: 'INVALID_BOOKING_GROUP', message: 'Müşteri, hizmet sırası veya plan bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<BookingGroup | BookingGroup[]>(
    context.env,
    'rest/v1/rpc/create_booking_group',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_idempotency_key: key,
        p_customer_name: customerName,
        p_lines: lines,
        p_starts_at: body.startsAt,
        p_plan_fingerprint: fingerprint,
        p_customer_phone: customerPhone,
        p_customer_email: customerEmail,
        p_notes: notes,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    const error = rpcError(result.data, 'Çok hizmetli rezervasyon oluşturulamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const group = scalar(result.data);
  if (!group?.groupId || !Array.isArray(group.lines)) {
    return context.json({ error: { code: 'BOOKING_GROUP_UNAVAILABLE', message: 'Rezervasyon sonucu doğrulanamadı.' } }, 503);
  }
  return context.json({ group }, 201);
});

export default bookingGroups;
