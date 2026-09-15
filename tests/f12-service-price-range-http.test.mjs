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
const user = { id: 'e1000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const businessId = 'e2000000-0000-4000-8000-000000000001';
const membershipId = 'e3000000-0000-4000-8000-000000000001';
const serviceId = 'e4000000-0000-4000-8000-000000000001';
const csrf = 'F'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function token(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: 'e6000000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}
function membership(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}
function cookies(method = 'password') {
  return `yzt_access=${token(method)}; yzt_refresh=refresh; yzt_business=${businessId}; yzt_csrf=${csrf}`;
}
function mutationHeaders(method = 'password') {
  return { Origin: 'http://localhost', Cookie: cookies(method), 'X-YZT-CSRF': csrf, 'Content-Type': 'application/json' };
}
function authFetch(role = 'owner', extra) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership(role)]);
    return extra(url, init);
  };
}

await test('F12-03 canonical range create uses selected Membership and integer minor-unit bounds', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = authFetch('manager', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_service_priced_guarded');
    rpcBody = JSON.parse(init.body);
    return json({
      id: serviceId,
      business_id: businessId,
      category: 'Renk',
      sort_order: 20,
      price_type: 'range',
      price_min_minor: 12000,
      price_max_minor: 18000,
      price_minor: 12000,
      price_policy_version: 1,
      currency: 'TRY',
    });
  });
  try {
    const response = await app.request('http://localhost/api/services', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({
        name: 'Renk Paketi', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
        category: 'Renk', sortOrder: 20, priceType: 'range', priceMinMinor: 12000,
        priceMaxMinor: 18000, currency: 'try', businessId: 'forged',
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_category, 'Renk');
    assert.equal(rpcBody.p_sort_order, 20);
    assert.equal(rpcBody.p_price_type, 'range');
    assert.equal(rpcBody.p_price_min_minor, 12000);
    assert.equal(rpcBody.p_price_max_minor, 18000);
    assert.equal(rpcBody.p_currency, 'TRY');
    assert.equal(String(rpcBody.p_business_id).includes('forged'), false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12-03 legacy fixed create remains on the accepted F10-04 RPC', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_service_guarded');
    rpcBody = JSON.parse(init.body);
    return json({ id: serviceId, business_id: businessId, price_minor: 12500, currency: 'TRY' });
  });
  try {
    const response = await app.request('http://localhost/api/services', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({
        name: 'Legacy Kesim', durationMinutes: 45, bufferBeforeMinutes: 5,
        bufferAfterMinutes: 10, priceMinor: 12500,
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_price_minor, 12500);
    assert.equal('p_price_min_minor' in rpcBody, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12-03 invalid or mixed price contracts fail before any mutation RPC', async () => {
  const realFetch = globalThis.fetch;
  let reachedRpc = false;
  globalThis.fetch = authFetch('owner', async () => {
    reachedRpc = true;
    return json({});
  });
  try {
    const inverted = await app.request('http://localhost/api/services', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({
        name: 'Bad Range', durationMinutes: 30, category: 'Genel', sortOrder: 10,
        priceType: 'range', priceMinMinor: 20000, priceMaxMinor: 10000, currency: 'TRY',
      }),
    }, env);
    assert.equal(inverted.status, 400);
    assert.equal((await inverted.json()).error?.code, 'INVALID_SERVICE');

    const fixedMismatch = await app.request('http://localhost/api/services', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({
        name: 'Bad Fixed', durationMinutes: 30, category: 'Genel', sortOrder: 10,
        priceType: 'fixed', priceMinMinor: 10000, priceMaxMinor: 12000, currency: 'TRY',
      }),
    }, env);
    assert.equal(fixedMismatch.status, 400);

    const mixed = await app.request('http://localhost/api/services', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({
        name: 'Mixed Contract', durationMinutes: 30, priceMinor: 10000,
        priceType: 'range', priceMinMinor: 10000, priceMaxMinor: 12000, currency: 'TRY',
      }),
    }, env);
    assert.equal(mixed.status, 400);
    assert.equal(reachedRpc, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12-03 canonical range edit forwards optimistic proof and exact price patch', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/update_service_guarded');
    rpcBody = JSON.parse(init.body);
    return json({ id: serviceId, business_id: businessId, updated_at: '2026-09-15T15:30:01Z' });
  });
  try {
    const expected = '2026-09-15T15:30:00Z';
    const response = await app.request(`http://localhost/api/services/${serviceId}`, {
      method: 'PATCH', headers: mutationHeaders(),
      body: JSON.stringify({
        expectedUpdatedAt: expected,
        category: 'Bakım', sortOrder: 30, priceType: 'range',
        priceMinMinor: 15000, priceMaxMinor: 22000, currency: 'eur',
      }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_service_id, serviceId);
    assert.equal(rpcBody.p_expected_updated_at, expected);
    assert.deepEqual(rpcBody.p_patch, {
      category: 'Bakım', sortOrder: 30, priceType: 'range',
      priceMinMinor: 15000, priceMaxMinor: 22000, currency: 'EUR',
    });
  } finally { globalThis.fetch = realFetch; }
});
