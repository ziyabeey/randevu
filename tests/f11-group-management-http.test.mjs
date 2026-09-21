import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

// F11-03 HTTP surface. The operator routes carry the optimistic version to the
// authenticated RPCs and translate the group vocabulary into codes the console
// can branch on. The public /m#token routes reach the same cores only through
// execute_public_operation, and the group codes have to survive that envelope
// or the customer is told to retry a request that can never succeed.

const businessId = '20000000-0000-4000-8000-000000000031';
const foreignBusinessId = '20000000-0000-4000-8000-000000000098';
const groupId = '60000000-0000-4000-8000-000000000031';
const lineId = '60000000-0000-4000-8000-000000000032';
const user = { id: '10000000-0000-4000-8000-000000000031', email: 'owner@example.test' };
const membership = { id: '30000000-0000-4000-8000-000000000031', business_id: businessId, role: 'owner', active: true };
const csrf = 'C'.repeat(43);
const token = 'T'.repeat(43);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64url'),
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function accessToken(method = 'password') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated', exp: now + 3600, iat: now,
    sub: user.id, role: 'authenticated', session_id: '50000000-0000-4000-8000-000000000031',
    amr: [{ method, timestamp: now }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function operatorHeaders(method = 'password') {
  return {
    Origin: 'http://localhost',
    Cookie: `yzt_access=${accessToken(method)}; yzt_refresh=refresh-token; yzt_business=${businessId}; yzt_csrf=${csrf}`,
    'X-YZT-CSRF': csrf,
    'Content-Type': 'application/json',
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
// The RPC stays an HTTP 200 carrying an error envelope so the rate-limit
// transaction can commit; only the envelope decides the outcome.
function envelope(message) {
  return json({ ok: false, error: { message } });
}
async function withFetch(mock, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}
function publicHeaders() {
  return { Origin: 'http://localhost', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' };
}

await test('F11-03 operator group read binds to the session tenant, not the request body', async () => {
  let seen = null;
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/get_booking_group_management');
    seen = JSON.parse(init.body);
    return json({ groupId, version: 4, lineCount: 2, managementMode: 'group' });
  }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}?businessId=${foreignBusinessId}`, {
      method: 'GET', headers: operatorHeaders(),
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { group: { groupId, version: 4, lineCount: 2, managementMode: 'group' } });
  });
  assert.equal(seen.p_business_id, businessId);
  assert.notEqual(seen.p_business_id, foreignBusinessId);
  assert.equal(seen.p_group_id, groupId);
});

await test('F11-03 operator reschedule forwards the optimistic version and reports a lost race as a conflict', async () => {
  let seen = null;
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/reschedule_appointment_group');
    seen = JSON.parse(init.body);
    return json({ message: 'BOOKING_GROUP_VERSION_CONFLICT' }, 400);
  }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/reschedule`, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Idempotency-Key': 'op-resched-0001' },
      body: JSON.stringify({ expectedVersion: 2, startsAt: '2026-09-24T11:00:00.000Z' }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'BOOKING_GROUP_VERSION_CONFLICT');
  });
  assert.equal(seen.p_expected_version, 2);
  assert.equal(seen.p_idempotency_key, 'op-resched-0001');
  assert.equal(seen.p_business_id, businessId);
});

await test('F13-03 operator native group status forwards CAS and maps a lost race', async () => {
  let seen = null;
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/set_appointment_group_status');
    seen = JSON.parse(init.body);
    return json({ message: 'BOOKING_GROUP_VERSION_CONFLICT' }, 400);
  }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/status`, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Idempotency-Key': 'op-group-status-0001' },
      body: JSON.stringify({ expectedVersion: 7, status: 'completed' }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'BOOKING_GROUP_VERSION_CONFLICT');
  });
  assert.deepEqual(seen, {
    p_business_id: businessId,
    p_group_id: groupId,
    p_idempotency_key: 'op-group-status-0001',
    p_expected_version: 7,
    p_status: 'completed',
  });
});

await test('F13-03 operator native group status rejects unsupported or partial transitions explicitly', async () => {
  await withFetch(authMock(async () => json({ message: 'BOOKING_GROUP_PARTIAL_STATUS' }, 400)), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/status`, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Idempotency-Key': 'op-group-status-0002' },
      body: JSON.stringify({ expectedVersion: 4, status: 'no_show' }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'BOOKING_GROUP_PARTIAL_STATUS');
  });

  let called = false;
  await withFetch(authMock(async () => { called = true; return json({}); }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/status`, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Idempotency-Key': 'op-group-status-0003' },
      body: JSON.stringify({ expectedVersion: 4, status: 'scheduled' }),
    }, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_GROUP_STATUS');
  });
  assert.equal(called, false);
});

await test('F11-03 operator mutations refuse a missing idempotency key before reaching the database', async () => {
  let called = false;
  await withFetch(authMock(async () => { called = true; return json({}); }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/cancel`, {
      method: 'POST', headers: operatorHeaders(),
      body: JSON.stringify({ expectedVersion: 2 }),
    }, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_GROUP_CANCEL');
  });
  assert.equal(called, false);
});

await test('F11-03 operator line cancel maps a missing line to 404 and keeps the group id server-side', async () => {
  let seen = null;
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/cancel_appointment_group_line');
    seen = JSON.parse(init.body);
    return json({ message: 'BOOKING_GROUP_LINE_NOT_FOUND' }, 400);
  }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/lines/${lineId}/cancel`, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Idempotency-Key': 'op-line-cancel-0001' },
      body: JSON.stringify({ expectedVersion: 3, reason: 'müşteri' }),
    }, env);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'BOOKING_GROUP_LINE_NOT_FOUND');
  });
  assert.equal(seen.p_group_id, groupId);
  assert.equal(seen.p_appointment_id, lineId);
  assert.equal(seen.p_reason, 'müşteri');
});

await test('F11-03 operator group surface stays closed to a password-recovery session', async () => {
  let called = false;
  await withFetch(authMock(async () => { called = true; return json({}); }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}`, {
      method: 'GET', headers: operatorHeaders('recovery'),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'PASSWORD_UPDATE_REQUIRED');
  });
  assert.equal(called, false);
});

await test('F11-03 operator group read reports an upstream outage as retryable, not as a verdict', async () => {
  await withFetch(authMock(async () => json({ message: 'upstream' }, 503)), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}`, {
      method: 'GET', headers: operatorHeaders(),
    }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'GROUP_MANAGEMENT_UNAVAILABLE');
  });
});

await test('F11-03 public slot read dispatches the group action with its own step', async () => {
  let seen = null;
  await withFetch(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/rest/v1/rpc/execute_public_operation');
    seen = JSON.parse(init.body);
    return json({ ok: true, data: [{ starts_at: '2026-09-24T11:00:00Z', total_duration_minutes: 90, lines: [] }] });
  }, async () => {
    const response = await app.request('http://localhost/api/manage/slots', {
      method: 'POST', headers: publicHeaders(),
      body: JSON.stringify({ token, date: '2026-09-24', group: true, step: 30 }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).slots.length, 1);
  });
  assert.equal(seen.p_action, 'manage_group_slots');
  assert.equal(seen.p_args.p_step_minutes, 30);
  assert.equal(seen.p_args.p_token, token);
  assert.equal(seen.p_gate_secret, env.PUBLIC_BOOKING_GATE_SECRET);
});

await test('F11-03 public reschedule surfaces a version conflict the customer can act on', async () => {
  let seen = null;
  await withFetch(async (input, init) => {
    seen = JSON.parse(init.body);
    return envelope('BOOKING_GROUP_VERSION_CONFLICT');
  }, async () => {
    const response = await app.request('http://localhost/api/manage/reschedule', {
      method: 'POST',
      headers: { ...publicHeaders(), 'Idempotency-Key': 'pub-resched-0001' },
      body: JSON.stringify({ token, expectedVersion: 2, startsAt: '2026-09-24T11:00:00.000Z' }),
    }, env);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, 'BOOKING_GROUP_VERSION_CONFLICT');
    // A 503 here would tell the page to retry the same stale version forever.
    assert.notEqual(body.error.code, 'MANAGEMENT_UNAVAILABLE');
  });
  assert.equal(seen.p_action, 'manage_group_reschedule');
  assert.equal(seen.p_args.p_expected_version, 2);
});

await test('F11-03 public reschedule without a version stays on the legacy action and cannot split a group', async () => {
  let seen = null;
  await withFetch(async (input, init) => {
    seen = JSON.parse(init.body);
    return envelope('BOOKING_GROUP_MUTATION_REQUIRED');
  }, async () => {
    const response = await app.request('http://localhost/api/manage/reschedule', {
      method: 'POST',
      headers: { ...publicHeaders(), 'Idempotency-Key': 'pub-legacy-resched-0001' },
      body: JSON.stringify({
        token, staffId: '40000000-0000-4000-8000-000000000031', startsAt: '2026-09-24T11:00:00.000Z',
      }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'GROUP_MANAGEMENT_REQUIRED');
  });
  assert.equal(seen.p_action, 'manage_reschedule');
});

await test('F11-03 public cancel reports a legacy capability and a terminal group distinctly', async () => {
  await withFetch(async () => envelope('MANAGEMENT_GROUP_REQUIRED'), async () => {
    const response = await app.request('http://localhost/api/manage/cancel', {
      method: 'POST',
      headers: { ...publicHeaders(), 'Idempotency-Key': 'pub-cancel-0001' },
      body: JSON.stringify({ token, expectedVersion: 1 }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'GROUP_MANAGEMENT_REQUIRED');
  });

  await withFetch(async () => envelope('BOOKING_GROUP_NOT_CANCELLABLE'), async () => {
    const response = await app.request('http://localhost/api/manage/cancel', {
      method: 'POST',
      headers: { ...publicHeaders(), 'Idempotency-Key': 'pub-cancel-0002' },
      body: JSON.stringify({ token, expectedVersion: 3 }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'BOOKING_NOT_MANAGEABLE');
  });
});

await test('F11-03 public group cancel returns the group projection on success', async () => {
  let seen = null;
  await withFetch(async (input, init) => {
    seen = JSON.parse(init.body);
    return json({ ok: true, data: [{ group_payload: { groupId, version: 3, status: 'cancelled' } }] });
  }, async () => {
    const response = await app.request('http://localhost/api/manage/cancel', {
      method: 'POST',
      headers: { ...publicHeaders(), 'Idempotency-Key': 'pub-cancel-0003' },
      body: JSON.stringify({ token, expectedVersion: 2, reason: 'müşteri' }),
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { group: { groupId, version: 3, status: 'cancelled' } });
  });
  assert.equal(seen.p_action, 'manage_group_cancel');
  assert.equal(seen.p_args.p_reason, 'müşteri');
});

await test('F11-03 public group actions keep the sanitized outage and rate-limit shapes', async () => {
  await withFetch(async () => envelope('PUBLIC_OPERATION_UNAVAILABLE'), async () => {
    const response = await app.request('http://localhost/api/manage/slots', {
      method: 'POST', headers: publicHeaders(),
      body: JSON.stringify({ token, date: '2026-09-24', group: true }),
    }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'MANAGEMENT_UNAVAILABLE');
  });

  await withFetch(async () => envelope('PUBLIC_BOOKING_RATE_LIMITED:42'), async () => {
    const response = await app.request('http://localhost/api/manage/reschedule', {
      method: 'POST',
      headers: { ...publicHeaders(), 'Idempotency-Key': 'pub-resched-0002' },
      body: JSON.stringify({ token, expectedVersion: 2, startsAt: '2026-09-24T11:00:00.000Z' }),
    }, env);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '42');
  });
});
