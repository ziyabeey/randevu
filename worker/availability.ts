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
type RpcError = { message?: string };
type OnboardingSnapshot = {
  business: { id: string; timezone: string };
  business_hours: unknown[];
  staff_hours: unknown[];
};
type HourVersionRow = { starts_local: string; ends_local: string };

type AvailabilitySlot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};

type AvailabilityBlock = {
  id: string;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  active: boolean;
};

type GroupSlot = {
  starts_at: string;
  ends_at: string;
  timezone: string;
  total_duration_minutes: number;
  lines: unknown;
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

// F11-02: a reservation is an ordered list of services. Staff is optional per
// line; when it is omitted the server picks the real assignment while it
// commits the plan. The line ceiling mirrors the K03 group budget.
const GROUP_LINE_LIMIT = 10;

type GroupLineInput = { serviceId: string; staffId: string | null };

function parseGroupLines(value: unknown): GroupLineInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > GROUP_LINE_LIMIT) return null;
  const lines: GroupLineInput[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    if (!isUuid(candidate.serviceId)) return null;
    const staffRaw = candidate.staffId;
    const staffId = staffRaw === null || staffRaw === undefined || staffRaw === '' || staffRaw === 'any'
      ? null
      : staffRaw;
    if (staffId !== null && !isUuid(staffId)) return null;
    lines.push({ serviceId: candidate.serviceId, staffId });
  }
  return lines;
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

function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null ? String((data as RpcError).message ?? '') : '';
}

function mutationError(message: string, fallbackCode: string, fallbackMessage: string) {
  if (message.includes('STALE_WRITE')) {
    return { code: 'STALE_WRITE', message: 'Çalışma ayarları başka bir oturumda değişti. Güncel bilgileri yükleyip tekrar deneyin.', status: 409 as const };
  }
  if (message.includes('AVAILABILITY_BLOCKS_LIMIT_EXCEEDED')) {
    return { code: 'AVAILABILITY_BLOCKS_LIMIT_EXCEEDED', message: 'Aktif izin ve kapanış sayısı güvenli sınıra ulaştı.', status: 409 as const };
  }
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işlem için işletme sahibi veya yönetici yetkisi gerekli.', status: 403 as const };
  }
  if (message.includes('STAFF_NOT_FOUND') || message.includes('BUSINESS_NOT_FOUND')) {
    return { code: 'AVAILABILITY_TARGET_NOT_FOUND', message: 'İşletme veya personel bu çalışma alanında bulunamadı.', status: 404 as const };
  }
  return { code: fallbackCode, message: fallbackMessage, status: 400 as const };
}

function normalizedIntervals(rows: HourVersionRow[]) {
  return rows.map((row) => ({
    start: String(row.starts_local).slice(0, 5),
    end: String(row.ends_local).slice(0, 5),
  }));
}

async function readCurrentIntervals(
  env: AuthEnv,
  accessToken: string,
  path: string,
) {
  const result = await supabaseRequest<HourVersionRow[]>(env, path, {}, accessToken);
  if (!result.ok) return { error: 'READ_FAILED' as const };
  const rows = result.data ?? [];
  if (rows.length > 8) return { error: 'LIMIT_EXCEEDED' as const };
  return { intervals: normalizedIntervals(rows) };
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

async function requireManager(context: Parameters<typeof requireMember>[0]) {
  const access = await requireStandardMember(context);
  if ('error' in access) return access;
  if (!canManage(access.membership)) {
    return {
      error: context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için işletme sahibi veya yönetici yetkisi gerekli.' } }, 403),
    } as const;
  }
  return access;
}

availability.get('/setup', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const businessId = access.membership.business_id;

  const [snapshotResult, blocksResult] = await Promise.all([
    supabaseRequest<OnboardingSnapshot[]>(context.env, 'rest/v1/rpc/get_business_onboarding_snapshot', {
      method: 'POST',
      body: JSON.stringify({ p_business_id: businessId }),
    }, access.auth.accessToken),
    supabaseRequest<AvailabilityBlock[]>(
      context.env,
      `rest/v1/availability_blocks?select=id,staff_id,starts_at,ends_at,reason,active&business_id=eq.${businessId}&active=eq.true&order=starts_at.asc,id.asc&limit=101`,
      {},
      access.auth.accessToken,
    ),
  ]);

  if (!snapshotResult.ok) {
    const message = rpcMessage(snapshotResult.data);
    if (message.includes('ONBOARDING_BUSINESS_HOURS_LIMIT_EXCEEDED')
        || message.includes('ONBOARDING_STAFF_HOURS_LIMIT_EXCEEDED')
        || message.includes('CATALOG_')) {
      return context.json({ error: { code: 'AVAILABILITY_LIMIT_EXCEEDED', message: 'Çalışma ayarları güvenli snapshot sınırını aşıyor.' } }, 409);
    }
    return context.json({ error: { code: 'AVAILABILITY_READ_FAILED', message: 'Müsaitlik ayarları okunamadı.' } }, 502);
  }
  if (!blocksResult.ok) {
    return context.json({ error: { code: 'AVAILABILITY_READ_FAILED', message: 'Müsaitlik ayarları okunamadı.' } }, 502);
  }
  if ((blocksResult.data?.length ?? 0) > 100) {
    return context.json({ error: { code: 'AVAILABILITY_BLOCKS_LIMIT_EXCEEDED', message: 'Aktif izin ve kapanış sayısı güvenli snapshot sınırını aşıyor.' } }, 409);
  }

  const snapshot = first(snapshotResult.data);
  if (!snapshot || !snapshot.business || !Array.isArray(snapshot.business_hours) || !Array.isArray(snapshot.staff_hours)) {
    return context.json({ error: { code: 'AVAILABILITY_READ_FAILED', message: 'Müsaitlik ayarları okunamadı.' } }, 502);
  }

  return context.json({
    membership: access.membership,
    timezone: snapshot.business.timezone,
    businessHours: snapshot.business_hours,
    staffHours: snapshot.staff_hours,
    blocks: blocksResult.data ?? [],
  });
});

availability.put('/business-hours/:weekday', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;

  const weekday = Number(context.req.param('weekday'));
  const body = await readJson(context);
  const intervals = parseIntervals(body?.intervals);
  const hasExpected = body !== null
    && typeof body === 'object'
    && Object.prototype.hasOwnProperty.call(body, 'expectedIntervals');
  let expectedIntervals = hasExpected ? parseIntervals(body?.expectedIntervals) : null;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || intervals === null || (hasExpected && expectedIntervals === null)) {
    return context.json({ error: { code: 'INVALID_HOURS', message: 'Gün veya saat aralıkları geçerli değil.' } }, 400);
  }

  if (!hasExpected) {
    const query = new URLSearchParams({
      select: 'starts_local,ends_local',
      business_id: `eq.${access.membership.business_id}`,
      weekday: `eq.${weekday}`,
      active: 'eq.true',
      order: 'starts_local.asc,ends_local.asc',
      limit: '9',
    });
    const current = await readCurrentIntervals(
      context.env,
      access.auth.accessToken,
      `rest/v1/business_hours?${query}`,
    );
    if ('error' in current) {
      const status = current.error === 'LIMIT_EXCEEDED' ? 409 : 502;
      const code = current.error === 'LIMIT_EXCEEDED' ? 'AVAILABILITY_LIMIT_EXCEEDED' : 'AVAILABILITY_READ_FAILED';
      return context.json({ error: { code, message: 'Çalışma saatlerinin güncel durumu doğrulanamadı.' } }, status);
    }
    expectedIntervals = current.intervals;
  }

  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/rpc/replace_business_hours_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_weekday: weekday,
      p_intervals: intervals,
      p_expected_intervals: expectedIntervals,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'HOURS_UPDATE_FAILED', 'Çalışma saatleri kaydedilemedi. Aralıkların çakışmadığını kontrol edin.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ hours: result.data ?? [] });
});

availability.put('/staff/:staffId/hours/:weekday', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;

  const staffId = context.req.param('staffId');
  const weekday = Number(context.req.param('weekday'));
  const body = await readJson(context);
  const intervals = parseIntervals(body?.intervals);
  const hasExpected = body !== null
    && typeof body === 'object'
    && Object.prototype.hasOwnProperty.call(body, 'expectedIntervals');
  let expectedIntervals = hasExpected ? parseIntervals(body?.expectedIntervals) : null;
  if (!isUuid(staffId) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6
      || intervals === null || (hasExpected && expectedIntervals === null)) {
    return context.json({ error: { code: 'INVALID_HOURS', message: 'Personel, gün veya saat aralıkları geçerli değil.' } }, 400);
  }

  if (!hasExpected) {
    const query = new URLSearchParams({
      select: 'starts_local,ends_local',
      business_id: `eq.${access.membership.business_id}`,
      staff_id: `eq.${staffId}`,
      weekday: `eq.${weekday}`,
      active: 'eq.true',
      order: 'starts_local.asc,ends_local.asc',
      limit: '9',
    });
    const current = await readCurrentIntervals(
      context.env,
      access.auth.accessToken,
      `rest/v1/staff_hours?${query}`,
    );
    if ('error' in current) {
      const status = current.error === 'LIMIT_EXCEEDED' ? 409 : 502;
      const code = current.error === 'LIMIT_EXCEEDED' ? 'AVAILABILITY_LIMIT_EXCEEDED' : 'AVAILABILITY_READ_FAILED';
      return context.json({ error: { code, message: 'Personel çalışma saatlerinin güncel durumu doğrulanamadı.' } }, status);
    }
    expectedIntervals = current.intervals;
  }

  const result = await supabaseRequest<unknown[]>(context.env, 'rest/v1/rpc/replace_staff_hours_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_staff_id: staffId,
      p_weekday: weekday,
      p_intervals: intervals,
      p_expected_intervals: expectedIntervals,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'STAFF_HOURS_UPDATE_FAILED', 'Personel çalışma saatleri kaydedilemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ hours: result.data ?? [] });
});

availability.post('/blocks', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;

  const body = await readJson(context);
  const date = body?.date;
  const start = body?.start;
  const end = body?.end;
  const staffId = body?.staffId === null || body?.staffId === '' || body?.staffId === undefined ? null : body.staffId;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : null;

  if (!isDate(date) || !validDateHorizon(date) || !isTime(start) || !isTime(end) || (staffId !== null && !isUuid(staffId)) || (reason !== null && reason.length > 240)) {
    return context.json({ error: { code: 'INVALID_BLOCK', message: 'İzin/kapanış bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<unknown>(context.env, 'rest/v1/rpc/create_availability_block_local_guarded', {
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
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'BLOCK_CREATE_FAILED', 'İzin/kapanış kaydedilemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ block: result.data }, 201);
});

availability.delete('/blocks/:id', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;

  const blockId = context.req.param('id');
  if (!isUuid(blockId)) return context.json({ error: { code: 'INVALID_BLOCK', message: 'Kayıt kimliği geçerli değil.' } }, 400);

  const result = await supabaseRequest<boolean>(context.env, 'rest/v1/rpc/delete_availability_block_guarded', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: access.membership.business_id, p_block_id: blockId }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'BLOCK_DELETE_FAILED', 'İzin/kapanış silinemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (result.data !== true) return context.json({ error: { code: 'BLOCK_DELETE_FAILED', message: 'İzin/kapanış bulunamadı.' } }, 404);
  return context.json({ ok: true });
});

availability.get('/slots', async (context) => {
  const access = await requireStandardMember(context);
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

// One engine plans the whole reservation, so the duration and staff shown with
// a group slot are the ones the create path will commit.
availability.post('/group-slots', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;

  const body = await readJson(context);
  const date = body?.date;
  const step = Number(body?.step ?? 15);
  const lines = parseGroupLines(body?.lines);

  if (!isDate(date) || !validDateHorizon(date) || lines === null
      || !Number.isInteger(step) || step < 5 || step > 120) {
    return context.json({ error: { code: 'INVALID_SLOT_QUERY', message: 'Tarih, hizmet listesi veya slot adımı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupSlot[]>(context.env, 'rest/v1/rpc/compute_group_availability_slots', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_date: date,
      p_lines: lines.map((line) => ({ serviceId: line.serviceId, staffId: line.staffId })),
      p_step_minutes: step,
    }),
  }, access.auth.accessToken);

  if (!result.ok) {
    const message = rpcMessage(result.data);
    if (message.includes('GROUP_LINE_LIMIT_EXCEEDED')) {
      return context.json({ error: { code: 'GROUP_LINE_LIMIT_EXCEEDED', message: `Bir randevuda en fazla ${GROUP_LINE_LIMIT} hizmet seçilebilir.` } }, 409);
    }
    if (message.includes('GROUP_SLOT_BUDGET_EXCEEDED')) {
      return context.json({ error: { code: 'GROUP_SLOT_BUDGET_EXCEEDED', message: 'Bu arama çok geniş. Daha büyük bir saat aralığı seçin.' } }, 409);
    }
    if (message.includes('SERVICE_NOT_FOUND')) {
      return context.json({ error: { code: 'SERVICE_NOT_FOUND', message: 'Seçilen hizmetlerden biri bu işletmede bulunamadı.' } }, 404);
    }
    return context.json({ error: { code: 'SLOT_COMPUTE_FAILED', message: 'Uygun saatler hesaplanamadı.' } }, 400);
  }
  return context.json({ slots: result.data ?? [] });
});

export default availability;
