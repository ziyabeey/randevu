import { Hono } from 'hono';
import {
  first,
  readJson,
  requireMember,
  supabaseRequest,
  type AppContext,
  type AuthEnv,
} from './auth.ts';
import {
  decodePageCursor,
  pageResult,
  parsePageLimit,
} from './pagination.ts';

type Env = AuthEnv;
type BaseContext = AppContext<Env>;
type SupabaseError = { message?: string; code?: string; details?: string };

type Appointment = {
  id: string;
  business_id: string;
  customer_id: string;
  service_id: string;
  staff_id: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  customer_email_snapshot: string | null;
  service_name_snapshot: string;
  staff_name_snapshot: string;
  price_minor_snapshot: number;
  currency_snapshot: string;
  notes: string | null;
  cancellation_reason: string | null;
};

type AppointmentEvent = {
  id: string;
  event_type: string;
  actor_user_id: string;
  from_status: string | null;
  to_status: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

type Slot = { staff_id: string; staff_name: string; starts_at: string; ends_at: string; timezone: string };

const bookings = new Hono<{ Bindings: Env }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function rpcMessage(data: unknown, fallback: string) {
  const message = typeof data === 'object' && data !== null ? String((data as SupabaseError).message ?? '') : '';
  if (message.includes('IDEMPOTENCY_CONFLICT')) return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir istek için zaten kullanılmış.', status: 409 as const };
  if (message.includes('APPOINTMENT_CONFLICT')) return { code: 'APPOINTMENT_CONFLICT', message: 'Bu saat az önce başka bir randevu tarafından alındı.', status: 409 as const };
  if (message.includes('SLOT_UNAVAILABLE')) return { code: 'SLOT_UNAVAILABLE', message: 'Seçilen saat artık müsait değil.', status: 409 as const };
  if (message.includes('APPOINTMENT_NOT_FOUND')) return { code: 'APPOINTMENT_NOT_FOUND', message: 'Randevu bulunamadı.', status: 404 as const };
  if (message.includes('APPOINTMENT_NOT_RESCHEDULABLE') || message.includes('INVALID_STATUS_TRANSITION')) return { code: 'INVALID_TRANSITION', message: 'Randevunun mevcut durumunda bu işlem yapılamaz.', status: 409 as const };
  if (message.includes('NOT_ALLOWED')) return { code: 'NOT_ALLOWED', message: 'Bu işletme için işlem yetkiniz yok.', status: 403 as const };
  return { code: 'BOOKING_FAILED', message: fallback, status: 400 as const };
}

function readPage(context: BaseContext, kind: 'bookings' | 'events') {
  const limit = parsePageLimit(context.req.query('limit'));
  const cursor = decodePageCursor(context.req.query('cursor'), kind);
  if (limit === null || cursor === undefined) return null;
  return { limit, cursor };
}

function readFailure(context: BaseContext, data: unknown, status: number, code: string, fallback: string) {
  const message = typeof data === 'object' && data !== null ? String((data as SupabaseError).message ?? '') : '';
  if (message.includes('NOT_ALLOWED')) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işletme için işlem yetkiniz yok.' } }, 403);
  }
  if (message.includes('APPOINTMENT_NOT_FOUND')) {
    return context.json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'Randevu bulunamadı.' } }, 404);
  }
  const unavailable = status === 0 || status >= 500;
  return context.json({
    error: {
      code: unavailable ? `${code}_UNAVAILABLE` : `${code}_FAILED`,
      message: unavailable ? `${fallback} Lütfen tekrar deneyin.` : fallback,
    },
  }, unavailable ? 503 : 502);
}

bookings.get('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const page = readPage(context, 'bookings');
  if (!page) return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa boyutu veya devam anahtarı geçerli değil.' } }, 400);

  const result = await supabaseRequest<Appointment[]>(context.env, 'rest/v1/rpc/list_appointments_page', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_limit: page.limit + 1,
      p_after_starts_at: page.cursor?.at ?? null,
      p_after_id: page.cursor?.id ?? null,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return readFailure(context, result.data, result.status, 'BOOKINGS_READ', 'Randevular okunamadı.');

  const paged = pageResult(result.data ?? [], page.limit, 'bookings', (row) => ({ at: row.starts_at, id: row.id }));
  return context.json({ membership: access.membership, appointments: paged.items, page: paged.page });
});

bookings.post('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context);
  const body = await readJson(context);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 1000);
  if (!key) return context.json({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'İşlem anahtarı eksik.' } }, 400);
  if (customerName.length < 2 || customerName.length > 120 || customerPhone === undefined || customerEmail === undefined || notes === undefined ||
      !isUuid(body?.serviceId) || !isUuid(body?.staffId) || !isTimestamp(body?.startsAt) ||
      (customerEmail !== null && !customerEmail.includes('@'))) {
    return context.json({ error: { code: 'INVALID_BOOKING', message: 'Müşteri, hizmet, personel veya saat bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Appointment | Appointment[]>(context.env, 'rest/v1/rpc/create_appointment', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_idempotency_key: key,
      p_customer_name: customerName,
      p_service_id: body.serviceId,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
      p_customer_phone: customerPhone,
      p_customer_email: customerEmail,
      p_notes: notes,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Randevu oluşturulamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const appointment = Array.isArray(result.data) ? first(result.data) : result.data;
  return context.json({ appointment }, 201);
});

bookings.get('/:id/reschedule-slots', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  const date = context.req.query('date');
  const staffRaw = context.req.query('staffId');
  const step = Number(context.req.query('step') ?? '15');
  const staffId = staffRaw && staffRaw !== 'any' ? staffRaw : null;
  if (!isUuid(appointmentId) || !isDate(date) || (staffId !== null && !isUuid(staffId)) || !Number.isInteger(step) || step < 5 || step > 120) {
    return context.json({ error: { code: 'INVALID_SLOT_QUERY', message: 'Tarih, personel veya slot adımı geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<Slot[]>(context.env, 'rest/v1/rpc/compute_reschedule_slots', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_appointment_id: appointmentId,
      p_date: date,
      p_staff_id: staffId,
      p_step_minutes: step,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Taşıma için uygun saatler hesaplanamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ slots: result.data ?? [] });
});

bookings.post('/:id/reschedule', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  const key = idempotencyKey(context);
  const body = await readJson(context);
  if (!isUuid(appointmentId) || !key || !isUuid(body?.staffId) || !isTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_RESCHEDULE', message: 'Yeni personel veya saat geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<Appointment | Appointment[]>(context.env, 'rest/v1/rpc/reschedule_appointment', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_appointment_id: appointmentId,
      p_idempotency_key: key,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Randevu taşınamadı.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ appointment: Array.isArray(result.data) ? first(result.data) : result.data });
});

bookings.post('/:id/status', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  const key = idempotencyKey(context);
  const body = await readJson(context);
  const status = body?.status;
  const reason = cleanOptional(body?.reason, 240);
  if (!isUuid(appointmentId) || !key || !['confirmed','completed','no_show','cancelled'].includes(String(status)) || reason === undefined) {
    return context.json({ error: { code: 'INVALID_STATUS', message: 'Randevu durumu veya açıklama geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<Appointment | Appointment[]>(context.env, 'rest/v1/rpc/set_appointment_status', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_appointment_id: appointmentId,
      p_idempotency_key: key,
      p_status: status,
      p_reason: reason,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = rpcMessage(result.data, 'Randevu durumu güncellenemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ appointment: Array.isArray(result.data) ? first(result.data) : result.data });
});

bookings.get('/:id/events', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const appointmentId = context.req.param('id');
  if (!isUuid(appointmentId)) return context.json({ error: { code: 'INVALID_APPOINTMENT', message: 'Randevu kimliği geçerli değil.' } }, 400);
  const page = readPage(context, 'events');
  if (!page) return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa boyutu veya devam anahtarı geçerli değil.' } }, 400);

  const result = await supabaseRequest<AppointmentEvent[]>(context.env, 'rest/v1/rpc/list_appointment_events_page', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_appointment_id: appointmentId,
      p_limit: page.limit + 1,
      p_after_created_at: page.cursor?.at ?? null,
      p_after_id: page.cursor?.id ?? null,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return readFailure(context, result.data, result.status, 'EVENTS_READ', 'Randevu geçmişi okunamadı.');

  const paged = pageResult(result.data ?? [], page.limit, 'events', (row) => ({ at: row.created_at, id: row.id }));
  return context.json({ events: paged.items, page: paged.page });
});

export default bookings;
