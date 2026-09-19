import { Hono } from 'hono';
import {
  readJson,
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';

type Env = AuthEnv;
type SupabaseError = { message?: string };
type GroupPayload = Record<string, unknown> & { version?: number };

const router = new Hono<{ Bindings: Env }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
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

function mutationError(message: string) {
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
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { code: 'SERVICE_NOT_FOUND', message: 'Seçilen hizmet bu işletmede bulunamadı veya aktif değil.', status: 404 as const };
  }
  if (message.includes('BOOKING_GROUP_VERSION_CONFLICT')) {
    return { code: 'BOOKING_GROUP_VERSION_CONFLICT', message: 'Rezervasyon başka bir işlemle değişti. Güncel halini açıp tekrar deneyin.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_LEGACY_USE_APPOINTMENT_ENDPOINT')) {
    return { code: 'LEGACY_APPOINTMENT_REQUIRED', message: 'Bu eski tip randevu tek-randevu yönetim yüzeyinden değiştirilmelidir.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_LINE_REPLAN_REQUIRED')) {
    return { code: 'BOOKING_GROUP_LINE_REPLAN_REQUIRED', message: 'Bu değişiklik rezervasyonun zaman planını etkiliyor. Grubu birlikte yeniden planlayın.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_LINE_NOT_CHANGEABLE')) {
    return { code: 'BOOKING_GROUP_LINE_NOT_CHANGEABLE', message: 'Bu hizmet satırı artık değiştirilemez.', status: 409 as const };
  }
  if (message.includes('BOOKING_GROUP_LINE_NOT_RESCHEDULABLE')) {
    return { code: 'BOOKING_GROUP_LINE_NOT_RESCHEDULABLE', message: 'Bu hizmet satırı artık taşınamaz.', status: 409 as const };
  }
  if (message.includes('MIXED_CURRENCY')) {
    return { code: 'MIXED_CURRENCY', message: 'Aynı rezervasyondaki hizmetler farklı para birimlerine çevrilemez.', status: 409 as const };
  }
  if (message.includes('SLOT_UNAVAILABLE') || message.includes('APPOINTMENT_CONFLICT')) {
    return { code: 'GROUP_LINE_SLOT_UNAVAILABLE', message: 'Bu hizmet için seçilen personel veya saat artık uygun değil.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir değişiklik için kullanılmış.', status: 409 as const };
  }
  if (message.includes('INVALID_GROUP_VERSION') || message.includes('INVALID_START')) {
    return { code: 'INVALID_GROUP_LINE_MUTATION', message: 'Hizmet satırı değişikliği geçerli değil.', status: 400 as const };
  }
  return { code: 'GROUP_LINE_MUTATION_FAILED', message: 'Hizmet satırı değiştirilemedi.', status: 400 as const };
}

router.post('/bookings/groups/:groupId/lines/:lineId/service', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  const lineId = context.req.param('lineId');
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  if (!isUuid(groupId) || !isUuid(lineId) || !key || !isVersion(body?.expectedVersion) || !isUuid(body?.serviceId)) {
    return context.json({ error: { code: 'INVALID_GROUP_LINE_SERVICE', message: 'Hizmet değişikliği isteği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupPayload>(context.env, 'rest/v1/rpc/change_appointment_group_line_service', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_group_id: groupId,
      p_appointment_id: lineId,
      p_idempotency_key: key,
      p_expected_version: body.expectedVersion,
      p_service_id: body.serviceId,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_LINE_MUTATION_UNAVAILABLE', message: 'Hizmet değişikliğinin sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
    }
    const error = mutationError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ group: result.data });
});

router.post('/bookings/groups/:groupId/lines/:lineId/reschedule', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  const lineId = context.req.param('lineId');
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  if (!isUuid(groupId) || !isUuid(lineId) || !key || !isVersion(body?.expectedVersion)
      || !isUuid(body?.staffId) || !isTimestamp(body?.startsAt)) {
    return context.json({ error: { code: 'INVALID_GROUP_LINE_RESCHEDULE', message: 'Hizmet taşıma isteği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupPayload>(context.env, 'rest/v1/rpc/reschedule_appointment_group_line', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_group_id: groupId,
      p_appointment_id: lineId,
      p_idempotency_key: key,
      p_expected_version: body.expectedVersion,
      p_staff_id: body.staffId,
      p_starts_at: body.startsAt,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'GROUP_LINE_MUTATION_UNAVAILABLE', message: 'Hizmet taşıma sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
    }
    const error = mutationError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ group: result.data });
});

export default router;
