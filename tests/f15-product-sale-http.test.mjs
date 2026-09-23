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

const user = { id: 'f1900000-0000-4000-8000-000000000001', email: 'f1502@example.test' };
const businessId = 'f1910000-0000-4000-8000-000000000001';
const membershipId = 'f1920000-0000-4000-8000-000000000001';
const customerId = 'f1930000-0000-4000-8000-000000000001';
const productId = 'f1940000-0000-4000-8000-000000000001';
const ticketId = 'f1950000-0000-4000-8000-000000000001';
const lineId = 'f1960000-0000-4000-8000-000000000001';
const paymentId = 'f1970000-0000-4000-8000-000000000001';
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken() {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1980000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${h}.${p}.sig`;
}

function cookie() {
  return [
    `yzt_access=${accessToken()}`,
    'yzt_refresh=f15-refresh',
    `yzt_business=${businessId}`,
    `yzt_csrf=${csrf}`,
  ].join('; ');
}

function headers(key) {
  return {
    Origin: 'http://localhost',
    Cookie: cookie(),
    'X-YZT-CSRF': csrf,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}

function member(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}

function withFetch({ permissions = {}, rpc }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([member()]);
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') {
      const body = JSON.parse(init.body);
      return json(permissions[body.p_permission] ?? true);
    }
    return rpc(url, init);
  };
}

await test('F15-02 standalone product sale derives tenant and checks pricing+inventory', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = withFetch({
    permissions: { pricing_adjustments_write: true, inventory_write: true },
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/open_product_sale_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ ticketId, businessId, version: 1, lines: [] });
    },
  });
  try {
    const response = await app.request('http://localhost/api/tickets/product-sales', {
      method: 'POST',
      headers: headers('f1502-http-sale-001'),
      body: JSON.stringify({
        customerId,
        productId,
        quantity: 2,
        expectedProductVersion: 4,
        businessId: 'f1910000-0000-4000-8000-000000000099',
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_product_id, productId);
    assert.equal(rpcBody.p_quantity, 2);
    assert.equal(rpcBody.p_expected_product_version, 4);
    assert.equal(JSON.stringify(rpcBody).includes('000000000099'), false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15-02 product sale fails before guarded RPC when inventory permission is missing', async () => {
  const realFetch = globalThis.fetch;
  let guarded = 0;
  globalThis.fetch = withFetch({
    permissions: { pricing_adjustments_write: true, inventory_write: false },
    rpc: async () => { guarded += 1; throw new Error('unexpected guarded call'); },
  });
  try {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}/product-lines`, {
      method: 'POST',
      headers: headers('f1502-http-sale-denied'),
      body: JSON.stringify({ productId, quantity: 1, expectedVersion: 2, expectedProductVersion: 4 }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'INVENTORY_PERMISSION_REQUIRED');
    assert.equal(guarded, 0);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15-02 product return refund requires payments+inventory and sends explicit returnToStock', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = withFetch({
    permissions: { payments_write: true, inventory_write: true },
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/record_product_return_refund_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ ticketId, businessId, paymentStatus: 'partial', paidMinor: 25000 });
    },
  });
  try {
    const response = await app.request(
      `http://localhost/api/tickets/${ticketId}/lines/${lineId}/product-return-refund`,
      {
        method: 'POST',
        headers: headers('f1502-http-return-001'),
        body: JSON.stringify({
          sourcePaymentEventId: paymentId,
          quantity: 1,
          amountMinor: 25000,
          returnToStock: false,
          reason: 'Hasarlı ürün',
        }),
      },
      env,
    );
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_return_to_stock, false);
    assert.equal(rpcBody.p_amount_minor, 25000);
    assert.equal(rpcBody.p_quantity, 1);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15-02 product return refuses missing inventory permission before refund RPC', async () => {
  const realFetch = globalThis.fetch;
  let guarded = 0;
  globalThis.fetch = withFetch({
    permissions: { payments_write: true, inventory_write: false },
    rpc: async () => { guarded += 1; throw new Error('unexpected guarded call'); },
  });
  try {
    const response = await app.request(
      `http://localhost/api/tickets/${ticketId}/lines/${lineId}/product-return-refund`,
      {
        method: 'POST',
        headers: headers('f1502-http-return-denied'),
        body: JSON.stringify({
          sourcePaymentEventId: paymentId,
          quantity: 1,
          amountMinor: 25000,
          returnToStock: true,
          reason: 'Satılabilir iade',
        }),
      },
      env,
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'INVENTORY_PERMISSION_REQUIRED');
    assert.equal(guarded, 0);
  } finally { globalThis.fetch = realFetch; }
});

await test('F15-02 product return maps return-value refund bounds to explicit 409 codes', async () => {
  for (const code of ['REFUND_EXCEEDS_RETURN_VALUE', 'RETURN_REFUND_BELOW_REQUIRED', 'RETURN_REQUIRES_FINAL_TOTAL']) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = withFetch({
      permissions: { payments_write: true, inventory_write: true },
      rpc: async (url) => {
        assert.equal(url.pathname, '/rest/v1/rpc/record_product_return_refund_guarded');
        return json({ message: code }, 400);
      },
    });
    try {
      const response = await app.request(
        `http://localhost/api/tickets/${ticketId}/lines/${lineId}/product-return-refund`,
        {
          method: 'POST',
          headers: headers(`f1502-http-bound-${code.toLowerCase()}`.slice(0, 64)),
          body: JSON.stringify({
            sourcePaymentEventId: paymentId,
            quantity: 1,
            amountMinor: 10000,
            returnToStock: false,
            reason: 'Sınır kontrolü',
          }),
        },
        env,
      );
      assert.equal(response.status, 409, code);
      assert.equal((await response.json()).error?.code, code);
    } finally { globalThis.fetch = realFetch; }
  }
});
