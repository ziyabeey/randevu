import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
};
const user = { id: '91000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const businessId = '92000000-0000-4000-8000-000000000001';
const foreignBusinessId = '92000000-0000-4000-8000-000000000099';
const membershipId = '93000000-0000-4000-8000-000000000001';
const appointmentId = '94000000-0000-4000-8000-000000000001';
const serviceId = '95000000-0000-4000-8000-000000000001';
const staffId = '96000000-0000-4000-8000-000000000001';
const csrf = 'B'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function token(method = 'password') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    sub: user.id,
    role: 'authenticated',
    session_id: '97000000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: now }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookies(method = 'password') {
  return `yzt_access=${token(method)}; yzt_refresh=refresh-token; yzt_business=${businessId}; yzt_csrf=${csrf}`;
}

function readHeaders(method = 'password') {
  return { Cookie: cookies(method) };
}

function mutationHeaders(method = 'password', idempotencyKey = 'booking-test-0001') {
  return {
    Origin: 'http://localhost',
    Cookie: cookies(method),
    'X-YZT-CSRF': csrf,
    'Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json',
  };
}

function membership(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}

function installAuthFetch(t, handler, role = 'owner') {
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership(role)]);
    return handler(url, init);
  });
}

function appointment() {
  return {
    id: appointmentId,
    business_id: businessId,
    customer_id: '98000000-0000-4000-8000-000000000001',
    service_id: serviceId,
    staff_id: staffId,
    status: 'scheduled',
    starts_at: '2026-09-21T09:00:00Z',
    ends_at: '2026-09-21T10:00:00Z',
    timezone: 'Europe/Istanbul',
    customer_name_snapshot: 'Deniz',
    customer_phone_snapshot: null,
    customer_email_snapshot: null,
    service_name_snapshot: 'Kesim',
    staff_name_snapshot: 'Ada',
    price_minor_snapshot: 12500,
    currency_snapshot: 'TRY',
    notes: null,
    cancellation_reason: null,
  };
}

await test('single booking create derives tenant and forwards the idempotency key', async (t) => {
  let body;
  installAuthFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/create_appointment');
    body = JSON.parse(init.body);
    return json(appointment());
  });

  const response = await app.request('http://localhost/api/bookings', {
    method: 'POST',
    headers: mutationHeaders('password', 'single-create-0001'),
    body: JSON.stringify({
      businessId: foreignBusinessId,
      customerName: '  Deniz  ',
      customerPhone: '',
      customerEmail: 'deniz@example.test',
      notes: '  Not  ',
      serviceId,
      staffId,
      startsAt: '2026-09-21T09:00:00Z',
    }),
  }, env);

  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).appointment, appointment());
  assert.deepEqual(body, {
    p_business_id: businessId,
    p_idempotency_key: 'single-create-0001',
    p_customer_name: 'Deniz',
    p_service_id: serviceId,
    p_staff_id: staffId,
    p_starts_at: '2026-09-21T09:00:00Z',
    p_customer_phone: null,
    p_customer_email: 'deniz@example.test',
    p_notes: 'Not',
  });
  assert.notEqual(body.p_business_id, foreignBusinessId);
});

await test('single booking create rejects malformed input before any mutation RPC', async (t) => {
  let rpcCalls = 0;
  installAuthFetch(t, async () => {
    rpcCalls += 1;
    return json({});
  });

  const response = await app.request('http://localhost/api/bookings', {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify({
      customerName: 'D',
      serviceId,
      staffId,
      startsAt: 'not-a-timestamp',
    }),
  }, env);

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error?.code, 'INVALID_BOOKING');
  assert.equal(rpcCalls, 0);
});

await test('recovery sessions cannot reach single booking mutation or membership lookup', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    throw new Error(`unexpected privileged fetch: ${url.pathname}`);
  });

  const response = await app.request('http://localhost/api/bookings', {
    method: 'POST',
    headers: mutationHeaders('recovery'),
    body: JSON.stringify({
      customerName: 'Recovery User',
      serviceId,
      staffId,
      startsAt: '2026-09-21T09:00:00Z',
    }),
  }, env);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
  assert.deepEqual(calls, ['/auth/v1/user']);
});

await test('reschedule forwards the selected tenant and maps appointment conflicts', async (t) => {
  let body;
  installAuthFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/reschedule_appointment');
    body = JSON.parse(init.body);
    return json({ message: 'APPOINTMENT_CONFLICT' }, 400);
  });

  const response = await app.request(`http://localhost/api/bookings/${appointmentId}/reschedule`, {
    method: 'POST',
    headers: mutationHeaders('password', 'reschedule-0001'),
    body: JSON.stringify({
      businessId: foreignBusinessId,
      staffId,
      startsAt: '2026-09-22T11:00:00Z',
    }),
  }, env);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error?.code, 'APPOINTMENT_CONFLICT');
  assert.deepEqual(body, {
    p_business_id: businessId,
    p_appointment_id: appointmentId,
    p_idempotency_key: 'reschedule-0001',
    p_staff_id: staffId,
    p_starts_at: '2026-09-22T11:00:00Z',
  });
});

await test('status mutation requires a reason shape and maps invalid transitions', async (t) => {
  let body;
  installAuthFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/set_appointment_status');
    body = JSON.parse(init.body);
    return json({ message: 'INVALID_STATUS_TRANSITION' }, 400);
  });

  const response = await app.request(`http://localhost/api/bookings/${appointmentId}/status`, {
    method: 'POST',
    headers: mutationHeaders('password', 'status-0001'),
    body: JSON.stringify({ status: 'cancelled', reason: 'Müşteri talebi' }),
  }, env);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error?.code, 'INVALID_TRANSITION');
  assert.deepEqual(body, {
    p_business_id: businessId,
    p_appointment_id: appointmentId,
    p_idempotency_key: 'status-0001',
    p_status: 'cancelled',
    p_reason: 'Müşteri talebi',
  });
});

await test('calendar binds business and staff filters to the active membership', async (t) => {
  let calendarBody;
  const paths = [];
  installAuthFetch(t, async (url, init) => {
    paths.push(url.pathname);
    if (url.pathname === '/rest/v1/businesses') {
      return json([{ id: businessId, name: 'Salon', timezone: 'Europe/Istanbul' }]);
    }
    if (url.pathname === '/rest/v1/staff_profiles') {
      return json([{ id: staffId, name: 'Ada', active: true }]);
    }
    if (url.pathname !== '/rest/v1/rpc/get_calendar_appointments_v2') throw new Error(`unexpected ${url.pathname}`);
    calendarBody = JSON.parse(init.body);
    return json([{ appointment_id: appointmentId, staff_id: staffId, status: 'scheduled' }]);
  });

  const response = await app.request(`http://localhost/api/calendar?date=2026-09-21&days=7&staffId=${staffId}`, {
    headers: readHeaders(),
  }, env);

  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ result, paths }));
  assert.equal(result.business.id, businessId);
  assert.deepEqual(paths, [
    '/rest/v1/businesses',
    '/rest/v1/staff_profiles',
    '/rest/v1/rpc/get_calendar_appointments_v2',
  ]);
  assert.deepEqual(calendarBody, {
    p_business_id: businessId,
    p_start_date: '2026-09-21',
    p_days: 7,
    p_staff_id: staffId,
  });
});

await test('calendar rejects invalid range before reading tenant data', async (t) => {
  let upstreamCalls = 0;
  installAuthFetch(t, async () => {
    upstreamCalls += 1;
    return json([]);
  });

  const response = await app.request('http://localhost/api/calendar?date=2026-02-30&days=2', {
    headers: readHeaders(),
  }, env);

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error?.code, 'INVALID_CALENDAR_RANGE');
  assert.equal(upstreamCalls, 0);
});

await test('calendar upstream authorization errors stay explicit', async (t) => {
  installAuthFetch(t, async (url) => {
    if (url.pathname === '/rest/v1/businesses') return json([{ id: businessId, name: 'Salon', timezone: 'Europe/Istanbul' }]);
    if (url.pathname === '/rest/v1/staff_profiles') return json([]);
    return json({ message: 'NOT_ALLOWED' }, 400);
  });

  const response = await app.request('http://localhost/api/calendar?date=2026-09-21', {
    headers: readHeaders(),
  }, env);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error?.code, 'NOT_ALLOWED');
});
