import { Hono } from 'hono';
import {
  canManage,
  first,
  readJson,
  requireMember,
  supabaseRequest,
  type AuthEnv,
} from './auth.ts';

type Env = AuthEnv;
type IntervalInput = { start: string; end: string };

type AvailabilitySlot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};

const availability = new Hono<{ Bindings: Env }>();

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseIntervals(value: unknown): IntervalInput[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const result: IntervalInput[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if (!isTime(candidate.start) || !isTime(candidate.end) || candidate.start >= candidate.end) return null;
    result.push({ start: candidate.start, end: candidate.end });
  }
  return result;
}

function validDateHorizon(date: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const day = 86_400_000;
  return target >= todayUtc - day && target <= todayUtc + 366 * day;
}

availability.get('/setup', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const { auth, membership } = access;
  const businessId = membership.business_id;

  const [business, businessHours, staffHours, blocks] = await Promise.all([
    supabaseRequest<Array<{ id: string; timezone: string }>>(context.env, `rest/v1/businesses?select=id,timezone&id=eq.${businessId}&limit=1`, {}, auth.accessToken),
    supabaseRequest<unknown[]>(context.env, `rest/v1/business_hours?select=id,weekday,starts_local,ends_local,active&business_id=eq.${businessId}&active=eq.true&order=weekday.asc,starts_local.asc`, {}, auth.accessToken),
    supabaseRequest<unknown[]>(context.env, `rest/v1/staff_hours?select=id,staff_id,weekday,starts_local,ends_local,active&business_id=eq.${businessId}&active=eq.true&order=weekday.asc,starts_local.asc`, {}, auth.accessToken),
    supabaseRequest<unknown[]>(context.env, `rest/v1/availability_blocks?select=id,staff_id,starts_at,ends_at,reason,active&business_id=eq.${businessId}&active=eq.true&order=starts_at.asc`, {}, auth.accessToken),
  ]);

  if (!business.ok || !businessHours.ok || !staffHours.ok || !blocks.ok) {
    return context.json({ error: { code: 'AVAILABILITY_READ_FAILED', message: 'Müsaitlik ayarları okunamadı.' } }, 502);
  }

  return context.json({
    membership,
    timezone: first(business.data)?.timezone ?? 'Europe/Istanbul',
    businessHours: businessHours.data ?? [],
    staffHours: staffHours.data ?? [],
    blocks: blocks.data ?? [],
  });
});

availability.put('/business-hours/:weekday', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Çalışma saatlerini owner veya manager düzenleyebilir.' } }, 403);
  }

  const weekday = Number(context.req.param('weekday'));
  const body = await readJson(context);
  const intervals = parseIntervals(body?.intervals);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || intervals === null) {
    return context.json({ error: { code: 'INVALID_HOURS', message: 'Gün veya saat aralıkları geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/rpc/replace_business_hours', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: access.membership.business_id, p_weekday: weekday, p_intervals: intervals }),
  }, access.auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'HOURS_UPDATE_FAILED', message: 'Çalışma saatleri kaydedilemedi. Aralıkların çakışmadığını kontrol edin.' } }, 400);
  return context.json({ hours: result.data ?? [] });
});

availability.put('/staff/:staffId/hours/:weekday', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Personel saatlerini owner veya manager düzenleyebilir.' } }, 403);
  }

  const staffId = context.req.param('staffId');
  const weekday = Number(context.req.param('weekday'));
  const body = await readJson(context);
  const intervals = parseIntervals(body?.intervals);
  if (!isUuid(staffId) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || intervals === null) {
    return context.json({ error: { code: 'INVALID_HOURS', message: 'Personel, gün veya saat aralıkları geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/rpc/replace_staff_hours', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_staff_id: staffId,
      p_weekday: weekday,
      p_intervals: intervals,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'STAFF_HOURS_UPDATE_FAILED', message: 'Personel çalışma saatleri kaydedilemedi.' } }, 400);
  return context.json({ hours: result.data ?? [] });
});

availability.post('/blocks', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'İzin ve kapanışları owner veya manager düzenleyebilir.' } }, 403);
  }

  const body = await readJson(context);
  const date = body?.date;
  const start = body?.start;
  const end = body?.end;
  const staffId = body?.staffId === null || body?.staffId === '' || body?.staffId === undefined ? null : body.staffId;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : null;

  if (!isDate(date) || !validDateHorizon(date) || !isTime(start) || !isTime(end) || (staffId !== null && !isUuid(staffId)) || (reason !== null && reason.length > 240)) {
    return context.json({ error: { code: 'INVALID_BLOCK', message: 'İzin/kapanış bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<unknown>(context.env, 'rest/v1/rpc/create_availability_block_local', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_staff_id: staffId,
      p_date: date,
      p_start_local: start,
      p_end_local: end,
      p_reason: reason,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'BLOCK_CREATE_FAILED', message: 'İzin/kapanış kaydedilemedi.' } }, 400);
  return context.json({ block: result.data }, 201);
});

availability.delete('/blocks/:id', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'İzin ve kapanışları owner veya manager düzenleyebilir.' } }, 403);
  }

  const blockId = context.req.param('id');
  if (!isUuid(blockId)) return context.json({ error: { code: 'INVALID_BLOCK', message: 'Kayıt kimliği geçerli değil.' } }, 400);

  const result = await supabaseRequest<boolean>(context.env, 'rest/v1/rpc/delete_availability_block', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: access.membership.business_id, p_block_id: blockId }),
  }, access.auth.accessToken);
  if (!result.ok || result.data !== true) return context.json({ error: { code: 'BLOCK_DELETE_FAILED', message: 'İzin/kapanış silinemedi.' } }, 404);
  return context.json({ ok: true });
});

availability.get('/slots', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;

  const serviceId = context.req.query('serviceId');
  const staffRaw = context.req.query('staffId');
  const date = context.req.query('date');
  const step = Number(context.req.query('step') ?? '15');
  const staffId = staffRaw && staffRaw !== 'any' ? staffRaw : null;

  if (!isUuid(serviceId) || !isDate(date) || !validDateHorizon(date) || (staffId !== null && !isUuid(staffId)) || !Number.isInteger(step) || step < 5 || step > 120) {
    return context.json({ error: { code: 'INVALID_SLOT_QUERY', message: 'Hizmet, tarih, personel veya slot adımı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<AvailabilitySlot[]>(context.env, 'rest/v1/rpc/compute_availability_slots', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_service_id: serviceId,
      p_date: date,
      p_staff_id: staffId,
      p_step_minutes: step,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return context.json({ error: { code: 'SLOT_COMPUTE_FAILED', message: 'Uygun saatler hesaplanamadı.' } }, 400);
  return context.json({ slots: result.data ?? [] });
});

export default availability;
