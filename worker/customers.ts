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
type SupabaseError = { message?: string };

type Customer = {
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerAppointment = {
  appointment_id: string;
  status: string;
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

const customers = new Hono<{ Bindings: Env }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function cleanCustomerBody(body: Record<string, unknown> | null) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone = cleanOptional(body?.phone, 40);
  const email = cleanOptional(body?.email, 254);
  const notes = cleanOptional(body?.notes, 1000);
  if (name.length < 2 || name.length > 120 || phone === undefined || email === undefined || notes === undefined) return null;
  if (email !== null && (!email.includes('@') || email.startsWith('@') || email.endsWith('@'))) return null;
  return { name, phone, email, notes };
}

function errorMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as SupabaseError).message ?? '')
    : '';
}

function rpcFailure(context: BaseContext, data: unknown, status: number, fallback: string) {
  const message = errorMessage(data);
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return context.json({ error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' } }, 403);
  }
  if (message.includes('NOT_ALLOWED')) {
    return context.json({ error: { code: 'TENANT_FORBIDDEN', message: 'Bu işletmeye erişiminiz yok.' } }, 403);
  }
  if (message.includes('CUSTOMER_NOT_FOUND')) {
    return context.json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri kaydı bulunamadı.' } }, 404);
  }
  if (message.includes('CUSTOMER_CONTACT_EXISTS')) {
    return context.json({ error: { code: 'CUSTOMER_CONTACT_EXISTS', message: 'Bu telefon veya e-posta başka bir müşteri kaydında kullanılıyor.' } }, 409);
  }
  if (message.includes('CUSTOMER_VERSION_CONFLICT')) {
    return context.json({ error: { code: 'CUSTOMER_VERSION_CONFLICT', message: 'Müşteri kaydı başka bir işlemde değişti. Güncel kaydı yükleyip tekrar deneyin.' } }, 409);
  }
  if (message.includes('INVALID_PAGE')) {
    return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa bilgisi geçerli değil.' } }, 400);
  }
  if (message.includes('INVALID_CUSTOMER_') || message.includes('NOTES_TOO_LONG') || message.includes('CUSTOMER_VERSION_REQUIRED')) {
    return context.json({ error: { code: 'INVALID_CUSTOMER', message: 'Müşteri bilgileri geçerli değil.' } }, 400);
  }
  const unavailable = status === 0 || status >= 500;
  return context.json({
    error: {
      code: unavailable ? 'CUSTOMERS_UNAVAILABLE' : 'CUSTOMERS_FAILED',
      message: unavailable ? `${fallback} Lütfen tekrar deneyin.` : fallback,
    },
  }, unavailable ? 503 : 502);
}

function readPage(context: BaseContext, kind: 'customers' | 'customer_history') {
  const limit = parsePageLimit(context.req.query('limit'));
  const cursor = decodePageCursor(context.req.query('cursor'), kind);
  if (limit === null || cursor === undefined) return null;
  return { limit, cursor };
}

customers.get('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const page = readPage(context, 'customers');
  if (!page) return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa boyutu veya devam anahtarı geçerli değil.' } }, 400);
  const search = context.req.query('search')?.trim() ?? '';
  if (search.length > 120) return context.json({ error: { code: 'INVALID_SEARCH', message: 'Arama metni çok uzun.' } }, 400);

  const result = await supabaseRequest<Customer[]>(context.env, 'rest/v1/rpc/list_business_customers_page', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_search: search || null,
      p_limit: page.limit + 1,
      p_after_created_at: page.cursor?.at ?? null,
      p_after_id: page.cursor?.id ?? null,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return rpcFailure(context, result.data, result.status, 'Müşteriler okunamadı.');

  const paged = pageResult(result.data ?? [], page.limit, 'customers', (row) => ({
    at: row.created_at,
    id: row.customer_id,
  }));
  return context.json({ membership: access.membership, customers: paged.items, page: paged.page });
});

customers.post('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const body = cleanCustomerBody(await readJson(context));
  if (!body) return context.json({ error: { code: 'INVALID_CUSTOMER', message: 'Müşteri bilgileri geçerli değil.' } }, 400);

  const result = await supabaseRequest<Customer[] | Customer>(context.env, 'rest/v1/rpc/create_business_customer', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_name: body.name,
      p_phone: body.phone,
      p_email: body.email,
      p_notes: body.notes,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return rpcFailure(context, result.data, result.status, 'Müşteri oluşturulamadı.');
  const customer = Array.isArray(result.data) ? first(result.data) : result.data;
  if (!customer) return context.json({ error: { code: 'CUSTOMERS_FAILED', message: 'Müşteri sonucu alınamadı.' } }, 502);
  return context.json({ customer }, 201);
});

customers.patch('/:id', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const customerId = context.req.param('id');
  const rawBody = await readJson(context);
  const body = cleanCustomerBody(rawBody);
  if (!isUuid(customerId) || !body || !isTimestamp(rawBody?.expectedUpdatedAt)) {
    return context.json({ error: { code: 'INVALID_CUSTOMER', message: 'Müşteri bilgileri geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<Customer[] | Customer>(context.env, 'rest/v1/rpc/update_business_customer', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_customer_id: customerId,
      p_expected_updated_at: rawBody.expectedUpdatedAt,
      p_name: body.name,
      p_phone: body.phone,
      p_email: body.email,
      p_notes: body.notes,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return rpcFailure(context, result.data, result.status, 'Müşteri güncellenemedi.');
  const customer = Array.isArray(result.data) ? first(result.data) : result.data;
  if (!customer) return context.json({ error: { code: 'CUSTOMERS_FAILED', message: 'Müşteri sonucu alınamadı.' } }, 502);
  return context.json({ customer });
});

customers.get('/:id/history', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const customerId = context.req.param('id');
  const page = readPage(context, 'customer_history');
  if (!isUuid(customerId) || !page) {
    return context.json({ error: { code: 'INVALID_PAGE', message: 'Müşteri veya sayfa bilgisi geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<CustomerAppointment[]>(context.env, 'rest/v1/rpc/list_business_customer_appointments_page', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_customer_id: customerId,
      p_limit: page.limit + 1,
      p_after_starts_at: page.cursor?.at ?? null,
      p_after_id: page.cursor?.id ?? null,
    }),
  }, access.auth.accessToken);
  if (!result.ok) return rpcFailure(context, result.data, result.status, 'Randevu geçmişi okunamadı.');

  const paged = pageResult(result.data ?? [], page.limit, 'customer_history', (row) => ({
    at: row.starts_at,
    id: row.appointment_id,
  }));
  return context.json({ appointments: paged.items, page: paged.page });
});

export default customers;
