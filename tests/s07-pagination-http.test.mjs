import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import {
  decodeBookingPageCursor,
  decodePageCursor,
  encodePageCursor,
} from '../worker/pagination.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
};
const user = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const businessId = '20000000-0000-4000-8000-000000000001';
const membership = { id: '30000000-0000-4000-8000-000000000001', business_id: businessId, role: 'owner', active: true };
const pageRevision = '86000000-0000-4000-8000-000000000001';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: '40000000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookies() {
  return `yzt_access=${accessToken()}; yzt_refresh=refresh-token; yzt_business=${businessId}`;
}

function appointment(index, revision = pageRevision) {
  const suffix = String(index).padStart(12, '0');
  const minute = String(Math.floor((index - 1) / 3)).padStart(2, '0');
  return {
    id: `81000000-0000-4000-8000-${suffix}`,
    business_id: businessId,
    customer_id: '82000000-0000-4000-8000-000000000001',
    service_id: '83000000-0000-4000-8000-000000000001',
    staff_id: '84000000-0000-4000-8000-000000000001',
    status: 'cancelled',
    starts_at: `2027-01-15T09:${minute}:00.000Z`, ends_at: `2027-01-15T10:${minute}:00.000Z`,
    timezone: 'Europe/Istanbul', customer_name_snapshot: `Customer ${index}`,
    customer_phone_snapshot: null, customer_email_snapshot: `c${index}@example.test`,
    service_name_snapshot: 'Service', staff_name_snapshot: 'Staff',
    price_minor_snapshot: 10000, currency_snapshot: 'TRY', notes: null, cancellation_reason: null,
    page_revision: revision,
  };
}

function event(index) {
  const suffix = String(index).padStart(12, '0');
  return {
    id: `85000000-0000-4000-8000-${suffix}`,
    event_type: 'created', actor_user_id: user.id,
    from_status: null, to_status: 'scheduled', payload: { index },
    created_at: `2027-01-01T00:00:${String(Math.floor((index - 1) / 3)).padStart(2, '0')}.000Z`,
  };
}

function installAuthFetch(t, handler) {
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership]);
    return handler(url, init);
  });
}

await test('F13 bookings HTTP binds continuation to the opaque v2 page revision and strips it from appointment DTOs', async (t) => {
  const calls = [];
  installAuthFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/list_appointments_page_v2');
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (calls.length === 1) return json(Array.from({ length: 26 }, (_, i) => appointment(i + 1)));
    return json(Array.from({ length: 6 }, (_, i) => appointment(i + 26)));
  });

  const firstResponse = await app.request('http://localhost/api/bookings?limit=25', { headers: { Cookie: cookies() } }, env);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.appointments.length, 25);
  assert.equal(Object.hasOwn(first.appointments[0], 'page_revision'), false);
  assert.deepEqual(first.page, { limit: 25, hasMore: true, nextCursor: first.page.nextCursor });
  const cursor = decodeBookingPageCursor(first.page.nextCursor);
  assert.deepEqual(cursor, {
    at: first.appointments[24].starts_at,
    id: first.appointments[24].id,
    revision: pageRevision,
  });
  assert.deepEqual(calls[0], {
    p_business_id: businessId,
    p_limit: 26,
    p_after_starts_at: null,
    p_after_id: null,
    p_expected_revision: null,
  });

  const secondResponse = await app.request(`http://localhost/api/bookings?limit=25&cursor=${encodeURIComponent(first.page.nextCursor)}`, { headers: { Cookie: cookies() } }, env);
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.appointments.length, 6);
  assert.equal(Object.hasOwn(second.appointments[0], 'page_revision'), false);
  assert.deepEqual(second.page, { limit: 25, hasMore: false, nextCursor: null });
  assert.deepEqual(calls[1], {
    p_business_id: businessId,
    p_limit: 26,
    p_after_starts_at: first.appointments[24].starts_at,
    p_after_id: first.appointments[24].id,
    p_expected_revision: pageRevision,
  });
});

await test('F13 stale DB revision becomes an explicit non-5xx restart response', async (t) => {
  let calls = 0;
  installAuthFetch(t, async (url) => {
    assert.equal(url.pathname, '/rest/v1/rpc/list_appointments_page_v2');
    calls += 1;
    if (calls === 1) return json(Array.from({ length: 26 }, (_, i) => appointment(i + 1)));
    return json({ message: 'STALE_APPOINTMENT_PAGE', code: 'P0001' }, 400);
  });

  const firstResponse = await app.request('http://localhost/api/bookings?limit=25', { headers: { Cookie: cookies() } }, env);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  const response = await app.request(`http://localhost/api/bookings?limit=25&cursor=${encodeURIComponent(first.page.nextCursor)}`, { headers: { Cookie: cookies() } }, env);
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.error.code, 'BOOKINGS_PAGE_RESTART_REQUIRED');
  assert.equal(result.appointments, undefined);
});

await test('F13 legacy v1 booking cursor is restart-required before the DB RPC', async (t) => {
  let listCalls = 0;
  installAuthFetch(t, async () => { listCalls += 1; return json([]); });
  const oldCursor = encodePageCursor('bookings', {
    at: '2027-01-15T09:00:00.000Z',
    id: '81000000-0000-4000-8000-000000000001',
  });
  const response = await app.request(`http://localhost/api/bookings?limit=25&cursor=${encodeURIComponent(oldCursor)}`, { headers: { Cookie: cookies() } }, env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'BOOKINGS_PAGE_RESTART_REQUIRED');
  assert.equal(listCalls, 0);
});

await test('S07 appointment audit HTTP keeps the v1 endpoint-scoped event cursor contract', async (t) => {
  const appointmentId = '81000000-0000-4000-8000-000000000001';
  let rpcBody;
  installAuthFetch(t, async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/list_appointment_events_page');
    rpcBody = JSON.parse(String(init.body));
    return json(Array.from({ length: 4 }, (_, i) => event(i + 1)));
  });

  const response = await app.request(`http://localhost/api/bookings/${appointmentId}/events?limit=3`, { headers: { Cookie: cookies() } }, env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.events.length, 3);
  assert.equal(result.page.hasMore, true);
  assert.deepEqual(decodePageCursor(result.page.nextCursor, 'events'), {
    at: result.events[2].created_at, id: result.events[2].id,
  });
  assert.deepEqual(rpcBody, {
    p_business_id: businessId, p_appointment_id: appointmentId, p_limit: 4,
    p_after_created_at: null, p_after_id: null,
  });
});

await test('S07 malformed pagination fails before list RPC and cannot be treated as page one', async (t) => {
  let listCalls = 0;
  installAuthFetch(t, async () => { listCalls += 1; return json([]); });
  const response = await app.request('http://localhost/api/bookings?limit=101&cursor=not-a-cursor', { headers: { Cookie: cookies() } }, env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_PAGE');
  assert.equal(listCalls, 0);
});

await test('S07 upstream page failure is explicit 503, never a successful empty list', async (t) => {
  installAuthFetch(t, async (url) => {
    assert.equal(url.pathname, '/rest/v1/rpc/list_appointments_page_v2');
    return json({ message: 'canceling statement due to statement timeout', code: '57014' }, 500);
  });
  const response = await app.request('http://localhost/api/bookings?limit=25', { headers: { Cookie: cookies() } }, env);
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.error.code, 'BOOKINGS_READ_UNAVAILABLE');
  assert.equal(result.appointments, undefined);
});
