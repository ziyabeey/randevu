import { Hono } from 'hono';
import {
  readJson,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';
import {
  cleanReason,
  idempotencyKey,
  integerIn,
  isUuid,
  requestHash,
  requirePaymentsWrite,
  requirePricingWrite,
  requireStandardMember,
  rpcWrite,
  ticketError,
} from './tickets.ts';

// F16-05 service packages. Definitions are pricing-permission writes; sale,
// usage and reversal are ticket commands; the proportional refund is a
// payments-permission ticket command. The tenant always comes from the
// caller's active membership, and every amount is computed by the database.

type PackageContext = Parameters<typeof requireStandardMember>[0];
type PackageAccess = { auth: { accessToken: string }; membership: { business_id: string } };

const packages = new Hono<{ Bindings: AuthEnv }>();

function packageName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 2 && name.length <= 120 ? name : null;
}

async function packageRpc(
  context: PackageContext,
  access: PackageAccess,
  name: string,
  body: Record<string, unknown>,
  wrap: (data: unknown) => Record<string, unknown>,
  successStatus: 200 | 201 = 200,
) {
  const result = await supabaseRequest<unknown>(
    context.env,
    `rest/v1/rpc/${name}`,
    { method: 'POST', body: JSON.stringify(body) },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({
        error: { code: 'PACKAGE_UNAVAILABLE', message: 'Paket bilgisi şu anda doğrulanamıyor. Lütfen tekrar deneyin.' },
      }, 503);
    }
    const message = typeof result.data === 'object' && result.data !== null
      ? String((result.data as { message?: string }).message ?? '')
      : '';
    const error = message.includes('INVALID_PACKAGE')
      ? { code: 'INVALID_PACKAGE', message: 'Paket adı, seans sayısı, süre veya fiyat geçerli değil.', status: 400 as const }
      : ticketError(message);
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json(wrap(result.data), successStatus);
}

function definitionBody(body: Record<string, unknown>) {
  const name = packageName(body.name);
  if (!name
      || !integerIn(body.sessionCount, 1, 100)
      || !integerIn(body.validityDays, 1, 730)
      || !integerIn(body.priceMinor, 0, 100000000)) {
    return null;
  }
  return { name, sessionCount: body.sessionCount, validityDays: body.validityDays, priceMinor: body.priceMinor };
}

packages.get('/service-packages', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  return packageRpc(context, access, 'list_service_packages', {
    p_business_id: access.membership.business_id,
    p_include_inactive: context.req.query('includeInactive') === 'true',
  }, (data) => ({ packages: Array.isArray(data) ? data : [] }));
});

packages.post('/service-packages', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  const definition = definitionBody(body);
  if (!isUuid(body.packageId) || !isUuid(body.serviceId) || !definition) {
    return context.json({ error: { code: 'INVALID_PACKAGE', message: 'Paket adı, hizmet, seans sayısı, süre veya fiyat geçerli değil.' } }, 400);
  }
  return packageRpc(context, access, 'create_service_package_guarded', {
    p_business_id: access.membership.business_id,
    p_package_id: body.packageId,
    p_service_id: body.serviceId,
    p_name: definition.name,
    p_session_count: definition.sessionCount,
    p_validity_days: definition.validityDays,
    p_price_minor: definition.priceMinor,
  }, (data) => ({ package: data }), 201);
});

packages.patch('/service-packages/:id', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const packageId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const definition = definitionBody(body);
  if (!isUuid(packageId) || !definition || typeof body.active !== 'boolean'
      || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PACKAGE', message: 'Paket adı, seans sayısı, süre, fiyat veya sürüm geçerli değil.' } }, 400);
  }
  return packageRpc(context, access, 'update_service_package_guarded', {
    p_business_id: access.membership.business_id,
    p_package_id: packageId,
    p_expected_version: body.expectedVersion,
    p_name: definition.name,
    p_session_count: definition.sessionCount,
    p_validity_days: definition.validityDays,
    p_price_minor: definition.priceMinor,
    p_active: body.active,
  }, (data) => ({ package: data }));
});

packages.get('/customer-packages', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const customerId = context.req.query('customerId');
  if (!isUuid(customerId)) {
    return context.json({ error: { code: 'INVALID_CUSTOMER', message: 'Müşteri bilgisi geçerli değil.' } }, 400);
  }
  return packageRpc(context, access, 'list_customer_packages', {
    p_business_id: access.membership.business_id,
    p_customer_id: customerId,
    p_include_closed: context.req.query('includeClosed') === 'true',
  }, (data) => ({ packages: Array.isArray(data) ? data : [] }));
});

packages.post('/tickets/package-sales', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const body = (await readJson(context)) ?? {};
  if (!key || !isUuid(body.customerId) || !isUuid(body.packageId)
      || !integerIn(body.expectedPackageVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PACKAGE_SALE', message: 'Müşteri, paket veya paket sürümü geçerli değil.' } }, 400);
  }
  const payload = {
    customerId: body.customerId,
    packageId: body.packageId,
    expectedPackageVersion: body.expectedPackageVersion,
  };
  return rpcWrite(context, access, 'open_package_sale_guarded', {
    p_business_id: access.membership.business_id,
    p_customer_id: body.customerId,
    p_package_id: body.packageId,
    p_expected_package_version: body.expectedPackageVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('open_package_sale', payload),
  }, 201);
});

packages.post('/tickets/:id/package-lines', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  if (!key || !isUuid(ticketId) || !isUuid(body.packageId)
      || !integerIn(body.expectedVersion, 1, 2147483647)
      || !integerIn(body.expectedPackageVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PACKAGE_SALE', message: 'Adisyon, paket veya sürüm bilgisi geçerli değil.' } }, 400);
  }
  const payload = {
    ticketId,
    packageId: body.packageId,
    expectedVersion: body.expectedVersion,
    expectedPackageVersion: body.expectedPackageVersion,
  };
  return rpcWrite(context, access, 'add_ticket_package_line_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_package_id: body.packageId,
    p_expected_ticket_version: body.expectedVersion,
    p_expected_package_version: body.expectedPackageVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('add_package_line', payload),
  }, 201);
});

packages.post('/tickets/:id/lines/:lineId/package-usage', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const lineId = context.req.param('lineId');
  const body = (await readJson(context)) ?? {};
  if (!key || !isUuid(ticketId) || !isUuid(lineId) || !isUuid(body.customerPackageId)
      || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PACKAGE_USAGE', message: 'Adisyon, satır, paket veya sürüm bilgisi geçerli değil.' } }, 400);
  }
  const payload = { ticketId, lineId, customerPackageId: body.customerPackageId, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'apply_ticket_package_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_line_id: lineId,
    p_customer_package_id: body.customerPackageId,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('apply_package', payload),
  });
});

packages.post('/tickets/:id/lines/:lineId/package-usage/reverse', async (context) => {
  const access = await requirePricingWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const ticketId = context.req.param('id');
  const lineId = context.req.param('lineId');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  if (!key || !isUuid(ticketId) || !isUuid(lineId) || !reason
      || !integerIn(body.expectedVersion, 1, 2147483647)) {
    return context.json({ error: { code: 'INVALID_PACKAGE_REVERSAL', message: 'Geri alma gerekçesi, satır veya sürüm bilgisi geçerli değil.' } }, 400);
  }
  const payload = { ticketId, lineId, reason, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'reverse_ticket_package_usage_guarded', {
    p_business_id: access.membership.business_id,
    p_ticket_id: ticketId,
    p_line_id: lineId,
    p_reason: reason,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('reverse_package_usage', payload),
  });
});

packages.post('/customer-packages/:id/refund', async (context) => {
  const access = await requirePaymentsWrite(context);
  if ('error' in access) return access.error;
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const customerPackageId = context.req.param('id');
  const body = (await readJson(context)) ?? {};
  const reason = cleanReason(body.reason);
  const sources = Array.isArray(body.sources) ? body.sources : null;
  const validSources = sources !== null
    && sources.length <= 10
    && sources.every((item) => typeof item === 'object' && item !== null
      && isUuid((item as Record<string, unknown>).paymentEventId)
      && integerIn((item as Record<string, unknown>).amountMinor, 1, 100000000))
    && new Set(sources.map((item) => (item as Record<string, unknown>).paymentEventId)).size === sources.length;
  if (!key || !isUuid(customerPackageId) || !reason || !validSources
      || !integerIn(body.expectedRefundMinor, 0, 100000000)) {
    return context.json({ error: { code: 'INVALID_PACKAGE_REFUND', message: 'İade tutarı, tahsilat kaynakları veya gerekçe geçerli değil.' } }, 400);
  }
  const normalizedSources = (sources as Array<Record<string, unknown>>).map((item) => ({
    paymentEventId: item.paymentEventId,
    amountMinor: item.amountMinor,
  }));
  const payload = {
    customerPackageId,
    expectedRefundMinor: body.expectedRefundMinor,
    sources: normalizedSources,
    reason,
  };
  return rpcWrite(context, access, 'refund_customer_package_guarded', {
    p_business_id: access.membership.business_id,
    p_customer_package_id: customerPackageId,
    p_expected_refund_minor: body.expectedRefundMinor,
    p_sources: normalizedSources,
    p_reason: reason,
    p_idempotency_key: key,
    p_request_hash: await requestHash('refund_package', payload),
  }, 201);
});

export default packages;
