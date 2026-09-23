import { Hono } from 'hono';
import {
  readJson,
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';
import {
  decodePageCursor,
  pageResult,
  parsePageLimit,
} from './pagination.ts';

type ExpenseContext = Parameters<typeof requireMember>[0];
type ExpenseAccess = { auth: { accessToken: string }; membership: { business_id: string } };
type RpcError = { message?: string };
type ExpenseEvent = Record<string, unknown>;
type ExpensePageRow = {
  event: ExpenseEvent;
  sort_occurred_at: string;
  sort_id: string;
};

const expenses = new Hono<{ Bindings: AuthEnv }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function idempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
}

function cleanText(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
}

function cleanOptional(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === '') return null;
  return cleanText(value, min, max);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function localWallClock(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return null;
  const [datePart, timePart] = text.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day
      || probe.getUTCHours() !== hour || probe.getUTCMinutes() !== minute || probe.getUTCSeconds() !== second) return null;
  return text;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function requestHash(command: string, payload: Record<string, unknown>) {
  return sha256Hex(JSON.stringify({ command, ...payload }));
}

function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null ? String((data as RpcError).message ?? '') : '';
}

function expenseError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  if (message.includes('EXPENSES_PERMISSION_REQUIRED') || message.includes('NOT_ALLOWED')) return { code: 'EXPENSES_PERMISSION_REQUIRED', message: 'Masraf kaydı için yetkiniz yok.', status: 403 as const };
  if (message.includes('EXPENSE_NOT_FOUND')) return { code: 'EXPENSE_NOT_FOUND', message: 'Masraf kaydı bulunamadı veya bu işletmeye ait değil.', status: 404 as const };
  if (message.includes('EXPENSE_ALREADY_REVERSED')) return { code: 'EXPENSE_ALREADY_REVERSED', message: 'Bu masraf daha önce tersine çevrilmiş.', status: 409 as const };
  if (message.includes('IDEMPOTENCY_CONFLICT')) return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir masraf isteği için kullanılmış.', status: 409 as const };
  if (message.includes('INVALID_PAGE')) return { code: 'INVALID_PAGE', message: 'Sayfa bilgisi geçerli değil.', status: 400 as const };
  if (message.includes('INVALID_')) return { code: 'INVALID_EXPENSE', message: 'Masraf isteği geçerli değil.', status: 400 as const };
  return { code: 'EXPENSE_WRITE_FAILED', message: 'Masraf işlemi tamamlanamadı.', status: 400 as const };
}

async function requireStandardMember(context: ExpenseContext) {
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

async function requireExpenseWrite(context: ExpenseContext) {
  const access = await requireStandardMember(context);
  if ('error' in access) return access;
  const result = await supabaseRequest<boolean>(
    context.env,
    'rest/v1/rpc/has_financial_permission',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_permission: 'expenses_write',
      }),
    },
    access.auth.accessToken,
  );
  if (upstreamUnavailable(result.status)) {
    return { error: context.json({ error: { code: 'EXPENSES_PERMISSION_UNAVAILABLE', message: 'Masraf yetkisi şu anda doğrulanamıyor.' } }, 503) } as const;
  }
  if (!result.ok || result.data !== true) {
    return { error: context.json({ error: { code: 'EXPENSES_PERMISSION_REQUIRED', message: 'Masraf kaydı için yetkiniz yok.' } }, 403) } as const;
  }
  return access;
}

async function rpcWrite(
  context: ExpenseContext,
  access: ExpenseAccess,
  name: string,
  body: Record<string, unknown>,
  status = 200,
) {
  const result = await supabaseRequest<ExpenseEvent>(
    context.env,
    `rest/v1/rpc/${name}`,
    { method: 'POST', body: JSON.stringify(body) },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'EXPENSE_WRITE_UNAVAILABLE', message: 'Masraf sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' } }, 503);
    }
    const error = expenseError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ result: result.data }, status as 200 | 201);
}

expenses.get('/expenses', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;

  const limit = parsePageLimit(context.req.query('limit'));
  const cursor = decodePageCursor(context.req.query('cursor'), 'expenses');
  if (limit === null || cursor === undefined) {
    return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa bilgisi geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<ExpensePageRow[]>(
    context.env,
    'rest/v1/rpc/list_expense_events_page',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_limit: limit + 1,
        p_after_occurred_at: cursor?.at ?? null,
        p_after_id: cursor?.id ?? null,
      }),
    },
    access.auth.accessToken,
  );

  if (!result.ok) {
    if (upstreamUnavailable(result.status)) return context.json({ error: { code: 'EXPENSE_READ_UNAVAILABLE', message: 'Masraflar şu anda yüklenemiyor.' } }, 503);
    const error = expenseError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }

  const page = pageResult(result.data ?? [], limit, 'expenses', (row) => ({ at: row.sort_occurred_at, id: row.sort_id }));
  return context.json({ events: page.items.map((row) => row.event), page: page.page });
});

expenses.post('/expenses', async (context) => {
  const access = await requireExpenseWrite(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const category = cleanText(body.category, 1, 80);
  const description = cleanOptional(body.description, 2, 240);
  const currency = cleanText(body.currency, 3, 3)?.toUpperCase() ?? null;
  const paymentMethod = body.paymentMethod === 'cash' || body.paymentMethod === 'card' ? body.paymentMethod : null;
  const occurredAt = localWallClock(body.occurredAt);
  if (!key || !category || !currency || !paymentMethod || !occurredAt || !integer(body.amountMinor, 1, 100_000_000)) {
    return context.json({ error: { code: 'INVALID_EXPENSE', message: 'Masraf bilgileri geçerli değil.' } }, 400);
  }
  const payload = { category, description, amountMinor: body.amountMinor, currency, paymentMethod, occurredAt };
  return rpcWrite(context, access, 'create_expense_guarded', {
    p_business_id: access.membership.business_id,
    p_category: category,
    p_description: description,
    p_amount_minor: body.amountMinor,
    p_currency: currency,
    p_payment_method: paymentMethod,
    p_occurred_local: occurredAt,
    p_idempotency_key: key,
    p_request_hash: await requestHash('create_expense', payload),
  }, 201);
});

expenses.post('/expenses/:id/reverse', async (context) => {
  const access = await requireExpenseWrite(context);
  if ('error' in access) return access.error;
  const sourceId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const reason = cleanText(body.reason, 2, 240);
  const occurredAt = localWallClock(body.occurredAt);
  if (!isUuid(sourceId) || !key || !reason || !occurredAt) {
    return context.json({ error: { code: 'INVALID_EXPENSE', message: 'Masraf iptal isteği geçerli değil.' } }, 400);
  }
  const payload = { sourceId, reason, occurredAt };
  return rpcWrite(context, access, 'reverse_expense_guarded', {
    p_business_id: access.membership.business_id,
    p_source_event_id: sourceId,
    p_reason: reason,
    p_occurred_local: occurredAt,
    p_idempotency_key: key,
    p_request_hash: await requestHash('reverse_expense', payload),
  }, 201);
});

expenses.post('/expenses/:id/correct', async (context) => {
  const access = await requireExpenseWrite(context);
  if ('error' in access) return access.error;
  const sourceId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const reason = cleanText(body.reason, 2, 240);
  const category = cleanText(body.category, 1, 80);
  const description = cleanOptional(body.description, 2, 240);
  const currency = cleanText(body.currency, 3, 3)?.toUpperCase() ?? null;
  const paymentMethod = body.paymentMethod === 'cash' || body.paymentMethod === 'card' ? body.paymentMethod : null;
  const occurredAt = localWallClock(body.occurredAt);
  const correctionOccurredAt = localWallClock(body.correctionOccurredAt);
  if (!isUuid(sourceId) || !key || !reason || !category || !currency || !paymentMethod
      || !occurredAt || !correctionOccurredAt || !integer(body.amountMinor, 1, 100_000_000)) {
    return context.json({ error: { code: 'INVALID_EXPENSE', message: 'Masraf düzeltme isteği geçerli değil.' } }, 400);
  }
  const payload = {
    sourceId, reason, category, description, amountMinor: body.amountMinor,
    currency, paymentMethod, occurredAt, correctionOccurredAt,
  };
  return rpcWrite(context, access, 'correct_expense_guarded', {
    p_business_id: access.membership.business_id,
    p_source_event_id: sourceId,
    p_reason: reason,
    p_category: category,
    p_description: description,
    p_amount_minor: body.amountMinor,
    p_currency: currency,
    p_payment_method: paymentMethod,
    p_occurred_local: occurredAt,
    p_correction_occurred_local: correctionOccurredAt,
    p_idempotency_key: key,
    p_request_hash: await requestHash('correct_expense', payload),
  }, 201);
});

export default expenses;
