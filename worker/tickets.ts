import { Hono } from 'hono';
import {
  readJson,
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';

type RpcError = { message?: string };
type TicketPayload = Record<string, unknown>;
type TicketContext = Parameters<typeof requireMember>[0];
type TicketWriteAccess = { auth: { accessToken: string }; membership: { business_id: string } };

const tickets = new Hono<{ Bindings: AuthEnv }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function integerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function idempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
}

function cleanReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason.length >= 2 && reason.length <= 240 ? reason : null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function requestHash(command: string, payload: Record<string, unknown>) {
  return sha256Hex(JSON.stringify({ command, ...payload }));
}

function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null
    ? String((data as RpcError).message ?? '')
    : '';
}

function ticketError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  }
  if (message.includes('PAYMENTS_PERMISSION_REQUIRED')) {
    return { code: 'PAYMENTS_PERMISSION_REQUIRED', message: 'Bu tahsilat işlemi için ödeme yetkiniz yok.', status: 403 as const };
  }
  if (message.includes('FINANCIAL_PERMISSION_REQUIRED') || message.includes('NOT_ALLOWED')) {
    return { code: 'FINANCIAL_PERMISSION_REQUIRED', message: 'Bu adisyon işlemi için mali işlem yetkiniz yok.', status: 403 as const };
  }
  if (message.includes('TICKET_NOT_FOUND')) {
    return { code: 'TICKET_NOT_FOUND', message: 'Adisyon bulunamadı veya bu işletmeye ait değil.', status: 404 as const };
  }
  if (message.includes('BOOKING_GROUP_NOT_FOUND')) {
    return { code: 'BOOKING_GROUP_NOT_FOUND', message: 'Randevu grubu bulunamadı veya bu işletmeye ait değil.', status: 404 as const };
  }
  if (message.includes('BOOKING_GROUP_CANCELLED')) {
    return { code: 'BOOKING_GROUP_CANCELLED', message: 'İptal edilmiş randevudan adisyon açılamaz.', status: 409 as const };
  }
  if (message.includes('CUSTOMER_NOT_FOUND')) {
    return { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri bulunamadı veya bu işletmeye ait değil.', status: 404 as const };
  }
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { code: 'SERVICE_NOT_FOUND', message: 'Hizmet bulunamadı veya aktif değil.', status: 404 as const };
  }
  if (message.includes('STAFF_NOT_FOUND')) {
    return { code: 'STAFF_NOT_FOUND', message: 'Personel bulunamadı veya aktif değil.', status: 404 as const };
  }
  if (message.includes('ASSIGNMENT_NOT_FOUND')) {
    return { code: 'ASSIGNMENT_NOT_FOUND', message: 'Bu personel seçilen hizmet için aktif değil.', status: 409 as const };
  }
  if (message.includes('TICKET_LINE_NOT_FOUND')) {
    return { code: 'TICKET_LINE_NOT_FOUND', message: 'Adisyon satırı bulunamadı.', status: 404 as const };
  }
  if (message.includes('TICKET_NOT_OPEN') || message.includes('TICKET_IMMUTABLE')) {
    return { code: 'TICKET_NOT_OPEN', message: 'Kapalı veya iptal edilmiş adisyon değiştirilemez.', status: 409 as const };
  }
  if (message.includes('STALE_WRITE')) {
    return { code: 'STALE_WRITE', message: 'Adisyon başka bir işlemde değişti. Güncel sonucu yükleyip tekrar deneyin.', status: 409 as const };
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir adisyon isteği için kullanılmış.', status: 409 as const };
  }
  if (message.includes('MIXED_CURRENCY')) {
    return { code: 'MIXED_CURRENCY', message: 'Aynı adisyondaki satırlar tek para birimi kullanmalıdır.', status: 409 as const };
  }
  if (message.includes('SERVICE_PRICE_NOT_FINAL')) {
    return { code: 'SERVICE_PRICE_NOT_FINAL', message: 'Kesin tutarı belirlenmemiş hizmet varken adisyon kapatılamaz.', status: 409 as const };
  }
  if (message.includes('FIXED_PRICE_IMMUTABLE') || message.includes('PRICE_ALREADY_FINAL')) {
    return { code: 'PRICE_ALREADY_FINAL', message: 'Bu hizmetin kesin tutarı zaten belirlenmiş.', status: 409 as const };
  }
  if (message.includes('DISCOUNT_EXCEEDS_LINE')) {
    return { code: 'DISCOUNT_EXCEEDS_LINE', message: 'İskonto hizmet tutarını aşamaz.', status: 409 as const };
  }
  if (message.includes('TICKET_EMPTY')) {
    return { code: 'TICKET_EMPTY', message: 'Satırı olmayan adisyon kapatılamaz.', status: 409 as const };
  }
  if (message.includes('TICKET_LINE_LIMIT_EXCEEDED')) {
    return { code: 'TICKET_LINE_LIMIT_EXCEEDED', message: 'Adisyon satır sayısı güvenli sınırı aşıyor.', status: 409 as const };
  }
  if (message.includes('PAYMENT_REQUIRES_FINAL_TOTAL')) {
    return { code: 'PAYMENT_REQUIRES_FINAL_TOTAL', message: 'Kesinleşmemiş hizmet tutarı varken tahsilat kaydedilemez.', status: 409 as const };
  }
  if (message.includes('TICKET_ALREADY_PAID')) {
    return { code: 'TICKET_ALREADY_PAID', message: 'Adisyonun kalan bakiyesi yok.', status: 409 as const };
  }
  if (message.includes('OVERPAYMENT')) {
    return { code: 'OVERPAYMENT', message: 'Tahsilat kalan bakiyeyi aşamaz.', status: 409 as const };
  }
  if (message.includes('SOURCE_PAYMENT_NOT_FOUND')) {
    return { code: 'SOURCE_PAYMENT_NOT_FOUND', message: 'Kaynak tahsilat bulunamadı.', status: 404 as const };
  }
  if (message.includes('SOURCE_PAYMENT_NEGATIVE')) {
    return { code: 'SOURCE_PAYMENT_NEGATIVE', message: 'Düzeltme kaynak tahsilatın net tutarını sıfırın altına indiremez.', status: 409 as const };
  }
  if (message.includes('REFUND_EXCEEDS_SOURCE')) {
    return { code: 'REFUND_EXCEEDS_SOURCE', message: 'İade kaynak tahsilatın kalan net tutarını aşamaz.', status: 409 as const };
  }
  if (message.includes('TICKET_BALANCE_REMAINS')) {
    return { code: 'TICKET_BALANCE_REMAINS', message: 'Kalan bakiye sıfırlanmadan adisyon kapatılamaz.', status: 409 as const };
  }
  if (message.includes('TICKET_TOTAL_BELOW_PAID')) {
    return { code: 'TICKET_TOTAL_BELOW_PAID', message: 'İskonto mevcut net tahsilatın altında bir toplam oluşturamaz.', status: 409 as const };
  }
  if (message.includes('TICKET_CANCELLED')) {
    return { code: 'TICKET_CANCELLED', message: 'İptal edilmiş adisyona yeni tahsilat eklenemez.', status: 409 as const };
  }
  if (message.includes('TICKET_HAS_FINANCIAL_EVENTS')) {
    return { code: 'TICKET_HAS_FINANCIAL_EVENTS', message: 'Tahsilat başladıktan sonra adisyona yeni hizmet satırı eklenemez.', status: 409 as const };
  }
  if (message.includes('INVALID_')) {
    return { code: 'INVALID_TICKET', message: 'Adisyon isteği geçerli değil.', status: 400 as const };
  }
  return { code: 'TICKET_WRITE_FAILED', message: 'Adisyon işlemi tamamlanamadı.', status: 400 as const };
}

async function requireStandardMember(context: TicketContext) {
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

async function requirePricingWrite(context: TicketContext) {
  const access = await requireStandardMember(context);
  if ('error' in access) return access;

  const permission = await supabaseRequest<boolean>(
    context.env,
    'rest/v1/rpc/has_financial_permission',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_permission: 'pricing_adjustments_write',
      }),
    },
    access.auth.accessToken,
  );

  if (upstreamUnavailable(permission.status)) {
    return {
      error: context.json({
        error: { code: 'FINANCIAL_PERMISSION_UNAVAILABLE', message: 'Mali işlem yetkisi şu anda doğrulanamıyor. Lütfen tekrar deneyin.' },
      }, 503),
    } as const;
  }
  if (!permission.ok || permission.data !== true) {
    return {
      error: context.json({
        error: { code: 'FINANCIAL_PERMISSION_REQUIRED', message: 'Bu adisyon işlemi için mali işlem yetkiniz yok.' },
      }, 403),
    } as const;
  }

  return access;
}

async function requirePaymentsWrite(context: TicketContext) {
  const access = await requireStandardMember(context);
  if ('error' in access) return access;

  const permission = await supabaseRequest<boolean>(
    context.env,
    'rest/v1/rpc/has_financial_permission',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_permission: 'payments_write',
      }),
    },
    access.auth.accessToken,
  );

  if (upstreamUnavailable(permission.status)) {
    return {
      error: context.json({
        error: { code: 'PAYMENTS_PERMISSION_UNAVAILABLE', message: 'Ödeme yetkisi şu anda doğrulanamıyor. Lütfen tekrar deneyin.' },
      }, 503),
    } as const;
  }
  if (!permission.ok || permission.data !== true) {
    return {
      error: context.json({
        error: { code: 'PAYMENTS_PERMISSION_REQUIRED', message: 'Bu tahsilat işlemi için ödeme yetkiniz yok.' },
      }, 403),
    } as const;
  }

  return access;
}

async function rpcWrite(
  context: TicketContext,
  access: TicketWriteAccess,
  name: string,
  body: Record<string, unknown>,
  successStatus = 200,
) {
  const result = await supabaseRequest<TicketPayload>(
    context.env,
    `rest/v1/rpc/${name}`,
    { method: 'POST', body: JSON.stringify(body) },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({
        error: { code: 'TICKET_WRITE_UNAVAILABLE', message: 'Adisyon sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' },
      }, 503);
    }
    const error = ticketError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ ticket: result.data }, successStatus as 200 | 201);
}

tickets.get('/tickets/:id', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const ticketId = context.req.param('id');
  if (!isUuid(ticketId)) {
    return context.json({ error: { code: 'INVALID_TICKET_ID', message: 'Adisyon kimliği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<TicketPayload>(
    context.env,
    'rest/v1/rpc/get_ticket_contract',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_ticket_id: ticketId,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'TICKET_READ_UNAVAILABLE', message: 'Adisyon şu anda yüklenemiyor.' } }, 503);
    }
    const error = ticketError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ ticket: result.data });
});

tickets.post('/tickets/from-booking-group', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = (await readJson(context)) ?? {};
  if (!key || !isUuid(body.bookingGroupId)) {
    return context.json({ error: { code: 'INVALID_TICKET', message: 'Randevu grubu veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const hash = await requestHash('open_from_booking_group', { bookingGroupId: body.bookingGroupId });
  return rpcWrite(context, access, 'open_ticket_from_booking_group_guarded', {
    p_business_id: access.membership.business_id,
    p_group_id: body.bookingGroupId,
    p_idempotency_key: key,
    p_request_hash: hash,
  }, 201);
});

tickets.post('/tickets', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = (await readJson(context)) ?? {};
  if (!key || !isUuid(body.customerId)) {
    return context.json({ error: { code: 'INVALID_TICKET', message: 'Müşteri veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const hash = await requestHash('open_walk_in', { customerId: body.customerId });
  return rpcWrite(context, access, 'open_walk_in_ticket_guarded', {
    p_business_id: access.membership.business_id,
    p_customer_id: body.customerId,
    p_idempotency_key: key,
    p_request_hash: hash,
  }, 201);
});

tickets.post('/tickets/:id/service-lines', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const staffId = body.staffId === null || body.staffId === undefined || body.staffId === '' ? null : body.staffId;
  if (!key || !isUuid(ticketId) || !isUuid(body.serviceId)
      || (staffId !== null && !isUuid(staffId))
      || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_TICKET_LINE', message: 'Hizmet, personel veya sürüm bilgisi geçerli değil.' } }, 400);
  }
  const hash = await requestHash('add_service_line', {
    ticketId,
    serviceId: body.serviceId,
    staffId,
    expectedVersion: body.expectedVersion,
  });
  return rpcWrite(context, access, 'add_ticket_service_line_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_service_id: body.serviceId,
    p_staff_id: staffId,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: hash,
  }, 201);
});

tickets.post('/tickets/:id/lines/:lineId/finalize-price', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const lineId = context.req.param('lineId');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  if (!key || !isUuid(ticketId) || !isUuid(lineId)
      || !integerIn(body.finalUnitPriceMinor, 0, 100000000)
      || !integerIn(body.expectedVersion, 1, 2147483647)
      || !reason) {
    return context.json({ error: { code: 'INVALID_FINAL_PRICE', message: 'Kesin hizmet tutarı, gerekçe veya sürüm geçerli değil.' } }, 400);
  }
  const hash = await requestHash('finalize_service_price', {
    ticketId, lineId, finalUnitPriceMinor: body.finalUnitPriceMinor,
    reason, expectedVersion: body.expectedVersion,
  });
  return rpcWrite(context, access, 'finalize_ticket_service_price_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_line_id: lineId,
    p_final_unit_price_minor: body.finalUnitPriceMinor,
    p_reason: reason,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: hash,
  });
});

tickets.put('/tickets/:id/lines/:lineId/discount', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const lineId = context.req.param('lineId');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  if (!key || !isUuid(ticketId) || !isUuid(lineId)
      || !integerIn(body.discountMinor, 0, 100000000)
      || !integerIn(body.expectedVersion, 1, 2147483647)
      || !reason) {
    return context.json({ error: { code: 'INVALID_DISCOUNT', message: 'İskonto, gerekçe veya sürüm geçerli değil.' } }, 400);
  }
  const hash = await requestHash('set_service_discount', {
    ticketId, lineId, discountMinor: body.discountMinor,
    reason, expectedVersion: body.expectedVersion,
  });
  return rpcWrite(context, access, 'set_ticket_service_discount_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_line_id: lineId,
    p_discount_minor: body.discountMinor,
    p_reason: reason,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: hash,
  });
});

tickets.post('/tickets/:id/close', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  if (!key || !isUuid(ticketId) || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_TICKET_CLOSE', message: 'Adisyon sürümü veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const hash = await requestHash('close_ticket', { ticketId, expectedVersion: body.expectedVersion });
  return rpcWrite(context, access, 'close_ticket_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: hash,
  });
});

tickets.post('/tickets/:id/payments', async (context) => {
  const access = await requirePaymentsWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const method = body.method;
  if (!key || !isUuid(ticketId)
      || (method !== 'cash' && method !== 'card')
      || !integerIn(body.amountMinor, 1, 100000000)) {
    return context.json({ error: { code: 'INVALID_PAYMENT', message: 'Tahsilat yöntemi, tutarı veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const hash = await requestHash('record_payment', {
    ticketId, method, amountMinor: body.amountMinor,
  });
  return rpcWrite(context, access, 'record_ticket_payment_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_payment_method: method,
    p_amount_minor: body.amountMinor,
    p_idempotency_key: key,
    p_request_hash: hash,
  }, 201);
});

tickets.post('/tickets/:id/payments/:paymentId/corrections', async (context) => {
  const access = await requirePaymentsWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const paymentId = context.req.param('paymentId');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  const direction = body.direction;
  if (!key || !isUuid(ticketId) || !isUuid(paymentId)
      || (direction !== 'increase' && direction !== 'decrease')
      || !integerIn(body.amountMinor, 1, 100000000)
      || !reason) {
    return context.json({ error: { code: 'INVALID_CORRECTION', message: 'Düzeltme yönü, tutarı, gerekçesi veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const hash = await requestHash('record_correction', {
    ticketId, paymentId, direction, amountMinor: body.amountMinor, reason,
  });
  return rpcWrite(context, access, 'record_ticket_correction_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_source_payment_event_id: paymentId,
    p_direction: direction,
    p_amount_minor: body.amountMinor,
    p_reason: reason,
    p_idempotency_key: key,
    p_request_hash: hash,
  }, 201);
});

tickets.post('/tickets/:id/payments/:paymentId/refunds', async (context) => {
  const access = await requirePaymentsWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const paymentId = context.req.param('paymentId');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  if (!key || !isUuid(ticketId) || !isUuid(paymentId)
      || !integerIn(body.amountMinor, 1, 100000000)
      || !reason) {
    return context.json({ error: { code: 'INVALID_REFUND', message: 'İade tutarı, gerekçesi veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const hash = await requestHash('record_refund', {
    ticketId, paymentId, amountMinor: body.amountMinor, reason,
  });
  return rpcWrite(context, access, 'record_ticket_refund_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_source_payment_event_id: paymentId,
    p_amount_minor: body.amountMinor,
    p_reason: reason,
    p_idempotency_key: key,
    p_request_hash: hash,
  }, 201);
});

tickets.post('/tickets/:id/cancel', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  if (!key || !isUuid(ticketId) || !integerIn(body.expectedVersion, 1, 2147483647) || !reason) {
    return context.json({ error: { code: 'INVALID_TICKET_CANCEL', message: 'İptal gerekçesi, sürüm veya işlem anahtarı geçerli değil.' } }, 400);
  }
  const hash = await requestHash('cancel_ticket', { ticketId, reason, expectedVersion: body.expectedVersion });
  return rpcWrite(context, access, 'cancel_ticket_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_reason: reason,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: hash,
  });
});

export default tickets;
