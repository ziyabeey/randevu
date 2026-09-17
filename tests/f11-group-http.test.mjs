import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { derivePublicBookingIntentV2 } from '../shared/public-booking-intent.ts';

const businessId = '20000000-0000-4000-8000-000000000011';
const foreignBusinessId = '20000000-0000-4000-8000-000000000099';
const user = { id: '10000000-0000-4000-8000-000000000011', email: 'owner@example.test' };
const membership = { id: '30000000-0000-4000-8000-000000000011', business_id: businessId, role: 'owner', active: true };
const serviceA = '40000000-0000-4000-8000-000000000011';
const serviceB = '40000000-0000-4000-8000-000000000012';
const csrf = 'C'.repeat(43);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: 'A'.repeat(43),
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken(method = 'password') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: now + 3600, iat: now, sub: user.id, role: 'authenticated',
    session_id: '50000000-0000-4000-8000-000000000011',
    amr: [{ method, timestamp: now }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function cookies(method = 'password') {
  return `yzt_access=${accessToken(method)}; yzt_refresh=refresh-token; yzt_business=${businessId}; yzt_csrf=${csrf}`;
}
function operatorHeaders(method = 'password') {
  return {
    Origin: 'http://localhost',
    Cookie: cookies(method),
    'X-YZT-CSRF': csrf,
    'Content-Type': 'application/json',
  };
}
function lines() {
  return [{ serviceId: serviceA }, { serviceId: serviceB, staffId: 'any' }];
}
function groupPayload(groupId = '60000000-0000-4000-8000-000000000011') {
  return {
    groupId,
    status: 'scheduled',
    currency: 'TRY',
    estimateMinMinor: 30000,
    estimateMaxMinor: 45000,
    lines: [
      { lineOrdinal: 1, serviceId: serviceA, priceType: 'range', priceMinMinor: 20000, priceMaxMinor: 35000, priceMinor: null },
      { lineOrdinal: 2, serviceId: serviceB, priceType: 'fixed', priceMinMinor: 10000, priceMaxMinor: 10000, priceMinor: 10000 },
    ],
  };
}
function authMock(handler) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership]);
    return handler(url, init);
  };
}

await test('F11-02 operator group slots use only the active membership tenant and expose authoritative estimates', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = authMock(async (url, init) => {
    calls.push(url.pathname);
    assert.equal(url.pathname, '/rest/v1/rpc/compute_group_availability_slots');
    const body = JSON.parse(init.body);
    assert.equal(body.p_business_id, businessId);
    assert.notEqual(body.p_business_id, foreignBusinessId);
    assert.deepEqual(body.p_lines, [{ serviceId: serviceA, staffId: null }, { serviceId: serviceB, staffId: null }]);
    return json([{
      starts_at: '2026-09-20T07:00:00Z', ends_at: '2026-09-20T08:30:00Z', timezone: 'Europe/Istanbul',
      total_duration_minutes: 90, currency: 'TRY', estimate_min_minor: 30000, estimate_max_minor: 45000, lines: [],
    }]);
  });
  try {
    const response = await app.request('http://localhost/api/availability/group-slots', {
      method: 'POST', headers: operatorHeaders(),
      body: JSON.stringify({ businessId: foreignBusinessId, date: '2026-09-20', step: 30, lines: lines() }),
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.slots[0].currency, 'TRY');
    assert.equal(body.slots[0].estimate_min_minor, 30000);
    assert.deepEqual(calls, ['/rest/v1/rpc/compute_group_availability_slots']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 operator group routes reject recovery sessions before tenant or booking RPC access', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    throw new Error(`unexpected privileged fetch ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/bookings/groups', {
      method: 'POST', headers: operatorHeaders('recovery'),
      body: JSON.stringify({ customerName: 'Recovery', startsAt: '2026-09-20T07:00:00Z', lines: lines() }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.deepEqual(calls, ['/auth/v1/user']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 operator create is atomic at the HTTP contract, replayable, and maps binding errors', async () => {
  const cases = [
    ['SERVICE_NOT_FOUND', 404, 'SERVICE_NOT_FOUND'],
    ['MIXED_CURRENCY', 409, 'MIXED_CURRENCY'],
    ['GROUP_SLOT_UNAVAILABLE', 409, 'GROUP_SLOT_UNAVAILABLE'],
    ['IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'],
  ];
  for (const [message, expectedStatus, expectedCode] of cases) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = authMock(async (url) => {
      assert.equal(url.pathname, '/rest/v1/rpc/create_appointment_group');
      return json({ message }, 400);
    });
    try {
      const response = await app.request('http://localhost/api/bookings/groups', {
        method: 'POST', headers: { ...operatorHeaders(), 'Idempotency-Key': `accept-${message}-0001` },
        body: JSON.stringify({ businessId: foreignBusinessId, customerName: 'Deniz', startsAt: '2026-09-20T07:00:00Z', lines: lines() }),
      }, env);
      assert.equal(response.status, expectedStatus);
      assert.equal((await response.json()).error?.code, expectedCode);
    } finally { globalThis.fetch = realFetch; }
  }

  const realFetch = globalThis.fetch;
  let creates = 0;
  const payload = groupPayload();
  globalThis.fetch = authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_appointment_group');
    const body = JSON.parse(init.body);
    assert.equal(body.p_business_id, businessId);
    creates += 1;
    return json(payload);
  });
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await app.request('http://localhost/api/bookings/groups', {
        method: 'POST', headers: { ...operatorHeaders(), 'Idempotency-Key': 'accept-replay-0001' },
        body: JSON.stringify({ businessId: foreignBusinessId, customerName: 'Deniz', startsAt: '2026-09-20T07:00:00Z', lines: lines() }),
      }, env);
      assert.equal(response.status, 201);
      assert.deepEqual((await response.json()).group, payload);
    }
    assert.equal(creates, 2);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 invalid operator group input never reaches the group RPC', async () => {
  const realFetch = globalThis.fetch;
  let groupRpc = false;
  globalThis.fetch = authMock(async (url) => {
    if (url.pathname.includes('group')) groupRpc = true;
    throw new Error(`unexpected fetch ${url}`);
  });
  try {
    const response = await app.request('http://localhost/api/availability/group-slots', {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify({ date: 'bad', lines: [] }),
    }, env);
    assert.equal(response.status, 400);
    assert.equal(groupRpc, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 operator group slot/create transport 5xx or network failure fail closed as 503', async () => {
  for (const path of ['/api/availability/group-slots', '/api/bookings/groups']) {
    for (const failure of ['500', 'network']) {
      const realFetch = globalThis.fetch;
      globalThis.fetch = authMock(async () => {
        if (failure === 'network') throw new Error('network down');
        return json({ message: 'upstream exploded' }, 500);
      });
      try {
        const isCreate = path.includes('/bookings/');
        const response = await app.request(`http://localhost${path}`, {
          method: 'POST',
          headers: isCreate ? { ...operatorHeaders(), 'Idempotency-Key': 'upstream-fail-0001' } : operatorHeaders(),
          body: JSON.stringify(isCreate
            ? { customerName: 'Deniz', startsAt: '2026-09-20T07:00:00Z', lines: lines() }
            : { date: '2026-09-20', lines: lines() }),
        }, env);
        assert.equal(response.status, 503, `${path} ${failure}`);
      } finally { globalThis.fetch = realFetch; }
    }
  }
});

await test('F11-02 public group slots use only execute_public_operation and preserve semantic errors', async () => {
  for (const scenario of ['success', 'mixed', 'service']) {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      assert.equal(url.pathname, '/rest/v1/rpc/execute_public_operation');
      const body = JSON.parse(init.body);
      assert.equal(body.p_action, 'group_slots');
      assert.equal(body.p_args.p_slug, 'test-salon');
      assert.deepEqual(body.p_args.p_lines, [{ serviceId: serviceA, staffId: null }, { serviceId: serviceB, staffId: null }]);
      if (scenario === 'mixed') return json({ ok: false, error: { message: 'MIXED_CURRENCY' } });
      if (scenario === 'service') return json({ ok: false, error: { message: 'SERVICE_NOT_FOUND' } });
      return json({ ok: true, data: [{ currency: 'TRY', estimate_min_minor: 30000, estimate_max_minor: 45000 }] });
    };
    try {
      const response = await app.request('http://localhost/api/public/business/test-salon/group-slots', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.12' },
        body: JSON.stringify({ date: '2026-09-20', lines: lines() }),
      }, env);
      assert.equal(response.status, scenario === 'success' ? 200 : scenario === 'mixed' ? 409 : 404);
      assert.deepEqual(calls, ['/rest/v1/rpc/execute_public_operation']);
    } finally { globalThis.fetch = realFetch; }
  }
});

await test('F11-02 public group create stays on the guarded v2 recovery path and replays one canonical result', async () => {
  const recoveryId = '70000000-0000-4000-8000-000000000011';
  const recoverySecret = 'B'.repeat(43);
  const managementToken = 'D'.repeat(43);
  const intent = await derivePublicBookingIntentV2(recoveryId, Math.floor(Date.now() / 1000) + 120, recoverySecret);
  assert.ok(intent);
  const payload = groupPayload('60000000-0000-4000-8000-000000000077');
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.pathname, '/rest/v1/rpc/execute_public_operation');
    const body = JSON.parse(init.body);
    assert.equal(body.p_action, 'group_book');
    assert.equal(body.p_args.p_idempotency_key, intent.idempotencyKey);
    assert.equal(body.p_args.p_recovery_id, recoveryId);
    assert.equal(body.p_args.p_recovery_secret_hash, intent.secretHash);
    assert.match(body.p_args.p_management_token_hash, /^[0-9a-f]{64}$/);
    assert.ok(body.p_args.p_management_token_ciphertext);
    return json({ ok: true, data: [{
      appointment_id: '80000000-0000-4000-8000-000000000011',
      group_payload: payload,
      recovery_expires_at: '2026-09-23T07:00:00Z',
    }] });
  };
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await app.request('http://localhost/api/public/business/test-salon/group-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.idempotencyKey, 'CF-Connecting-IP': '203.0.113.12' },
        body: JSON.stringify({
          customerName: 'Deniz', customerPhone: '05551112233', startsAt: '2026-09-20T07:00:00Z', lines: lines(),
          recoveryId, recoverySecret, managementToken,
        }),
      }, env);
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.deepEqual(body.group, payload);
      assert.equal(body.management.url, `/m#${managementToken}`);
    }
    assert.deepEqual(calls, ['/rest/v1/rpc/execute_public_operation', '/rest/v1/rpc/execute_public_operation']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F11-02 public group create maps conflict/service/currency and transport failures without raw-RPC fallback', async () => {
  const recoveryId = '70000000-0000-4000-8000-000000000012';
  const recoverySecret = 'E'.repeat(43);
  const managementToken = 'F'.repeat(43);
  const scenarios = [
    ['MIXED_CURRENCY', 200, 409, 'MIXED_CURRENCY'],
    ['SERVICE_NOT_FOUND', 200, 404, 'SERVICE_NOT_FOUND'],
    ['GROUP_SLOT_UNAVAILABLE', 200, 409, 'GROUP_SLOT_UNAVAILABLE'],
    ['IDEMPOTENCY_CONFLICT', 200, 409, 'IDEMPOTENCY_CONFLICT'],
    ['transport-500', 500, 503, 'PUBLIC_BOOKING_UNAVAILABLE'],
    ['transport-network', 0, 503, 'PUBLIC_BOOKING_UNAVAILABLE'],
  ];
  for (const [message, transportStatus, expectedStatus, expectedCode] of scenarios) {
    const intent = await derivePublicBookingIntentV2(recoveryId, Math.floor(Date.now() / 1000) + 120, recoverySecret);
    assert.ok(intent);
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      assert.equal(url.pathname, '/rest/v1/rpc/execute_public_operation');
      if (message === 'transport-network') throw new Error('network down');
      if (transportStatus === 500) return json({ message: 'upstream exploded' }, 500);
      return json({ ok: false, error: { message } });
    };
    try {
      const response = await app.request('http://localhost/api/public/business/test-salon/group-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.idempotencyKey },
        body: JSON.stringify({
          customerName: 'Deniz', customerPhone: '05551112233', startsAt: '2026-09-20T07:00:00Z', lines: lines(),
          recoveryId, recoverySecret, managementToken,
        }),
      }, env);
      assert.equal(response.status, expectedStatus, message);
      assert.equal((await response.json()).error?.code, expectedCode, message);
      assert.deepEqual(calls, ['/rest/v1/rpc/execute_public_operation']);
    } finally { globalThis.fetch = realFetch; }
  }
});
