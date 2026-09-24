import { Hono } from 'hono';
import { readJson, supabaseRequest, upstreamUnavailable, type AuthEnv } from './auth.ts';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';
import { promoOperation } from './public-rpc.ts';
import {
  cleanReason,
  idempotencyKey,
  integerIn,
  isUuid,
  requestHash,
  requirePricingWrite,
  requireStandardMember,
  rpcWrite,
  ticketError,
} from './tickets.ts';

// F16-06 promo codes. The customer only ever sends a code: the public preview
// shows the terms, and the reservation is made through the booking's
// management capability (token in the POST body). Members define codes and
// apply/remove them on open tickets. Every amount is computed by the database.

type Env = AuthEnv & PublicAbuseEnv;
type PromoPreviewRow = {
  code: string;
  kind: 'percent' | 'fixed';
  percent_bps: number | null;
  amount_minor: number | null;
  currency: string;
  ends_at: string | null;
  applicable: boolean;
  scoped: boolean;
};
type ManagedPromoRow = {
  code: string | null;
  kind: 'percent' | 'fixed' | null;
  percent_bps: number | null;
  amount_minor: number | null;
  currency: string | null;
  status: 'reserved' | 'consumed' | null;
  attachable: boolean;
};

const promo = new Hono<{ Bindings: Env }>();
const CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}
function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}
function promoCode(value: unknown) {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return CODE.test(code) ? code.toUpperCase() : null;
}
function rpcMessage(data: unknown) {
  if (!data || typeof data !== 'object') return '';
  const value = data as { message?: unknown };
  return typeof value.message === 'string' ? value.message : '';
}

export function promoError(message: string) {
  if (message.includes('PUBLIC_BOOKING_GATE_') || message === 'PUBLIC_OPERATION_UNAVAILABLE') return { code: 'PROMO_UNAVAILABLE', message: 'Kampanya kodu şu anda doğrulanamıyor. Lütfen tekrar deneyin.', status: 503 as const };
  if (message.includes('MANAGEMENT_NOT_FOUND') || message.includes('INVALID_MANAGEMENT_TOKEN')) return { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.', status: 404 as const };
  if (message.includes('PUBLIC_BOOKING_NOT_FOUND')) return { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu salon sayfası şu anda aktif değil.', status: 404 as const };
  if (message.includes('PROMO_NOT_ATTACHABLE')) return { code: 'PROMO_NOT_ATTACHABLE', message: 'Kampanya kodu yalnız yaklaşan ve iptal edilmemiş randevuya eklenebilir.', status: 409 as const };
  if (message.includes('INVALID_PROMO') || message.includes('INVALID_PUBLIC_OPERATION')) return { code: 'INVALID_PROMO', message: 'Kampanya bilgisi geçerli değil.', status: 400 as const };
  return ticketError(message);
}

function publicFailure(context: any, data: unknown) {
  const retryAfter = rateLimitFromRpcError(data);
  if (retryAfter) {
    context.header('Retry-After', String(retryAfter));
    return context.json(publicRateLimitedBody(retryAfter), 429);
  }
  const error = promoError(rpcMessage(data));
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

function managedPromo(row: ManagedPromoRow | undefined) {
  if (!row) return null;
  return {
    code: row.code,
    kind: row.kind,
    percentBps: row.percent_bps,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
    attachable: row.attachable === true,
  };
}

// Public terms preview for the booking form: no usage counts, no customer data.
promo.get('/public/business/:slug/promo', async (context) => {
  const slug = context.req.param('slug');
  const code = promoCode(context.req.query('code'));
  const serviceIds = (context.req.query('serviceIds') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!isSlug(slug)) return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu salon sayfası şu anda aktif değil.' } }, 404);
  if (!code || serviceIds.length > 10 || !serviceIds.every(isUuid)) {
    return context.json({ error: { code: 'INVALID_PROMO', message: 'Kampanya kodu 3–32 harf, rakam veya tire olmalı.' } }, 400);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await promoOperation<PromoPreviewRow[]>(context.env, 'promo_preview', {
    p_slug: slug, p_code: code, p_service_ids: serviceIds,
  }, abuse);
  if (!result.ok) return publicFailure(context, result.data);
  const row = result.data[0];
  if (!row) return context.json({ error: { code: 'PROMO_NOT_FOUND', message: 'Kampanya kodu bulunamadı veya aktif değil.' } }, 404);
  return context.json({
    promo: {
      code: row.code, kind: row.kind, percentBps: row.percent_bps, amountMinor: row.amount_minor,
      currency: row.currency, endsAt: row.ends_at, applicable: row.applicable === true, scoped: row.scoped === true,
    },
  }, 200, { 'Cache-Control': 'no-store' });
});

promo.post('/manage/promo/view', async (context) => {
  const body = await readJson(context);
  if (!validToken(body?.token)) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await promoOperation<ManagedPromoRow[]>(context.env, 'manage_promo_view', { p_token: body.token }, abuse);
  if (!result.ok) return publicFailure(context, result.data);
  const state = managedPromo(result.data[0]);
  if (!state) return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  return context.json({ promo: state }, 200, { 'Cache-Control': 'no-store' });
});

promo.post('/manage/promo', async (context) => {
  const body = await readJson(context);
  const code = promoCode(body?.code);
  if (!validToken(body?.token)) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }
  if (!code) return context.json({ error: { code: 'INVALID_PROMO', message: 'Kampanya kodu 3–32 harf, rakam veya tire olmalı.' } }, 400);
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await promoOperation<ManagedPromoRow[]>(context.env, 'manage_promo_attach', { p_token: body.token, p_code: code }, abuse);
  if (!result.ok) return publicFailure(context, result.data);
  const state = managedPromo(result.data[0]);
  if (!state) return context.json({ error: { code: 'PROMO_UNAVAILABLE', message: 'Kampanya sonucu alınamadı.' } }, 502);
  return context.json({ promo: state }, 201);
});

// Member surface ---------------------------------------------------------------------

type MemberContext = Parameters<typeof requireStandardMember>[0];
type MemberAccess = { auth: { accessToken: string }; membership: { business_id: string } };

async function memberRpc(
  context: MemberContext,
  access: MemberAccess,
  name: string,
  body: Record<string, unknown>,
  wrap: (data: unknown) => Record<string, unknown>,
  successStatus: 200 | 201 = 200,
) {
  const result = await supabaseRequest<unknown>(context.env, `rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }, access.auth.accessToken);
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'PROMO_UNAVAILABLE', message: 'Kampanya bilgisi şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503);
    }
    const error = promoError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json(wrap(result.data), successStatus);
}

function isoInstant(value: unknown) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? new Date(parsed).toISOString() : null;
}

function promoTerms(body: Record<string, unknown>) {
  const kind = body.kind;
  const startsAt = isoInstant(body.startsAt);
  const endsAt = body.endsAt === null || body.endsAt === undefined ? null : isoInstant(body.endsAt);
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds : null;
  const usageLimit = body.usageLimit === null || body.usageLimit === undefined ? null : body.usageLimit;
  if ((kind !== 'percent' && kind !== 'fixed')
      || !startsAt
      || (body.endsAt !== null && body.endsAt !== undefined && !endsAt)
      || (endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
      || (usageLimit !== null && !integerIn(usageLimit, 1, 100000))
      || !serviceIds || serviceIds.length > 50 || !serviceIds.every(isUuid)
      || (kind === 'percent' && (!integerIn(body.percentBps, 1, 10000) || body.amountMinor != null))
      || (kind === 'fixed' && (!integerIn(body.amountMinor, 1, 100000000) || body.percentBps != null))) {
    return null;
  }
  return {
    kind,
    percentBps: kind === 'percent' ? body.percentBps as number : null,
    amountMinor: kind === 'fixed' ? body.amountMinor as number : null,
    startsAt, endsAt, usageLimit: usageLimit as number | null, serviceIds: serviceIds as string[],
  };
}

promo.get('/promo-codes', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  return memberRpc(context, access, 'list_promo_codes', { p_business_id: access.membership.business_id },
    (data) => ({ promoCodes: Array.isArray(data) ? data : [] }));
});

promo.post('/promo-codes', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  const code = promoCode(body.code);
  const terms = promoTerms(body);
  if (!isUuid(body.promoId) || !code || !terms) {
    return context.json({ error: { code: 'INVALID_PROMO', message: 'Kod, indirim türü/değeri, tarih aralığı, kullanım sınırı veya hizmet kapsamı geçerli değil.' } }, 400);
  }
  return memberRpc(context, access, 'create_promo_code_guarded', {
    p_business_id: access.membership.business_id,
    p_promo_id: body.promoId,
    p_code: code,
    p_kind: terms.kind,
    p_percent_bps: terms.percentBps,
    p_amount_minor: terms.amountMinor,
    p_starts_at: terms.startsAt,
    p_ends_at: terms.endsAt,
    p_usage_limit: terms.usageLimit,
    p_service_ids: terms.serviceIds,
  }, (data) => ({ promoCode: data }), 201);
});

promo.patch('/promo-codes/:id', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const promoId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const terms = promoTerms(body);
  if (!isUuid(promoId) || !terms || typeof body.active !== 'boolean' || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PROMO', message: 'İndirim değeri, tarih aralığı, kullanım sınırı, kapsam veya sürüm geçerli değil.' } }, 400);
  }
  return memberRpc(context, access, 'update_promo_code_guarded', {
    p_business_id: access.membership.business_id,
    p_promo_id: promoId,
    p_expected_version: body.expectedVersion,
    p_percent_bps: terms.percentBps,
    p_amount_minor: terms.amountMinor,
    p_starts_at: terms.startsAt,
    p_ends_at: terms.endsAt,
    p_usage_limit: terms.usageLimit,
    p_service_ids: terms.serviceIds,
    p_active: body.active,
  }, (data) => ({ promoCode: data }));
});

promo.post('/tickets/:id/promo', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const code = promoCode(body.code);
  if (!key || !isUuid(ticketId) || !code || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PROMO', message: 'Kampanya kodu, adisyon sürümü veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const payload = { ticketId, code, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'apply_ticket_promo_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_code: code,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('apply_promo', payload),
  });
});

promo.post('/tickets/:id/promo/remove', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  if (!key || !isUuid(ticketId) || !reason || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PROMO_REMOVAL', message: 'Kaldırma gerekçesi, adisyon sürümü veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const payload = { ticketId, reason, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'remove_ticket_promo_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_reason: reason,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('remove_promo', payload),
  });
});

export default promo;
