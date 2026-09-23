import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
};

const user = { id: 'f1500000-0000-4000-8000-000000000001', email: 'f15@example.test' };
const businessId = 'f1510000-0000-4000-8000-000000000001';
const otherBusinessId = 'f1510000-0000-4000-8000-000000000002';
const membershipId = 'f1520000-0000-4000-8000-000000000001';
const productId = 'f1530000-0000-4000-8000-000000000001';
const movementId = 'f1540000-0000-4000-8000-000000000001';
const csrfValue = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1550000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookieHeader() {
  return [
    `yzt_access=${accessToken()}`,
    'yzt_refresh=f15-refresh',
    `yzt_business=${businessId}`,
    `yzt_csrf=${csrfValue}`,
  ].join('; ');
}

function mutationHeaders(key = 'f1501-http-key-0001') {
  return {
    Origin: 'http://localhost',
    Cookie: cookieHeader(),
    'X-YZT-CSRF': csrfValue,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}

function member(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}

function baseFetch({ role = 'owner', permissions = {}, rpc }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([member(role)]);
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') {
      const body = JSON.parse(init.body);
      assert.equal(body.p_business_id, businessId);
      return json(permissions[body.p_permission] ?? role !== 'staff');
    }
    return rpc(url, init);
  };
}

await test('F15 product list is tenant-bound and read-only for active staff', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([member('staff')]);
    assert.equal(url.pathname, '/rest/v1/rpc/list_product_contracts_page');
    const body = JSON.parse(init.body);
    assert.equal(body.p_business_id, businessId);
    assert.equal(body.p_include_archived, false);
    assert.equal(body.p_limit, 26);
    return json([{
      product: { productId, businessId, name: 'Şampuan', stockOnHand: 5, version: 1, active: true },
      sort_created_at: '2026-09-23T05:00:00.000Z',
      sort_id: productId,
    }]);
  };
  try {
    const response = await app.request('http://localhost/api/products', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.products[0].productId, productId);
    assert.equal(payload.page.hasMore, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15 product create requires inventory and pricing permissions and ignores client business id', async () => {
  const realFetch = globalThis.fetch;
  let guardedCalls = 0;
  globalThis.fetch = baseFetch({
    role: 'staff',
    permissions: { inventory_write: true, pricing_adjustments_write: false },
    rpc: async () => { guardedCalls += 1; throw new Error('unexpected create'); },
  });
  try {
    const denied = await app.request('http://localhost/api/products', {
      method: 'POST',
      headers: mutationHeaders('f1501-create-denied'),
      body: JSON.stringify({
        businessId: otherBusinessId,
        name: 'Şampuan',
        code: 'SAMP-1',
        unit: 'piece',
        salePriceMinor: 25000,
        currency: 'TRY',
        initialQuantity: 5,
      }),
    }, env);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error?.code, 'PRICING_PERMISSION_REQUIRED');
    assert.equal(guardedCalls, 0);
  } finally { globalThis.fetch = realFetch; }

  let rpcBody;
  globalThis.fetch = baseFetch({
    role: 'staff',
    permissions: { inventory_write: true, pricing_adjustments_write: true },
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/create_product_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ productId, businessId, name: 'Şampuan', stockOnHand: 5, version: 1, active: true });
    },
  });
  try {
    const response = await app.request('http://localhost/api/products', {
      method: 'POST',
      headers: mutationHeaders('f1501-create-allowed'),
      body: JSON.stringify({
        businessId: otherBusinessId,
        name: ' Şampuan ',
        code: ' samp-1 ',
        unit: 'piece',
        salePriceMinor: 25000,
        currency: 'try',
        initialQuantity: 5,
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_code, 'SAMP-1');
    assert.equal(rpcBody.p_currency, 'TRY');
    assert.equal(JSON.stringify(rpcBody).includes(otherBusinessId), false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15 product update requires pricing permission at the HTTP boundary', async () => {
  const realFetch = globalThis.fetch;
  let guardedCalls = 0;
  globalThis.fetch = baseFetch({
    role: 'staff',
    permissions: { inventory_write: true, pricing_adjustments_write: false },
    rpc: async () => { guardedCalls += 1; throw new Error('unexpected product update'); },
  });
  try {
    const response = await app.request(`http://localhost/api/products/${productId}`, {
      method: 'PUT',
      headers: mutationHeaders('f1501-update-price-denied'),
      body: JSON.stringify({
        name: 'Şampuan',
        code: 'SAMP-1',
        unit: 'piece',
        salePriceMinor: 26000,
        currency: 'TRY',
        expectedVersion: 1,
      }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PRICING_PERMISSION_REQUIRED');
    assert.equal(guardedCalls, 0);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15 stock movement is versioned, integer-only and uses inventory permission', async () => {
  const realFetch = globalThis.fetch;
  let rpcCalls = 0;
  globalThis.fetch = baseFetch({
    role: 'staff',
    permissions: { inventory_write: true },
    rpc: async (url, init) => {
      rpcCalls += 1;
      assert.equal(url.pathname, '/rest/v1/rpc/record_product_stock_movement_guarded');
      const body = JSON.parse(init.body);
      assert.equal(body.p_business_id, businessId);
      assert.equal(body.p_product_id, productId);
      assert.equal(body.p_kind, 'adjustment');
      assert.equal(body.p_quantity_delta, -2);
      assert.equal(body.p_reason, 'Sayım farkı');
      assert.equal(body.p_expected_version, 3);
      return json({ productId, businessId, stockOnHand: 8, version: 4, active: true });
    },
  });
  try {
    const invalid = await app.request(`http://localhost/api/products/${productId}/stock-movements`, {
      method: 'POST',
      headers: mutationHeaders('f1501-stock-invalid'),
      body: JSON.stringify({ kind: 'adjustment', quantityDelta: -2.5, reason: 'Sayım farkı', expectedVersion: 3 }),
    }, env);
    assert.equal(invalid.status, 400);
    assert.equal(rpcCalls, 0);

    const response = await app.request(`http://localhost/api/products/${productId}/stock-movements`, {
      method: 'POST',
      headers: mutationHeaders('f1501-stock-valid'),
      body: JSON.stringify({ kind: 'adjustment', quantityDelta: -2, reason: '  Sayım farkı  ', expectedVersion: 3 }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).product.stockOnHand, 8);
    assert.equal(rpcCalls, 1);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15 denied inventory permission stops before stock mutation RPC', async () => {
  const realFetch = globalThis.fetch;
  let guarded = 0;
  globalThis.fetch = baseFetch({
    role: 'staff',
    permissions: { inventory_write: false },
    rpc: async () => { guarded += 1; throw new Error('unexpected guarded RPC'); },
  });
  try {
    const response = await app.request(`http://localhost/api/products/${productId}/stock-movements`, {
      method: 'POST',
      headers: mutationHeaders('f1501-stock-denied'),
      body: JSON.stringify({ kind: 'receipt', quantityDelta: 2, expectedVersion: 1 }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'INVENTORY_PERMISSION_REQUIRED');
    assert.equal(guarded, 0);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15 reversal binds product and movement to server-selected business', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = baseFetch({
    permissions: { inventory_write: true },
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/reverse_product_stock_movement_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ productId, businessId, stockOnHand: 5, version: 3, active: true });
    },
  });
  try {
    const response = await app.request(`http://localhost/api/products/${productId}/stock-movements/${movementId}/reverse`, {
      method: 'POST',
      headers: mutationHeaders('f1501-reverse'),
      body: JSON.stringify({ businessId: otherBusinessId, reason: 'Hatalı giriş', expectedVersion: 2 }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_product_id, productId);
    assert.equal(rpcBody.p_movement_id, movementId);
    assert.equal(JSON.stringify(rpcBody).includes(otherBusinessId), false);
  } finally { globalThis.fetch = realFetch; }
});
