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

const user = { id: 'f1a50000-0000-4000-8000-000000000001', email: 'f1605@example.test' };
const businessId = 'f1a51000-0000-4000-8000-000000000001';
const membershipId = 'f1a52000-0000-4000-8000-000000000001';
const customerId = 'f1a53000-0000-4000-8000-000000000001';
const serviceId = 'f1a54000-0000-4000-8000-000000000001';
const packageId = 'f1a55000-0000-4000-8000-000000000001';
const customerPackageId = 'f1a56000-0000-4000-8000-000000000001';
const ticketId = 'f1a57000-0000-4000-8000-000000000001';
const lineId = 'f1a58000-0000-4000-8000-000000000001';
const paymentId = 'f1a59000-0000-4000-8000-000000000001';
const foreignBusiness = 'f1a51000-0000-4000-8000-000000000099';
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken() {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1a5a000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${h}.${p}.sig`;
}

function cookie() {
  return [`yzt_access=${accessToken()}`, 'yzt_refresh=f16-refresh', `yzt_business=${businessId}`, `yzt_csrf=${csrf}`].join('; ');
}

function headers(key) {
  const result = { Origin: 'http://localhost', Cookie: cookie(), 'X-YZT-CSRF': csrf, 'Content-Type': 'application/json' };
  if (key) result['Idempotency-Key'] = key;
  return result;
}

function withFetch({ permissions = {}, rpc }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([{ id: membershipId, business_id: businessId, role: 'owner', active: true }]);
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') {
      const body = JSON.parse(init.body);
      return json(permissions[body.p_permission] ?? true);
    }
    return rpc(url, init);
  };
}

async function withMockedFetch(mock, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = realFetch; }
}

await test('F16-05 package definition create derives the tenant and forwards only validated fields', async () => {
  let rpcBody;
  await withMockedFetch(withFetch({
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/create_service_package_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ packageId, businessId, name: '5 Seans Lazer', version: 1 });
    },
  }), async () => {
    const response = await app.request('http://localhost/api/service-packages', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        packageId, serviceId, name: '  5 Seans Lazer ', sessionCount: 5, validityDays: 90, priceMinor: 100000,
        businessId: foreignBusiness, unitValueMinor: 1,
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).package.packageId, packageId);
    assert.deepEqual(rpcBody, {
      p_business_id: businessId, p_package_id: packageId, p_service_id: serviceId, p_name: '5 Seans Lazer',
      p_session_count: 5, p_validity_days: 90, p_price_minor: 100000,
    });
  });
});

await test('F16-05 invalid definitions and missing pricing permission never reach the guarded RPC', async () => {
  let guarded = 0;
  await withMockedFetch(withFetch({
    permissions: { pricing_adjustments_write: false },
    rpc: async () => { guarded += 1; return json({}); },
  }), async () => {
    const denied = await app.request('http://localhost/api/service-packages', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ packageId, serviceId, name: 'Paket', sessionCount: 5, validityDays: 90, priceMinor: 100000 }),
    }, env);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'FINANCIAL_PERMISSION_REQUIRED');
  });
  await withMockedFetch(withFetch({ rpc: async () => { guarded += 1; return json({}); } }), async () => {
    for (const body of [
      { packageId, serviceId, name: 'P', sessionCount: 5, validityDays: 90, priceMinor: 100000 },
      { packageId, serviceId, name: 'Paket', sessionCount: 0, validityDays: 90, priceMinor: 100000 },
      { packageId, serviceId, name: 'Paket', sessionCount: 101, validityDays: 90, priceMinor: 100000 },
      { packageId, serviceId, name: 'Paket', sessionCount: 5, validityDays: 731, priceMinor: 100000 },
      { packageId, serviceId, name: 'Paket', sessionCount: 5, validityDays: 90, priceMinor: -1 },
      { packageId, serviceId, name: 'Paket', sessionCount: 5, validityDays: 90, priceMinor: 10.5 },
      { packageId: 'nope', serviceId, name: 'Paket', sessionCount: 5, validityDays: 90, priceMinor: 100 },
    ]) {
      const response = await app.request('http://localhost/api/service-packages', { method: 'POST', headers: headers(), body: JSON.stringify(body) }, env);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal((await response.json()).error.code, 'INVALID_PACKAGE');
    }
    const patch = await app.request(`http://localhost/api/service-packages/${packageId}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ name: 'Paket', sessionCount: 5, validityDays: 90, priceMinor: 100, active: 'yes', expectedVersion: 1 }),
    }, env);
    assert.equal(patch.status, 400);
  });
  assert.equal(guarded, 0);
});

await test('F16-05 package list and customer packages are membership reads with tenant from the session', async () => {
  const calls = [];
  await withMockedFetch(withFetch({
    rpc: async (url, init) => {
      calls.push([url.pathname, JSON.parse(init.body)]);
      return json([{ packageId }]);
    },
  }), async () => {
    const list = await app.request('http://localhost/api/service-packages?includeInactive=true', { headers: { Cookie: cookie() } }, env);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).packages, [{ packageId }]);
    const owned = await app.request(`http://localhost/api/customer-packages?customerId=${customerId}&includeClosed=true`, { headers: { Cookie: cookie() } }, env);
    assert.equal(owned.status, 200);
    const bad = await app.request('http://localhost/api/customer-packages?customerId=nope', { headers: { Cookie: cookie() } }, env);
    assert.equal(bad.status, 400);
  });
  assert.deepEqual(calls, [
    ['/rest/v1/rpc/list_service_packages', { p_business_id: businessId, p_include_inactive: true }],
    ['/rest/v1/rpc/list_customer_packages', { p_business_id: businessId, p_customer_id: customerId, p_include_closed: true }],
  ]);
});

await test('F16-05 sale, usage and reversal are idempotent ticket commands with request hashes', async () => {
  const calls = [];
  await withMockedFetch(withFetch({
    rpc: async (url, init) => {
      calls.push([url.pathname, JSON.parse(init.body)]);
      return json({ ticketId, businessId, version: 3, lines: [] });
    },
  }), async () => {
    const sale = await app.request('http://localhost/api/tickets/package-sales', {
      method: 'POST', headers: headers('f1605-http-sale-01'),
      body: JSON.stringify({ customerId, packageId, expectedPackageVersion: 2, priceMinor: 1 }),
    }, env);
    assert.equal(sale.status, 201);
    const line = await app.request(`http://localhost/api/tickets/${ticketId}/package-lines`, {
      method: 'POST', headers: headers('f1605-http-line-01'),
      body: JSON.stringify({ packageId, expectedVersion: 2, expectedPackageVersion: 2 }),
    }, env);
    assert.equal(line.status, 201);
    const use = await app.request(`http://localhost/api/tickets/${ticketId}/lines/${lineId}/package-usage`, {
      method: 'POST', headers: headers('f1605-http-use-01'),
      body: JSON.stringify({ customerPackageId, expectedVersion: 3, discountMinor: 1 }),
    }, env);
    assert.equal(use.status, 200);
    const reverse = await app.request(`http://localhost/api/tickets/${ticketId}/lines/${lineId}/package-usage/reverse`, {
      method: 'POST', headers: headers('f1605-http-rev-01'),
      body: JSON.stringify({ reason: ' Yanlış satır ', expectedVersion: 4 }),
    }, env);
    assert.equal(reverse.status, 200);
  });
  assert.deepEqual(calls.map(([name]) => name), [
    '/rest/v1/rpc/open_package_sale_guarded',
    '/rest/v1/rpc/add_ticket_package_line_guarded',
    '/rest/v1/rpc/apply_ticket_package_guarded',
    '/rest/v1/rpc/reverse_ticket_package_usage_guarded',
  ]);
  for (const [, body] of calls) {
    assert.equal(body.p_business_id, businessId);
    assert.match(body.p_request_hash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(body).includes('discount'), false);
    assert.equal(JSON.stringify(body).includes('p_price'), false);
  }
  assert.equal(calls[0][1].p_idempotency_key, 'f1605-http-sale-01');
  assert.equal(calls[2][1].p_customer_package_id, customerPackageId);
  assert.equal(calls[3][1].p_reason, 'Yanlış satır');
});

await test('F16-05 ticket commands require an idempotency key and valid ids before any RPC', async () => {
  let guarded = 0;
  await withMockedFetch(withFetch({ rpc: async () => { guarded += 1; return json({}); } }), async () => {
    const cases = [
      ['/api/tickets/package-sales', null, { customerId, packageId, expectedPackageVersion: 1 }],
      ['/api/tickets/package-sales', 'f1605-http-bad-01', { customerId, packageId: 'x', expectedPackageVersion: 1 }],
      [`/api/tickets/${ticketId}/package-lines`, 'f1605-http-bad-02', { packageId, expectedVersion: 0, expectedPackageVersion: 1 }],
      [`/api/tickets/${ticketId}/lines/${lineId}/package-usage`, 'f1605-http-bad-03', { customerPackageId: 'x', expectedVersion: 1 }],
      [`/api/tickets/${ticketId}/lines/${lineId}/package-usage/reverse`, 'f1605-http-bad-04', { reason: 'x', expectedVersion: 1 }],
    ];
    for (const [path, key, body] of cases) {
      const response = await app.request(`http://localhost${path}`, { method: 'POST', headers: headers(key), body: JSON.stringify(body) }, env);
      assert.equal(response.status, 400, path);
    }
  });
  assert.equal(guarded, 0);
});

await test('F16-05 refund needs payments permission, validates sources and never forwards a client total', async () => {
  let rpcBody;
  let guarded = 0;
  await withMockedFetch(withFetch({
    permissions: { payments_write: false },
    rpc: async () => { guarded += 1; return json({}); },
  }), async () => {
    const denied = await app.request(`http://localhost/api/customer-packages/${customerPackageId}/refund`, {
      method: 'POST', headers: headers('f1605-http-refund-denied'),
      body: JSON.stringify({ expectedRefundMinor: 60000, sources: [{ paymentEventId: paymentId, amountMinor: 60000 }], reason: 'Taşındı' }),
    }, env);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'PAYMENTS_PERMISSION_REQUIRED');
  });
  await withMockedFetch(withFetch({
    rpc: async (url, init) => {
      guarded += 1;
      assert.equal(url.pathname, '/rest/v1/rpc/refund_customer_package_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ ticketId, businessId, packageRefundedMinor: 60000 });
    },
  }), async () => {
    for (const body of [
      { expectedRefundMinor: 60000, sources: [{ paymentEventId: paymentId, amountMinor: 0 }], reason: 'Taşındı' },
      { expectedRefundMinor: 60000, sources: [{ paymentEventId: paymentId, amountMinor: 1 }, { paymentEventId: paymentId, amountMinor: 1 }], reason: 'Taşındı' },
      { expectedRefundMinor: 60000, sources: 'all', reason: 'Taşındı' },
      { expectedRefundMinor: -1, sources: [], reason: 'Taşındı' },
      { expectedRefundMinor: 60000, sources: [{ paymentEventId: paymentId, amountMinor: 60000 }], reason: '' },
    ]) {
      const response = await app.request(`http://localhost/api/customer-packages/${customerPackageId}/refund`, {
        method: 'POST', headers: headers('f1605-http-refund-bad'), body: JSON.stringify(body),
      }, env);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal(guarded, 0);
    const response = await app.request(`http://localhost/api/customer-packages/${customerPackageId}/refund`, {
      method: 'POST', headers: headers('f1605-http-refund-ok'),
      body: JSON.stringify({
        expectedRefundMinor: 60000,
        sources: [{ paymentEventId: paymentId, amountMinor: 60000, method: 'card' }],
        reason: 'Taşındı',
        businessId: foreignBusiness,
      }),
    }, env);
    assert.equal(response.status, 201);
  });
  assert.equal(rpcBody.p_business_id, businessId);
  assert.equal(rpcBody.p_expected_refund_minor, 60000);
  assert.deepEqual(rpcBody.p_sources, [{ paymentEventId: paymentId, amountMinor: 60000 }]);
  assert.equal(JSON.stringify(rpcBody).includes(foreignBusiness), false);
});

await test('F16-05 package refusals map to exact codes and upstream outages stay retryable', async () => {
  const cases = [
    ['PACKAGE_EXHAUSTED', 409],
    ['PACKAGE_EXPIRED', 409],
    ['PACKAGE_NOT_FOUND', 404],
    ['PACKAGE_CUSTOMER_MISMATCH', 409],
    ['PACKAGE_SERVICE_MISMATCH', 409],
    ['LINE_COVERED_BY_PACKAGE', 409],
    ['PACKAGE_SALE_NOT_SETTLED', 409],
    ['PACKAGE_REFUND_CHANGED', 409],
  ];
  for (const [code, status] of cases) {
    await withMockedFetch(withFetch({ rpc: async () => json({ message: code }, 400) }), async () => {
      const response = await app.request(`http://localhost/api/tickets/${ticketId}/lines/${lineId}/package-usage`, {
        method: 'POST', headers: headers(`f1605-http-${code.toLowerCase().slice(0, 40)}`),
        body: JSON.stringify({ customerPackageId, expectedVersion: 3 }),
      }, env);
      assert.equal(response.status, status, code);
      const body = await response.json();
      assert.equal(body.error.code, code);
      assert.equal(JSON.stringify(body).includes('customer_packages'), false);
    });
  }
  await withMockedFetch(withFetch({ rpc: async () => json({ message: 'upstream' }, 503) }), async () => {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}/lines/${lineId}/package-usage`, {
      method: 'POST', headers: headers('f1605-http-outage'),
      body: JSON.stringify({ customerPackageId, expectedVersion: 3 }),
    }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'TICKET_WRITE_UNAVAILABLE');
  });
});
