import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { encodePageCursor } from '../worker/pagination.ts';

const businessId = '21000000-0000-4000-8000-000000000031';
const groupId = '61000000-0000-4000-8000-000000000031';
const lineId = '61000000-0000-4000-8000-000000000032';
const customerId = '71000000-0000-4000-8000-000000000031';
const serviceId = '81000000-0000-4000-8000-000000000031';
const staffId = '91000000-0000-4000-8000-000000000031';
const user = { id: '11000000-0000-4000-8000-000000000031', email: 'owner@example.test' };
const membership = { id: '31000000-0000-4000-8000-000000000031', business_id: businessId, role: 'owner', active: true };
const csrf = 'I'.repeat(43);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated', exp: now + 3600, iat: now,
    sub: user.id, role: 'authenticated', session_id: '51000000-0000-4000-8000-000000000031',
    amr: [{ method: 'password', timestamp: now }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function headers() {
  return {
    Origin: 'http://localhost',
    Cookie: `yzt_access=${accessToken()}; yzt_refresh=refresh-token; yzt_business=${businessId}; yzt_csrf=${csrf}`,
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
async function withFetch(mock, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}

await test('F11-03 booking list pages logical groups and forwards the opaque group cursor', async () => {
  let seen = null;
  const cursor = encodePageCursor('booking_groups', {
    at: '2026-09-24T10:00:00.000Z',
    id: '61000000-0000-4000-8000-000000000099',
  });
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/list_business_booking_groups_page_v3');
    seen = JSON.parse(init.body);
    return json([{ group_id: groupId, group_starts_at: '2026-09-24T09:00:00.000Z', booking: {
      groupId, version: 4, lineCount: 2, managementMode: 'group', customerName: 'Ada', lines: [{ lineOrdinal: 1 }, { lineOrdinal: 2 }],
    } }]);
  }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups?limit=25&cursor=${encodeURIComponent(cursor)}`, {
      method: 'GET', headers: headers(),
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.bookings.length, 1);
    assert.equal(body.bookings[0].groupId, groupId);
    assert.equal(body.bookings[0].lineCount, 2);
  });
  assert.equal(seen.p_business_id, businessId);
  assert.equal(seen.p_limit, 26);
  assert.equal(seen.p_after_starts_at, '2026-09-24T10:00:00.000Z');
  assert.equal(seen.p_after_id, '61000000-0000-4000-8000-000000000099');
});

await test('F11-03 booking group endpoint rejects a legacy physical-line cursor', async () => {
  let called = false;
  const legacy = encodePageCursor('bookings', {
    at: '2026-09-24T10:00:00.000Z', id: lineId,
  });
  await withFetch(authMock(async () => { called = true; return json([]); }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups?cursor=${encodeURIComponent(legacy)}`, {
      method: 'GET', headers: headers(),
    }, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_PAGE');
  });
  assert.equal(called, false);
});

await test('F11-03 customer group history pages reservation roots instead of service lines', async () => {
  let seen = null;
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/list_business_customer_booking_groups_page_v3');
    seen = JSON.parse(init.body);
    return json([{ group_id: groupId, group_starts_at: '2026-09-24T09:00:00.000Z', booking: {
      groupId, lineCount: 2, managementMode: 'group', customerName: 'Ada', lines: [
        { appointmentId: lineId, lineOrdinal: 1, serviceName: 'Renk' },
        { appointmentId: '61000000-0000-4000-8000-000000000033', lineOrdinal: 2, serviceName: 'Kesim' },
      ],
    } }]);
  }), async () => {
    const response = await app.request(`http://localhost/api/customers/${customerId}/group-history?limit=25`, {
      method: 'GET', headers: headers(),
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.bookings.length, 1);
    assert.equal(body.bookings[0].lines.length, 2);
  });
  assert.equal(seen.p_business_id, businessId);
  assert.equal(seen.p_customer_id, customerId);
  assert.equal(seen.p_limit, 26);
});

await test('F11-03 line service change carries group CAS and maps footprint replan to 409', async () => {
  let seen = null;
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/change_appointment_group_line_service');
    seen = JSON.parse(init.body);
    return json({ message: 'BOOKING_GROUP_LINE_REPLAN_REQUIRED' }, 400);
  }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/lines/${lineId}/service`, {
      method: 'POST',
      headers: { ...headers(), 'Idempotency-Key': 'line-service-0001' },
      body: JSON.stringify({ expectedVersion: 7, serviceId }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'BOOKING_GROUP_LINE_REPLAN_REQUIRED');
  });
  assert.equal(seen.p_business_id, businessId);
  assert.equal(seen.p_group_id, groupId);
  assert.equal(seen.p_appointment_id, lineId);
  assert.equal(seen.p_expected_version, 7);
  assert.equal(seen.p_service_id, serviceId);
});

await test('F11-03 line schedule edit carries group CAS and maps stale version deterministically', async () => {
  let seen = null;
  await withFetch(authMock(async (url, init) => {
    assert.equal(url.pathname, '/rest/v1/rpc/reschedule_appointment_group_line');
    seen = JSON.parse(init.body);
    return json({ message: 'BOOKING_GROUP_VERSION_CONFLICT' }, 400);
  }), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/lines/${lineId}/reschedule`, {
      method: 'POST',
      headers: { ...headers(), 'Idempotency-Key': 'line-reschedule-0001' },
      body: JSON.stringify({ expectedVersion: 8, staffId, startsAt: '2026-09-24T13:00:00.000Z' }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'BOOKING_GROUP_VERSION_CONFLICT');
  });
  assert.equal(seen.p_business_id, businessId);
  assert.equal(seen.p_group_id, groupId);
  assert.equal(seen.p_appointment_id, lineId);
  assert.equal(seen.p_expected_version, 8);
  assert.equal(seen.p_staff_id, staffId);
  assert.equal(seen.p_starts_at, '2026-09-24T13:00:00.000Z');
});

await test('F11-03 line mutation outage is retryable and never presented as a successful verdict', async () => {
  await withFetch(authMock(async () => json({ message: 'upstream unavailable' }, 503)), async () => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/lines/${lineId}/reschedule`, {
      method: 'POST',
      headers: { ...headers(), 'Idempotency-Key': 'line-reschedule-0002' },
      body: JSON.stringify({ expectedVersion: 8, staffId, startsAt: '2026-09-24T13:00:00.000Z' }),
    }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'GROUP_LINE_MUTATION_UNAVAILABLE');
  });
});
