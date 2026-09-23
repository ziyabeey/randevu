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

type RpcError = { message?: string };
type ProductPayload = Record<string, unknown>;
type ProductPageRow = {
  product: ProductPayload;
  sort_created_at: string;
  sort_id: string;
};
type MovementPayload = Record<string, unknown>;
type MovementPageRow = {
  movement: MovementPayload;
  sort_created_at: string;
  sort_id: string;
};
type ProductContext = Parameters<typeof requireMember>[0];
type ProductAccess = { auth: { accessToken: string }; membership: { business_id: string } };

const products = new Hono<{ Bindings: AuthEnv }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function idempotencyKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  return key.length >= 8 && key.length <= 128 ? key : null;
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function text(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max ? normalized : null;
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

function productError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  if (message.includes('INVENTORY_PERMISSION_REQUIRED') || message.includes('NOT_ALLOWED')) return { code: 'INVENTORY_PERMISSION_REQUIRED', message: 'Ürün ve stok yönetimi için yetkiniz yok.', status: 403 as const };
  if (message.includes('PRICING_PERMISSION_REQUIRED')) return { code: 'PRICING_PERMISSION_REQUIRED', message: 'Ürün satış fiyatını değiştirmek için fiyat yetkiniz yok.', status: 403 as const };
  if (message.includes('PRODUCT_NOT_FOUND')) return { code: 'PRODUCT_NOT_FOUND', message: 'Ürün bulunamadı veya bu işletmeye ait değil.', status: 404 as const };
  if (message.includes('STOCK_MOVEMENT_NOT_FOUND')) return { code: 'STOCK_MOVEMENT_NOT_FOUND', message: 'Stok hareketi bulunamadı.', status: 404 as const };
  if (message.includes('PRODUCT_CODE_EXISTS')) return { code: 'PRODUCT_CODE_EXISTS', message: 'Bu ürün kodu işletmede zaten kullanılıyor.', status: 409 as const };
  if (message.includes('PRODUCT_ARCHIVED')) return { code: 'PRODUCT_ARCHIVED', message: 'Arşivlenmiş ürün değiştirilemez.', status: 409 as const };
  if (message.includes('STALE_WRITE')) return { code: 'STALE_WRITE', message: 'Ürün başka bir işlemde değişti. Güncel hali yükleyip tekrar deneyin.', status: 409 as const };
  if (message.includes('IDEMPOTENCY_CONFLICT')) return { code: 'IDEMPOTENCY_CONFLICT', message: 'Bu işlem anahtarı farklı bir ürün isteği için kullanılmış.', status: 409 as const };
  if (message.includes('NEGATIVE_STOCK')) return { code: 'NEGATIVE_STOCK', message: 'Bu hareket stoğu sıfırın altına indiremez.', status: 409 as const };
  if (message.includes('STOCK_MOVEMENT_ALREADY_REVERSED')) return { code: 'STOCK_MOVEMENT_ALREADY_REVERSED', message: 'Bu stok hareketi daha önce tersine çevrilmiş.', status: 409 as const };
  if (message.includes('STOCK_REVERSAL_SOURCE_INVALID')) return { code: 'STOCK_REVERSAL_SOURCE_INVALID', message: 'Bir reversal hareketi tekrar reversal kaynağı olamaz.', status: 409 as const };
  if (message.includes('INVALID_PAGE')) return { code: 'INVALID_PAGE', message: 'Sayfa bilgisi geçerli değil.', status: 400 as const };
  if (message.includes('INVALID_PRODUCT_FILTER')) return { code: 'INVALID_PRODUCT_FILTER', message: 'Ürün filtresi geçerli değil.', status: 400 as const };
  if (message.includes('INVALID_') || message.includes('STOCK_REASON_REQUIRED')) return { code: 'INVALID_PRODUCT', message: 'Ürün veya stok isteği geçerli değil.', status: 400 as const };
  return { code: 'PRODUCT_WRITE_FAILED', message: 'Ürün veya stok işlemi tamamlanamadı.', status: 400 as const };
}

async function requireStandardMember(context: ProductContext) {
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

async function hasPermission(
  context: ProductContext,
  access: ProductAccess,
  permission: 'inventory_write' | 'pricing_adjustments_write',
) {
  const result = await supabaseRequest<boolean>(
    context.env,
    'rest/v1/rpc/has_financial_permission',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_permission: permission,
      }),
    },
    access.auth.accessToken,
  );
  if (upstreamUnavailable(result.status)) return 'unavailable' as const;
  return result.ok && result.data === true;
}

async function requireInventoryWrite(context: ProductContext) {
  const access = await requireStandardMember(context);
  if ('error' in access) return access;
  const allowed = await hasPermission(context, access, 'inventory_write');
  if (allowed === 'unavailable') {
    return { error: context.json({ error: { code: 'INVENTORY_PERMISSION_UNAVAILABLE', message: 'Stok yetkisi şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503) } as const;
  }
  if (!allowed) {
    return { error: context.json({ error: { code: 'INVENTORY_PERMISSION_REQUIRED', message: 'Ürün ve stok yönetimi için yetkiniz yok.' } }, 403) } as const;
  }
  return access;
}

async function requireCreatePermissions(context: ProductContext) {
  const access = await requireInventoryWrite(context);
  if ('error' in access) return access;
  const pricing = await hasPermission(context, access, 'pricing_adjustments_write');
  if (pricing === 'unavailable') {
    return { error: context.json({ error: { code: 'PRICING_PERMISSION_UNAVAILABLE', message: 'Fiyat yetkisi şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503) } as const;
  }
  if (!pricing) {
    return { error: context.json({ error: { code: 'PRICING_PERMISSION_REQUIRED', message: 'Ürün satış fiyatını belirlemek için fiyat yetkiniz yok.' } }, 403) } as const;
  }
  return access;
}

async function rpcWrite(
  context: ProductContext,
  access: ProductAccess,
  name: string,
  body: Record<string, unknown>,
  successStatus = 200,
) {
  const result = await supabaseRequest<ProductPayload>(
    context.env,
    `rest/v1/rpc/${name}`,
    { method: 'POST', body: JSON.stringify(body) },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({
        error: { code: 'PRODUCT_WRITE_UNAVAILABLE', message: 'Ürün/stok sonucu şu anda doğrulanamıyor. Aynı işlem anahtarıyla tekrar deneyin.' },
      }, 503);
    }
    const error = productError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ product: result.data }, successStatus as 200 | 201);
}

products.get('/products', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const limit = parsePageLimit(context.req.query('limit'));
  const cursor = decodePageCursor(context.req.query('cursor'), 'products');
  const includeRaw = context.req.query('includeArchived') ?? 'false';
  if (limit === null || cursor === undefined || !['true', 'false'].includes(includeRaw)) {
    return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa veya filtre bilgisi geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<ProductPageRow[]>(
    context.env,
    'rest/v1/rpc/list_product_contracts_page',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_include_archived: includeRaw === 'true',
        p_limit: limit + 1,
        p_after_created_at: cursor?.at ?? null,
        p_after_id: cursor?.id ?? null,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) return context.json({ error: { code: 'PRODUCT_READ_UNAVAILABLE', message: 'Ürünler şu anda yüklenemiyor.' } }, 503);
    const error = productError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const page = pageResult(result.data ?? [], limit, 'products', (row) => ({ at: row.sort_created_at, id: row.sort_id }));
  return context.json({ products: page.items.map((row) => row.product), page: page.page });
});

products.get('/products/:id', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const productId = context.req.param('id');
  if (!isUuid(productId)) return context.json({ error: { code: 'INVALID_PRODUCT_ID', message: 'Ürün kimliği geçerli değil.' } }, 400);
  const result = await supabaseRequest<ProductPayload>(
    context.env,
    'rest/v1/rpc/get_product_contract',
    { method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id, p_product_id: productId }) },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) return context.json({ error: { code: 'PRODUCT_READ_UNAVAILABLE', message: 'Ürün şu anda yüklenemiyor.' } }, 503);
    const error = productError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ product: result.data });
});

products.get('/products/:id/stock-movements', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const productId = context.req.param('id');
  const limit = parsePageLimit(context.req.query('limit'));
  const cursor = decodePageCursor(context.req.query('cursor'), 'product_movements');
  if (!isUuid(productId) || limit === null || cursor === undefined) {
    return context.json({ error: { code: 'INVALID_PAGE', message: 'Ürün veya sayfa bilgisi geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<MovementPageRow[]>(
    context.env,
    'rest/v1/rpc/list_product_stock_movements_page',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_product_id: productId,
        p_limit: limit + 1,
        p_after_created_at: cursor?.at ?? null,
        p_after_id: cursor?.id ?? null,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) return context.json({ error: { code: 'PRODUCT_READ_UNAVAILABLE', message: 'Stok hareketleri şu anda yüklenemiyor.' } }, 503);
    const error = productError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const page = pageResult(result.data ?? [], limit, 'product_movements', (row) => ({ at: row.sort_created_at, id: row.sort_id }));
  return context.json({ movements: page.items.map((row) => row.movement), page: page.page });
});

products.post('/products', async (context) => {
  const access = await requireCreatePermissions(context);
  if ('error' in access) return access.error;
  const body = await readJson<Record<string, unknown>>(context);
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const name = text(body.name, 1, 120);
  const code = body.code === null || body.code === undefined || body.code === '' ? null : text(body.code, 1, 64);
  const unit = body.unit === undefined ? 'piece' : text(body.unit, 1, 20);
  const currency = text(body.currency, 3, 3)?.toUpperCase() ?? null;
  if (!key || !name || !unit || !currency || !integer(body.salePriceMinor, 0, 2_147_483_647) || !integer(body.initialQuantity ?? 0, 0, 1_000_000_000)) {
    return context.json({ error: { code: 'INVALID_PRODUCT', message: 'Ürün bilgileri geçerli değil.' } }, 400);
  }
  const payload = { name, code: code?.toUpperCase() ?? null, unit: unit.toLowerCase(), salePriceMinor: body.salePriceMinor, currency, initialQuantity: body.initialQuantity ?? 0 };
  return rpcWrite(context, access, 'create_product_guarded', {
    p_business_id: access.membership.business_id,
    p_name: payload.name,
    p_code: payload.code,
    p_unit: payload.unit,
    p_sale_price_minor: payload.salePriceMinor,
    p_currency: payload.currency,
    p_initial_quantity: payload.initialQuantity,
    p_idempotency_key: key,
    p_request_hash: await requestHash('create_product', payload),
  }, 201);
});

products.put('/products/:id', async (context) => {
  const access = await requireInventoryWrite(context);
  if ('error' in access) return access.error;
  const productId = context.req.param('id');
  const body = await readJson<Record<string, unknown>>(context);
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const name = text(body.name, 1, 120);
  const code = body.code === null || body.code === undefined || body.code === '' ? null : text(body.code, 1, 64);
  const unit = text(body.unit, 1, 20);
  const currency = text(body.currency, 3, 3)?.toUpperCase() ?? null;
  if (!isUuid(productId) || !key || !name || !unit || !currency || !integer(body.salePriceMinor, 0, 2_147_483_647) || !integer(body.expectedVersion, 1, 2_147_483_647)) {
    return context.json({ error: { code: 'INVALID_PRODUCT', message: 'Ürün bilgileri geçerli değil.' } }, 400);
  }
  const payload = { productId, name, code: code?.toUpperCase() ?? null, unit: unit.toLowerCase(), salePriceMinor: body.salePriceMinor, currency, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'update_product_guarded', {
    p_business_id: access.membership.business_id,
    p_product_id: productId,
    p_name: payload.name,
    p_code: payload.code,
    p_unit: payload.unit,
    p_sale_price_minor: payload.salePriceMinor,
    p_currency: payload.currency,
    p_expected_version: payload.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('update_product', payload),
  });
});

products.post('/products/:id/archive', async (context) => {
  const access = await requireInventoryWrite(context);
  if ('error' in access) return access.error;
  const productId = context.req.param('id');
  const body = await readJson<Record<string, unknown>>(context);
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  if (!isUuid(productId) || !key || !integer(body.expectedVersion, 1, 2_147_483_647)) {
    return context.json({ error: { code: 'INVALID_PRODUCT', message: 'Ürün bilgileri geçerli değil.' } }, 400);
  }
  const payload = { productId, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'archive_product_guarded', {
    p_business_id: access.membership.business_id,
    p_product_id: productId,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('archive_product', payload),
  });
});

products.post('/products/:id/stock-movements', async (context) => {
  const access = await requireInventoryWrite(context);
  if ('error' in access) return access.error;
  const productId = context.req.param('id');
  const body = await readJson<Record<string, unknown>>(context);
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const kind = body.kind === 'receipt' || body.kind === 'adjustment' ? body.kind : null;
  const reason = body.reason === undefined || body.reason === null || body.reason === '' ? null : text(body.reason, 2, 240);
  if (!isUuid(productId) || !key || !kind || !integer(body.quantityDelta, -1_000_000_000, 1_000_000_000) || body.quantityDelta === 0 || !integer(body.expectedVersion, 1, 2_147_483_647) || (kind === 'adjustment' && !reason)) {
    return context.json({ error: { code: 'INVALID_STOCK', message: 'Stok hareketi geçerli değil.' } }, 400);
  }
  const payload = { productId, kind, quantityDelta: body.quantityDelta, reason, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'record_product_stock_movement_guarded', {
    p_business_id: access.membership.business_id,
    p_product_id: productId,
    p_kind: kind,
    p_quantity_delta: body.quantityDelta,
    p_reason: reason,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('record_stock', payload),
  }, 201);
});

products.post('/products/:id/stock-movements/:movementId/reverse', async (context) => {
  const access = await requireInventoryWrite(context);
  if ('error' in access) return access.error;
  const productId = context.req.param('id');
  const movementId = context.req.param('movementId');
  const body = await readJson<Record<string, unknown>>(context);
  const key = idempotencyKey(context.req.header('Idempotency-Key'));
  const reason = text(body.reason, 2, 240);
  if (!isUuid(productId) || !isUuid(movementId) || !key || !reason || !integer(body.expectedVersion, 1, 2_147_483_647)) {
    return context.json({ error: { code: 'INVALID_STOCK', message: 'Stok reversal isteği geçerli değil.' } }, 400);
  }
  const payload = { productId, movementId, reason, expectedVersion: body.expectedVersion };
  return rpcWrite(context, access, 'reverse_product_stock_movement_guarded', {
    p_business_id: access.membership.business_id,
    p_product_id: productId,
    p_movement_id: movementId,
    p_reason: reason,
    p_expected_version: body.expectedVersion,
    p_idempotency_key: key,
    p_request_hash: await requestHash('reverse_stock', payload),
  }, 201);
});

export default products;
