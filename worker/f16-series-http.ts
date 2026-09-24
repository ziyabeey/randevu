import { Hono } from 'hono';
import {
  readJson,
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';

type SeriesLine = { serviceId: string; staffId: string | null };
type SupabaseError = { message?: string };

const series = new Hono<{ Bindings: AuthEnv }>();
const SERIES_LIMIT = 12;
const GROUP_LINE_LIMIT = 10;

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function idempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
}
function cleanOptional(value: unknown, max: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned.length <= max ? (cleaned || null) : undefined;
}
function parseFrequency(value: unknown): 'daily' | 'weekly' | null {
  return value === 'daily' || value === 'weekly' ? value : null;
}
function parseCount(value: unknown) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 2 && count <= SERIES_LIMIT ? count : null;
}
function parseLines(value: unknown): SeriesLine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > GROUP_LINE_LIMIT) return null;
  const lines: SeriesLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (!isUuid(item.serviceId)) return null;
    const staffId = item.staffId === null || item.staffId === undefined
      || item.staffId === '' || item.staffId === 'any'
      ? null : item.staffId;
    if (staffId !== null && !isUuid(staffId)) return null;
    lines.push({ serviceId: item.serviceId, staffId });
  }
  return lines;
}
function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
}
function seriesError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { status: 403 as const, code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { status: 403 as const, code: 'NOT_ALLOWED', message: 'Bu işletme için işlem yetkiniz yok.' };
  }
  if (message.includes('APPOINTMENT_SERIES_NOT_FOUND')) {
    return { status: 404 as const, code: 'APPOINTMENT_SERIES_NOT_FOUND', message: 'Tekrarlayan randevu serisi bulunamadı.' };
  }
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { status: 404 as const, code: 'SERVICE_NOT_FOUND', message: 'Seçilen hizmetlerden biri aktif değil veya bu işletmeye ait değil.' };
  }
  if (message.includes('MIXED_CURRENCY')) {
    return { status: 409 as const, code: 'MIXED_CURRENCY', message: 'Aynı rezervasyondaki hizmetler tek para birimi kullanmalıdır.' };
  }
  if (message.includes('SERIES_OCCURRENCE_UNAVAILABLE')) {
    const match = /SERIES_OCCURRENCE_UNAVAILABLE:(\d+):(\d{4}-\d{2}-\d{2})/.exec(message);
    return {
      status: 409 as const,
      code: 'SERIES_OCCURRENCE_UNAVAILABLE',
      message: match ? `${match[2]} tarihli ${match[1]}. tekrar artık uygun değil.` : 'Serideki bir tekrar artık uygun değil.',
    };
  }
  if (message.includes('SERIES_LOCAL_TIME_UNAVAILABLE')) {
    const date = /SERIES_LOCAL_TIME_UNAVAILABLE:(\d{4}-\d{2}-\d{2})/.exec(message)?.[1];
    return {
      status: 409 as const,
      code: 'SERIES_LOCAL_TIME_UNAVAILABLE',
      message: date ? `${date} tarihinde seçilen yerel saat oluşmuyor.` : 'Seçilen yerel saat bu seri için korunamıyor.',
    };
  }
  if (message.includes('SERIES_LIMIT_EXCEEDED')) {
    return { status: 409 as const, code: 'SERIES_LIMIT_EXCEEDED', message: `Bir seri en fazla ${SERIES_LIMIT} randevu içerebilir.` };
  }
  if (message.includes('INVALID_SERIES_FREQUENCY')) {
    return { status: 400 as const, code: 'INVALID_SERIES_FREQUENCY', message: 'Tekrar sıklığı geçerli değil.' };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { status: 409 as const, code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir seri isteği için kullanılmış.' };
  }
  if (message.includes('DATE_OUT_OF_RANGE')) {
    return { status: 400 as const, code: 'DATE_OUT_OF_RANGE', message: 'Serideki tarihler rezervasyon aralığının dışında.' };
  }
  if (message.includes('GROUP_LINE_LIMIT_EXCEEDED')) {
    return { status: 409 as const, code: 'GROUP_LINE_LIMIT_EXCEEDED', message: `Bir randevuda en fazla ${GROUP_LINE_LIMIT} hizmet seçilebilir.` };
  }
  return { status: 400 as const, code: 'APPOINTMENT_SERIES_FAILED', message: 'Tekrarlayan randevu serisi işlenemedi.' };
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
function rpcFailure(context: any, status: number, data: unknown, unavailableMessage: string) {
  if (upstreamUnavailable(status)) {
    return context.json({ error: { code: 'APPOINTMENT_SERIES_UNAVAILABLE', message: unavailableMessage } }, 503);
  }
  const error = seriesError(rpcMessage(data));
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

series.post('/bookings/series/preview', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const body = await readJson(context);
  const lines = parseLines(body?.lines);
  const frequency = parseFrequency(body?.frequency);
  const count = parseCount(body?.count);
  if (lines === null || !frequency || !count || !isTimestamp(body?.startsAt)) {
    return context.json({
      error: { code: 'INVALID_SERIES_PREVIEW', message: 'Hizmet, başlangıç, tekrar sıklığı veya adet geçerli değil.' },
    }, 400);
  }

  const result = await supabaseRequest<Record<string, unknown>>(
    context.env,
    'rest/v1/rpc/preview_appointment_series',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_lines: lines,
        p_starts_at: body.startsAt,
        p_frequency: frequency,
        p_count: count,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok || !result.data) {
    return rpcFailure(context, result.status, result.data, 'Seri önizlemesi şu anda hazırlanamadı. Lütfen tekrar deneyin.');
  }
  return context.json({ preview: result.data });
});

series.post('/bookings/series', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = await readJson(context);
  const lines = parseLines(body?.lines);
  const frequency = parseFrequency(body?.frequency);
  const count = parseCount(body?.count);
  const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
  const customerPhone = cleanOptional(body?.customerPhone, 40);
  const customerEmail = cleanOptional(body?.customerEmail, 254);
  const notes = cleanOptional(body?.notes, 1000);

  if (!key || lines === null || !frequency || !count || !isTimestamp(body?.startsAt)
      || customerName.length < 2 || customerName.length > 120
      || customerPhone === undefined || customerEmail === undefined || notes === undefined
      || (customerEmail !== null && !customerEmail.includes('@'))) {
    return context.json({
      error: { code: 'INVALID_SERIES_CREATE', message: 'Seri randevu bilgileri geçerli değil.' },
    }, 400);
  }

  const result = await supabaseRequest<Record<string, unknown>>(
    context.env,
    'rest/v1/rpc/create_appointment_series',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_idempotency_key: key,
        p_customer_name: customerName,
        p_lines: lines,
        p_starts_at: body.startsAt,
        p_frequency: frequency,
        p_count: count,
        p_customer_phone: customerPhone,
        p_customer_email: customerEmail,
        p_notes: notes,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok || !result.data) {
    return rpcFailure(context, result.status, result.data, 'Seri oluşturma sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.');
  }
  return context.json({ series: result.data }, 201);
});

series.get('/bookings/series/:seriesId', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const seriesId = context.req.param('seriesId');
  if (!isUuid(seriesId)) {
    return context.json({ error: { code: 'INVALID_SERIES_ID', message: 'Seri kimliği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Record<string, unknown>>(
    context.env,
    'rest/v1/rpc/get_appointment_series',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_series_id: seriesId,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok || !result.data) {
    return rpcFailure(context, result.status, result.data, 'Seri şu anda okunamıyor.');
  }
  return context.json({ series: result.data });
});

export default series;
