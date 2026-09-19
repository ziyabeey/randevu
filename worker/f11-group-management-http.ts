import { Hono, type Context } from 'hono';
import {
  readJson,
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';
import { publicOperation } from './public-rpc.ts';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';

type Env = AuthEnv & PublicAbuseEnv;
type SupabaseError = { message?: string };
type GroupPayload = Record<string, unknown> & { version?: number };
type ManagedAppointment = Record<string, unknown> & {
  appointment_id?: string;
  group_payload?: GroupPayload;
};
type ManagedSlot = Record<string, unknown>;
type ManagedGroupRow = { group_payload?: GroupPayload };

const router = new Hono<{ Bindings: Env }>();

function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
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
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
function idempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
}
function validToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 43
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}
function first<T>(items: T[] | null): T | null {
  return items?.[0] ?? null;
}

function operatorError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işletme için işlem yetkiniz yok.', status: 403 as const };
  }
  if (message.includes('BOOKING_GROUP_NOT_FOUND')) {
    return { code: 'BOOKING_GROUP_NOT_FOUND', message: 'Rezervasyon grubu bulunamadı.', status: 404 as const };
  }
  if (message.includes('BOOKING_GROUP_LINE_NOT_FOUND')) {
    return { code: 'BOOKING_GROUP_LINE_NOT_FOUND', message: 'Rezervasyon hizmet satırı bulunamadı.', status: 404 as const };
  }
  if (message.includes('BOOKING_GROUP_VERSION_CONFLICT')) {
    return { code: 'BOOKING_GROUP_VERSION_CONFLICT', message: 'Rezervasyon başka bir işlemle değişti. Güncel halini açıp tekrar deneyin.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_LEGACY_USE_APPOINTMENT_ENDPOINT')) {
    return { code: 'LEGACY_APPOINTMENT_REQUIRED', message: 'Bu eski tip randevu tek-randevu yönetim yüzeyinden değiştirilmelidir.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_NOT_RESCHEDULABLE')) {
    return { code: 'BOOKING_GROUP_NOT_RESCHEDULABLE', message: 'Bu rezervasyon grubu artık topluca taşınamaz.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_NOT_CANCELLABLE')) {
    return { code: 'BOOKING_GROUP_NOT_CANCELLABLE', message: 'Bu rezervasyon grubu artık topluca iptal edilemez.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_LINE_NOT_CANCELLABLE')) {
    return { code: 'BOOKING_GROUP_LINE_NOT_CANCELLABLE', message: 'Bu hizmet satırı artık iptal edilemez.', status: 409 as const };
  }
  if (message.includes('SLOT_UNAVAILABLE') || message.includes('APPOINTMENT_CONFLICT')) {
    return { code: 'GROUP_SLOT_UNAVAILABLE', message: 'Bu saat artık grubun tamamı için uygun değil.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir değişiklik için kullanılmış.', status: 409 as const };
  }
  if (message.includes('GROUP_SLOT_BUDGET_EXCEEDED')) {
    return { code: 'GROUP_SLOT_BUDGET_EXCEEDED', message: 'Bu arama güvenli hesaplama sınırını aşıyor.', status: 409 as const };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { code: 'DATE_OUT_OF_RANGE', message: 'Seçilen tarih izin verilen aralığın dışında.', status: 400 as const };
  }
  if (message.includes('CANCELLATION_REASON_TOO_LONG') || message.includes('INVALID_GROUP_VERSION')) {
    return { code: 'INVALID_GROUP_MANAGEMENT', message: 'Rezervasyon değişikliği geçerli değil.', status: 400 as const };
  }
  return { code: 'GROUP_MANAGEMENT_FAILED', message: 'Rezervasyon grubu işlenemedi.', status: 400 as const };
}

async function requireStandardMember(context: Parameters<typeof requireMember>[0]) {
  const access = await requireMember(context);
  if ('error' in access) return access;
  if (access.auth.passwordRecovery) {
    return {
      error: context.json({
        error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' },
      }, 403),
    } as const;
  }
  return access;
}

function publicRpcError(data: unknown, fallback: string) {
  const retryAfter = rateLimitFromRpcError(data);
  if (retryAfter) {
    return { code: 'PUBLIC_BOOKING_RATE_LIMITED', message: 'Çok fazla istek yapıldı.', status: 429 as const, retryAfter };
  }
  const message = rpcMessage(data);
  if (message.includes('PUBLIC_BOOKING_GATE_') || message === 'PUBLIC_OPERATION_UNAVAILABLE') {
    return { code: 'MANAGEMENT_UNAVAILABLE', message: 'Randevu yönetimi şu anda kullanılamıyor. Lütfen tekrar deneyin.', status: 503 as const };
  }
  if (message.includes('MANAGEMENT_NOT_FOUND') || message.includes('INVALID_MANAGEMENT_TOKEN')) {
    return { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.', status: 404 as const };
  }
  if (message.includes('MANAGEMENT_GROUP_REQUIRED') || message.includes('BOOKING_GROUP_MUTATION_REQUIRED')) {
    return { code: 'GROUP_MANAGEMENT_REQUIRED', message: 'Bu rezervasyon grup olarak yönetilmelidir.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_VERSION_CONFLICT')) {
    return { code: 'BOOKING_GROUP_VERSION_CONFLICT', message: 'Rezervasyon başka bir işlemle değişti. Güncel halini açıp tekrar deneyin.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_NOT_RESCHEDULABLE')) {
    return { code: 'BOOKING_GROUP_NOT_RESCHEDULABLE', message: 'Bu rezervasyon grubu artık taşınamaz.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_NOT_CANCELLABLE') || message.includes('APPOINTMENT_NOT_MANAGEABLE')) {
    return { code: 'BOOKING_NOT_MANAGEABLE', message: 'Bu rezervasyon artık müşteri tarafından değiştirilemez.', status: 409 as const };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { code: 'DATE_OUT_OF_RANGE', message: 'Seçilen tarih izin verilen rezervasyon aralığının dışında.', status: 400 as const };
  }
  if (message.includes('SLOT_UNAVAILABLE') || message.includes('APPOINTMENT_CONFLICT')) {
    return { code: 'SLOT_UNAVAILABLE', message: 'Bu saat artık uygun değil. Başka bir saat seçin.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir değişiklik için kullanılmış.', status: 409 as const };
  }
  if (message.includes('REASON_TOO_LONG') || message.includes('CANCELLATION_REASON_TOO_LONG')
      || message.includes('INVALID_GROUP_VERSION')) {
    return { code: 'INVALID_MANAGEMENT_REQUEST', message: 'Randevu yönetim isteği geçerli değil.', status: 400 as const };
  }
  return { code: 'MANAGEMENT_FAILED', message: fallback, status: 400 as const };
}

function publicErrorResponse(context: Context<{ Bindings: Env }>, error: ReturnType<typeof publicRpcError>) {
  if ('retryAfter' in error && error.retryAfter) {
    context.header('Retry-After', String(error.retryAfter));
    return context.json(publicRateLimitedBody(error.retryAfter), 429);
  }
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

// ---------------------------------------------------------------------------
// Authenticated operator group surface.
// ---------------------------------------------------------------------------
router.get('/bookings/groups/:groupId', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  if (!isUuid(groupId)) {
    return context.json({ error: { code: 'INVALID_GROUP_ID', message: 'Rezervasyon grup kimliği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupPayload>(context.env, 'rest/v1/rpc/get_booking_group_management', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: access.membership.business_id, p_group_id: groupId }),
  }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_MANAGEMENT_UNAVAILABLE', message: 'Rezervasyon grubu şu anda doğrulanamıyor.' } }, 503);
    }
    const error = operatorError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ group: result.data });
});

router.get('/bookings/groups/:groupId/reschedule-slots', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  const date = context.req.query('date');
  const step = Number(context.req.query('step') ?? '15');
  if (!isUuid(groupId) || !isDate(date) || !Number.isInteger(step) || step < 5 || step > 120) {
    return context.json({ error: { code: 'INVALID_GROUP_SLOT_QUERY', message: 'Grup, tarih veya slot adımı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Record<string, unknown>[]>(context.env, 'rest/v1/rpc/compute_booking_group_reschedule_slots', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_group_id: groupId,
      p_date: date,
      p_step_minutes: step,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_AVAILABILITY_UNAVAILABLE', message: 'Grup müsaitliği şu anda doğrulanamıyor.' } }, 503);
    }
    const error = operatorError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ slots: result.data ?? [] });
});

router.post('/bookings/groups/:groupId/reschedule', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  if (!isUuid(groupId) || !key || !isVersion(body?.expectedVersion) || !isTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_GROUP_RESCHEDULE', message: 'Grup taşıma isteği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupPayload>(context.env, 'rest/v1/rpc/reschedule_appointment_group', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_group_id: groupId,
      p_idempotency_key: key,
      p_expected_version: body.expectedVersion,
      p_starts_at: body.startsAt,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_MANAGEMENT_UNAVAILABLE', message: 'Grup taşıma sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
    }
    const error = operatorError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ group: result.data });
});

router.post('/bookings/groups/:groupId/cancel', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!isUuid(groupId) || !key || !isVersion(body?.expectedVersion) || reason.length > 500) {
    return context.json({ error: { code: 'INVALID_GROUP_CANCEL', message: 'Grup iptal isteği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupPayload>(context.env, 'rest/v1/rpc/cancel_appointment_group', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_group_id: groupId,
      p_idempotency_key: key,
      p_expected_version: body.expectedVersion,
      p_reason: reason || null,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_MANAGEMENT_UNAVAILABLE', message: 'Grup iptal sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
    }
    const error = operatorError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ group: result.data });
});

router.post('/bookings/groups/:groupId/lines/:lineId/cancel', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  const lineId = context.req.param('lineId');
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!isUuid(groupId) || !isUuid(lineId) || !key || !isVersion(body?.expectedVersion) || reason.length > 500) {
    return context.json({ error: { code: 'INVALID_GROUP_LINE_CANCEL', message: 'Hizmet iptal isteği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupPayload>(context.env, 'rest/v1/rpc/cancel_appointment_group_line', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_group_id: groupId,
      p_appointment_id: lineId,
      p_idempotency_key: key,
      p_expected_version: body.expectedVersion,
      p_reason: reason || null,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_MANAGEMENT_UNAVAILABLE', message: 'Hizmet iptal sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
    }
    const error = operatorError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ group: result.data });
});

// ---------------------------------------------------------------------------
// Public /m#token surface. The four historical HTTP routes remain stable. A
// native F11 group is additive on view and opts into group slot/mutation actions
// using the returned optimistic version. Legacy bodies stay byte-shape compatible.
// ---------------------------------------------------------------------------
router.post('/manage/view', async (context) => {
  const body = await readJson(context);
  const token = body?.token;
  if (!validToken(token)) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<ManagedAppointment[]>(context.env, 'manage_view', { p_token: token }, abuse);
  if (!result.ok) return publicErrorResponse(context, publicRpcError(result.data, 'Randevu bilgisi alınamadı.'));
  const managed = first(result.data);
  if (!managed) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }
  const { group_payload: group, ...appointment } = managed;
  return group ? context.json({ appointment, group }) : context.json({ appointment });
});

router.post('/manage/slots', async (context) => {
  const body = await readJson(context);
  const token = body?.token;
  const date = body?.date;
  const groupMode = body?.group === true;
  if (!validToken(token) || !isDate(date)) {
    return context.json({ error: { code: 'INVALID_MANAGEMENT_QUERY', message: 'Tarih veya personel bilgisi geçerli değil.' } }, 400);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  if (groupMode) {
    const step = Number(body?.step ?? 15);
    if (!Number.isInteger(step) || step < 5 || step > 120) {
      return context.json({ error: { code: 'INVALID_MANAGEMENT_QUERY', message: 'Slot adımı geçerli değil.' } }, 400);
    }
    const result = await publicOperation<ManagedSlot[]>(context.env, 'manage_group_slots', {
      p_token: token, p_date: date, p_step_minutes: step,
    }, abuse);
    if (!result.ok) return publicErrorResponse(context, publicRpcError(result.data, 'Uygun saatler hesaplanamadı.'));
    return context.json({ slots: result.data ?? [] });
  }

  const staffRaw = body?.staffId;
  const staffId = staffRaw && staffRaw !== 'any' ? staffRaw : null;
  if (staffId !== null && !isUuid(staffId)) {
    return context.json({ error: { code: 'INVALID_MANAGEMENT_QUERY', message: 'Tarih veya personel bilgisi geçerli değil.' } }, 400);
  }
  const result = await publicOperation<ManagedSlot[]>(context.env, 'manage_slots', {
    p_token: token, p_date: date, p_staff_id: staffId,
  }, abuse);
  if (!result.ok) return publicErrorResponse(context, publicRpcError(result.data, 'Uygun saatler hesaplanamadı.'));
  return context.json({ slots: result.data ?? [] });
});

router.post('/manage/reschedule', async (context) => {
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  const token = body?.token;
  const groupMode = isVersion(body?.expectedVersion);
  if (!validToken(token) || !key || !isTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_RESCHEDULE', message: 'Yeni randevu saati geçerli değil.' } }, 400);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  if (groupMode) {
    const result = await publicOperation<ManagedGroupRow[]>(context.env, 'manage_group_reschedule', {
      p_token: token,
      p_idempotency_key: key,
      p_expected_version: body.expectedVersion,
      p_starts_at: body.startsAt,
    }, abuse);
    if (!result.ok) return publicErrorResponse(context, publicRpcError(result.data, 'Rezervasyon taşınamadı.'));
    const group = first(result.data)?.group_payload;
    if (!group) return context.json({ error: { code: 'MANAGEMENT_FAILED', message: 'Rezervasyon sonucu alınamadı.' } }, 502);
    return context.json({ group });
  }

  if (!isUuid(body?.staffId)) {
    return context.json({ error: { code: 'INVALID_RESCHEDULE', message: 'Yeni randevu saati geçerli değil.' } }, 400);
  }
  const result = await publicOperation<ManagedAppointment[]>(context.env, 'manage_reschedule', {
    p_token: token,
    p_idempotency_key: key,
    p_staff_id: body.staffId,
    p_starts_at: body.startsAt,
  }, abuse);
  if (!result.ok) return publicErrorResponse(context, publicRpcError(result.data, 'Randevu taşınamadı.'));
  const appointment = first(result.data);
  if (!appointment) return context.json({ error: { code: 'MANAGEMENT_FAILED', message: 'Randevu sonucu alınamadı.' } }, 502);
  return context.json({ appointment });
});

router.post('/manage/cancel', async (context) => {
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  const token = body?.token;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const groupMode = isVersion(body?.expectedVersion);
  if (!validToken(token) || !key || reason.length > 500) {
    return context.json({ error: { code: 'INVALID_CANCEL', message: 'İptal isteği geçerli değil.' } }, 400);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);

  if (groupMode) {
    const result = await publicOperation<ManagedGroupRow[]>(context.env, 'manage_group_cancel', {
      p_token: token,
      p_idempotency_key: key,
      p_expected_version: body.expectedVersion,
      p_reason: reason || null,
    }, abuse);
    if (!result.ok) return publicErrorResponse(context, publicRpcError(result.data, 'Rezervasyon iptal edilemedi.'));
    const group = first(result.data)?.group_payload;
    if (!group) return context.json({ error: { code: 'MANAGEMENT_FAILED', message: 'Rezervasyon sonucu alınamadı.' } }, 502);
    return context.json({ group });
  }

  const result = await publicOperation<ManagedAppointment[]>(context.env, 'manage_cancel', {
    p_token: token,
    p_idempotency_key: key,
    p_reason: reason || null,
  }, abuse);
  if (!result.ok) return publicErrorResponse(context, publicRpcError(result.data, 'Randevu iptal edilemedi.'));
  const appointment = first(result.data);
  if (!appointment) return context.json({ error: { code: 'MANAGEMENT_FAILED', message: 'Randevu sonucu alınamadı.' } }, 502);
  return context.json({ appointment });
});

export default router;
