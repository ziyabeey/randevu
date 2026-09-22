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
const user = { id: 'c1000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const businessId = 'c2000000-0000-4000-8000-000000000001';
const membershipId = 'c3000000-0000-4000-8000-000000000001';
const serviceId = 'c4000000-0000-4000-8000-000000000001';
const staffId = 'c5000000-0000-4000-8000-000000000001';
const csrf = 'C'.repeat(43);
// Kept inside worker/availability.ts validDateHorizon() (UTC today-1 .. UTC today+366) so the
// guarded-RPC route is reached instead of being short-circuited by an expiring fixed date.
const blockDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function token(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: 'c6000000-0000-4000-8000-000000000001',
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

await test('F10-04 service create derives tenant from selected Membership and uses guarded RPC', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_service_guarded');
    rpcBody = JSON.parse(init.body);
    return json({ id: serviceId, business_id: businessId, name: 'Kesim', updated_at: '2026-09-14T11:00:00Z' });
  });
  try {
    const response = await app.request('http://localhost/api/services', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ name: 'Kesim', durationMinutes: 45, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, priceMinor: 12500, businessId: 'forged' }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_buffer_before_minutes, 5);
    assert.equal(rpcBody.p_buffer_after_minutes, 10);
    assert.equal(String(rpcBody.p_business_id).includes('forged'), false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 recovery and staff sessions cannot reach guarded mutation RPC', async () => {
  const realFetch = globalThis.fetch;
  let reachedRpc = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership('staff')]);
    reachedRpc = true;
    return json({});
  };
  try {
    const recovery = await app.request(`http://localhost/api/services/${serviceId}`, {
      method: 'PATCH', headers: mutationHeaders('recovery'), body: JSON.stringify({ active: false }),
    }, env);
    assert.equal(recovery.status, 403);
    assert.equal((await recovery.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');

    const staff = await app.request(`http://localhost/api/services/${serviceId}`, {
      method: 'PATCH', headers: mutationHeaders(), body: JSON.stringify({ active: false }),
    }, env);
    assert.equal(staff.status, 403);
    const staffPayload = await staff.json();
    assert.equal(staffPayload.error?.code, 'NOT_ALLOWED');
    assert.doesNotMatch(staffPayload.error?.message ?? '', /\bowner\b|\bmanager\b/i);
    assert.equal(reachedRpc, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 existing service edit requires an optimistic version before RPC', async () => {
  const realFetch = globalThis.fetch;
  let reachedRpc = false;
  globalThis.fetch = authFetch('owner', async () => {
    reachedRpc = true;
    return json({});
  });
  try {
    const response = await app.request(`http://localhost/api/services/${serviceId}`, {
      method: 'PATCH', headers: mutationHeaders(),
      body: JSON.stringify({ priceMinor: 14000 }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'STALE_WRITE');
    assert.equal(reachedRpc, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 stale catalog edit maps deterministic 409 and forwards optimistic version', async () => {
  const realFetch = globalThis.fetch;
  let body;
  globalThis.fetch = authFetch('manager', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/update_service_guarded');
    body = JSON.parse(init.body);
    return json({ message: 'STALE_WRITE' }, 400);
  });
  try {
    const expected = '2026-09-14T10:00:00.000Z';
    const response = await app.request(`http://localhost/api/services/${serviceId}`, {
      method: 'PATCH', headers: mutationHeaders(),
      body: JSON.stringify({ expectedUpdatedAt: expected, priceMinor: 14000, bufferBeforeMinutes: 8 }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'STALE_WRITE');
    assert.equal(body.p_business_id, businessId);
    assert.equal(body.p_service_id, serviceId);
    assert.equal(body.p_expected_updated_at, expected);
    assert.deepEqual(body.p_patch, { priceMinor: 14000, bufferBeforeMinutes: 8 });
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 assignment uses selected tenant and optimistic existing version', async () => {
  const realFetch = globalThis.fetch;
  let body;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/set_staff_service_guarded');
    body = JSON.parse(init.body);
    return json({ business_id: businessId, staff_id: staffId, service_id: serviceId, active: false });
  });
  try {
    const response = await app.request(`http://localhost/api/staff/${staffId}/services/${serviceId}`, {
      method: 'PUT', headers: mutationHeaders(),
      body: JSON.stringify({ active: false, expectedUpdatedAt: '2026-09-14T10:00:00Z', businessId: 'forged' }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal(body.p_business_id, businessId);
    assert.equal(body.p_active, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 legacy assignment toggle captures the current server version before guarded RPC', async () => {
  const realFetch = globalThis.fetch;
  const expected = '2026-09-14T10:05:00Z';
  let rpcBody;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    if (url.pathname === '/rest/v1/staff_services') {
      assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
      assert.equal(url.searchParams.get('staff_id'), `eq.${staffId}`);
      assert.equal(url.searchParams.get('service_id'), `eq.${serviceId}`);
      return json([{ updated_at: expected }]);
    }
    assert.equal(url.pathname, '/rest/v1/rpc/set_staff_service_guarded');
    rpcBody = JSON.parse(init.body);
    return json({ business_id: businessId, staff_id: staffId, service_id: serviceId, active: false });
  });
  try {
    const response = await app.request(`http://localhost/api/staff/${staffId}/services/${serviceId}`, {
      method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ active: false }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_expected_updated_at, expected);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 availability setup reuses canonical onboarding hours and rejects block overflow', async () => {
  const realFetch = globalThis.fetch;
  let onboardingCalls = 0;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    if (url.pathname === '/rest/v1/rpc/get_business_onboarding_snapshot') {
      onboardingCalls++;
      assert.deepEqual(JSON.parse(init.body), { p_business_id: businessId });
      return json([{
        business: { id: businessId, timezone: 'Europe/Istanbul' },
        business_hours: [], staff_hours: [], services: [], staff: [], assignments: [], settings: {}, readiness: {},
      }]);
    }
    if (url.pathname === '/rest/v1/availability_blocks') {
      assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
      assert.equal(url.searchParams.get('limit'), '101');
      return json(Array.from({ length: 101 }, (_, i) => ({ id: `block-${i}`, staff_id: null, starts_at: '', ends_at: '', reason: null, active: true })));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  try {
    const response = await app.request('http://localhost/api/availability/setup', { headers: { Cookie: cookies() } }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'AVAILABILITY_BLOCKS_LIMIT_EXCEEDED');
    assert.equal(onboardingCalls, 1);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 schedule mutation sends expected intervals to guarded RPC and maps stale 409', async () => {
  const realFetch = globalThis.fetch;
  let body;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/replace_business_hours_guarded');
    body = JSON.parse(init.body);
    return json({ message: 'STALE_WRITE' }, 400);
  });
  try {
    const response = await app.request('http://localhost/api/availability/business-hours/1', {
      method: 'PUT', headers: mutationHeaders(),
      body: JSON.stringify({
        intervals: [{ start: '10:00', end: '18:00' }],
        expectedIntervals: [{ start: '09:00', end: '17:00' }],
      }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'STALE_WRITE');
    assert.equal(body.p_business_id, businessId);
    assert.deepEqual(body.p_expected_intervals, [{ start: '09:00', end: '17:00' }]);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 legacy setup hours capture a current server snapshot before guarded RPC', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = authFetch('owner', async (url, init) => {
    if (url.pathname === '/rest/v1/business_hours') {
      assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
      assert.equal(url.searchParams.get('weekday'), 'eq.1');
      assert.equal(url.searchParams.get('limit'), '9');
      return json([{ starts_local: '09:00:00', ends_local: '17:00:00' }]);
    }
    assert.equal(url.pathname, '/rest/v1/rpc/replace_business_hours_guarded');
    rpcBody = JSON.parse(init.body);
    return json([]);
  });
  try {
    const response = await app.request('http://localhost/api/availability/business-hours/1', {
      method: 'PUT', headers: mutationHeaders(),
      body: JSON.stringify({ intervals: [{ start: '10:00', end: '18:00' }] }),
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(rpcBody.p_expected_intervals, [{ start: '09:00', end: '17:00' }]);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 availability block create uses guarded RPC and ignores client tenant fields', async () => {
  const realFetch = globalThis.fetch;
  let body;
  globalThis.fetch = authFetch('manager', async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_availability_block_local_guarded');
    body = JSON.parse(init.body);
    return json({ id: 'c7000000-0000-4000-8000-000000000001', business_id: businessId });
  });
  try {
    const response = await app.request('http://localhost/api/availability/blocks', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ date: blockDate, start: '12:00', end: '13:00', staffId: staffId, reason: 'İzin', businessId: 'forged' }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(body.p_business_id, businessId);
    assert.equal(body.p_staff_id, staffId);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-04 availability block write cap maps to stable 409', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = authFetch('manager', async (url) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_availability_block_local_guarded');
    return json({ message: 'AVAILABILITY_BLOCKS_LIMIT_EXCEEDED' }, 400);
  });
  try {
    const response = await app.request('http://localhost/api/availability/blocks', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ date: blockDate, start: '12:00', end: '13:00', staffId: null, reason: 'İzin' }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'AVAILABILITY_BLOCKS_LIMIT_EXCEEDED');
  } finally { globalThis.fetch = realFetch; }
});
