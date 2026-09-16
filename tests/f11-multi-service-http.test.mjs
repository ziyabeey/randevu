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
const user = { id: 'e8100000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const businessId = 'e8200000-0000-4000-8000-000000000001';
const membershipId = 'e8300000-0000-4000-8000-000000000001';
const serviceA = 'e8400000-0000-4000-8000-000000000001';
const serviceB = 'e8400000-0000-4000-8000-000000000002';
const staffA = 'e8500000-0000-4000-8000-000000000001';
const csrf = 'F'.repeat(43);
const fingerprint = 'a'.repeat(64);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function token(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: 'e8600000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function membership() {
  return { id: membershipId, business_id: businessId, role: 'owner', active: true };
}

function cookies(method = 'password') {
  return `yzt_access=${token(method)}; yzt_refresh=refresh; yzt_business=${businessId}; yzt_csrf=${csrf}`;
}

function mutationHeaders(method = 'password') {
  return {
    Origin: 'http://localhost',
    Cookie: cookies(method),
    'X-YZT-CSRF': csrf,
    'Content-Type': 'application/json',
  };
}

function authFetch(extra) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    return extra(url, init);
  };
}

const lines = [
  { serviceId: serviceA, staffId: staffA },
  { serviceId: serviceB, staffId: null },
];

await test('F11-02 operator group plans derive tenant from selected Membership', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = authFetch(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/compute_booking_group_plans');
    rpcBody = JSON.parse(init.body);
    return json({
      plans: [{
        startsAt: '2026-10-20T10:00:00+03:00',
        endsAt: '2026-10-20T12:00:00+03:00',
        timezone: 'Europe/Istanbul', currency: 'TRY', lowerMinor: 30000, upperMinor: 40000,
        fingerprint, lines: [],
      }],
      truncated: false, stepMinutes: 15, date: '2026-10-20', timezone: 'Europe/Istanbul',
    });
  });
  try {
    const response = await app.request('http://localhost/api/bookings/group/plans', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ date: '2026-10-20', lines, stepMinutes: 15, limit: 25, businessId: 'forged' }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.deepEqual(rpcBody.p_lines, lines);
    assert.equal(rpcBody.p_date, '2026-10-20');
    assert.equal(rpcBody.p_step_minutes, 15);
    assert.equal(rpcBody.p_limit, 25);
    assert.equal(JSON.stringify(rpcBody).includes('forged'), false);
    const payload = await response.json();
    assert.equal(payload.membership.business_id, businessId);
    assert.equal(payload.plans[0].fingerprint, fingerprint);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 operator atomic group create forwards one idempotent group command', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = authFetch(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_booking_group');
    rpcBody = JSON.parse(init.body);
    return json({
      groupId: 'e8700000-0000-4000-8000-000000000001',
      businessId, customerId: 'e8800000-0000-4000-8000-000000000001',
      status: 'scheduled', source: 'operator', version: 1,
      startsAt: '2026-10-20T10:00:00+03:00', endsAt: '2026-10-20T12:00:00+03:00',
      timezone: 'Europe/Istanbul', currency: 'TRY', lowerMinor: 30000, upperMinor: 40000,
      lines: [{ ordinal: 1 }, { ordinal: 2 }],
    });
  });
  try {
    const response = await app.request('http://localhost/api/bookings/group', {
      method: 'POST',
      headers: { ...mutationHeaders(), 'Idempotency-Key': 'f11-group-create-http-0001' },
      body: JSON.stringify({
        businessId: 'forged', customerName: 'Grup Müşteri', customerPhone: '5550000000',
        lines, startsAt: '2026-10-20T10:00:00+03:00', planFingerprint: fingerprint,
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_idempotency_key, 'f11-group-create-http-0001');
    assert.deepEqual(rpcBody.p_lines, lines);
    assert.equal(rpcBody.p_plan_fingerprint, fingerprint);
    assert.equal(JSON.stringify(rpcBody).includes('forged'), false);
    assert.equal((await response.json()).group.groupId, 'e8700000-0000-4000-8000-000000000001');
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 invalid group intent fails before booking RPC', async () => {
  const realFetch = globalThis.fetch;
  let reachedRpc = false;
  globalThis.fetch = authFetch(async () => {
    reachedRpc = true;
    return json({});
  });
  try {
    const response = await app.request('http://localhost/api/bookings/group', {
      method: 'POST',
      headers: { ...mutationHeaders(), 'Idempotency-Key': 'f11-group-invalid-0001' },
      body: JSON.stringify({
        customerName: 'Grup Müşteri',
        lines: [{ serviceId: serviceA, staffId: staffA, businessId: 'forged' }],
        startsAt: '2026-10-20T10:00:00+03:00', planFingerprint: fingerprint,
      }),
    }, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_BOOKING_GROUP');
    assert.equal(reachedRpc, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 stale group plan maps to deterministic conflict without retry', async () => {
  const realFetch = globalThis.fetch;
  let createCalls = 0;
  globalThis.fetch = authFetch(async (url) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_booking_group');
    createCalls += 1;
    return json({ message: 'BOOKING_PLAN_STALE' }, 400);
  });
  try {
    const response = await app.request('http://localhost/api/bookings/group', {
      method: 'POST',
      headers: { ...mutationHeaders(), 'Idempotency-Key': 'f11-group-stale-0001' },
      body: JSON.stringify({
        customerName: 'Grup Müşteri', lines,
        startsAt: '2026-10-20T10:00:00+03:00', planFingerprint: fingerprint,
      }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'BOOKING_PLAN_STALE');
    assert.equal(createCalls, 1);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 recovery session cannot reach operator group RPC', async () => {
  const realFetch = globalThis.fetch;
  let groupRpcReached = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname.includes('compute_booking_group_plans') || url.pathname.includes('create_booking_group')) {
      groupRpcReached = true;
    }
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    return json({});
  };
  try {
    const response = await app.request('http://localhost/api/bookings/group/plans', {
      method: 'POST', headers: mutationHeaders('recovery'),
      body: JSON.stringify({ date: '2026-10-20', lines }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal(groupRpcReached, false);
  } finally { globalThis.fetch = realFetch; }
});
