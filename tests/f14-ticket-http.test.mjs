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

const user = { id: 'f1400000-0000-4000-8000-000000000001', email: 'f14@example.test' };
const businessId = 'f1410000-0000-4000-8000-000000000001';
const otherBusinessId = 'f1410000-0000-4000-8000-000000000002';
const membershipId = 'f1420000-0000-4000-8000-000000000001';
const ticketId = 'f1430000-0000-4000-8000-000000000001';
const groupId = 'f1440000-0000-4000-8000-000000000001';
const customerId = 'f1450000-0000-4000-8000-000000000001';
const serviceId = 'f1460000-0000-4000-8000-000000000001';
const lineId = 'f1470000-0000-4000-8000-000000000001';
const csrfValue = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1480000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookieHeader() {
  return [
    `yzt_access=${accessToken()}`,
    'yzt_refresh=f14-refresh',
    `yzt_business=${businessId}`,
    `yzt_csrf=${csrfValue}`,
  ].join('; ');
}

function mutationHeaders(idempotencyKey = 'f1402-http-key-0001') {
  return {
    Origin: 'http://localhost',
    Cookie: cookieHeader(),
    'X-YZT-CSRF': csrfValue,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
}

function member(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function expectedHash(command, payload) {
  return sha256Hex(JSON.stringify({ command, ...payload }));
}

function baseFetch({ role = 'owner', permission = true, rpc }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([member(role)]);
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') {
      const body = JSON.parse(init.body);
      assert.equal(body.p_business_id, businessId);
      assert.equal(body.p_permission, 'pricing_adjustments_write');
      return json(permission);
    }
    return rpc(url, init);
  };
}

await test('F14 ticket read is tenant-bound and does not require write permission', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([member('staff')]);
    assert.equal(url.pathname, '/rest/v1/rpc/get_ticket_contract');
    const body = JSON.parse(init.body);
    assert.equal(body.p_business_id, businessId);
    assert.equal(body.p_ticket_id, ticketId);
    return json({ ticketId, businessId, status: 'open', paymentStatus: 'unpaid' });
  };
  try {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}`, {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ticket.ticketId, ticketId);
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships', '/rest/v1/rpc/get_ticket_contract']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F14 booking-group open checks pricing permission and hashes server-selected tenant intent', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = baseFetch({
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/open_ticket_from_booking_group_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ ticketId, businessId, bookingGroupId: groupId, status: 'open' });
    },
  });
  try {
    const response = await app.request('http://localhost/api/tickets/from-booking-group', {
      method: 'POST',
      headers: mutationHeaders('f1402-http-group-key'),
      body: JSON.stringify({ bookingGroupId: groupId, businessId: otherBusinessId }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).ticket.ticketId, ticketId);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_group_id, groupId);
    assert.equal(rpcBody.p_idempotency_key, 'f1402-http-group-key');
    assert.equal(
      rpcBody.p_request_hash,
      await expectedHash('open_from_booking_group', { bookingGroupId: groupId }),
    );
    assert.equal(JSON.stringify(rpcBody).includes(otherBusinessId), false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F14 denied financial permission stops before guarded ticket mutation RPC', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = baseFetch({
    role: 'staff',
    permission: false,
    rpc: async (url) => {
      calls.push(url.pathname);
      throw new Error(`unexpected F14 denied mutation fetch: ${url}`);
    },
  });
  try {
    const response = await app.request('http://localhost/api/tickets', {
      method: 'POST',
      headers: mutationHeaders('f1402-http-denied'),
      body: JSON.stringify({ customerId }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'FINANCIAL_PERMISSION_REQUIRED');
    assert.deepEqual(calls, []);
  } finally { globalThis.fetch = realFetch; }
});

await test('F14 walk-in open derives business from membership and maps customer errors', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = baseFetch({
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/open_walk_in_ticket_guarded');
      const body = JSON.parse(init.body);
      assert.equal(body.p_business_id, businessId);
      assert.equal(body.p_customer_id, customerId);
      return json({ message: 'CUSTOMER_NOT_FOUND' }, 400);
    },
  });
  try {
    const response = await app.request('http://localhost/api/tickets', {
      method: 'POST',
      headers: mutationHeaders('f1402-http-walkin'),
      body: JSON.stringify({ customerId }),
    }, env);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error?.code, 'CUSTOMER_NOT_FOUND');
  } finally { globalThis.fetch = realFetch; }
});

await test('F14 add-line request uses integer version and stable server request hash', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = baseFetch({
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/add_ticket_service_line_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ ticketId, version: 2, settlementReady: true });
    },
  });
  try {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}/service-lines`, {
      method: 'POST',
      headers: mutationHeaders('f1402-http-add-line'),
      body: JSON.stringify({
        serviceId,
        staffId: null,
        expectedVersion: 1,
        businessId: otherBusinessId,
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_ticket_id, ticketId);
    assert.equal(rpcBody.p_service_id, serviceId);
    assert.equal(rpcBody.p_staff_id, null);
    assert.equal(rpcBody.p_expected_version, 1);
    assert.equal(
      rpcBody.p_request_hash,
      await expectedHash('add_service_line', {
        ticketId, serviceId, staffId: null, expectedVersion: 1,
      }),
    );
  } finally { globalThis.fetch = realFetch; }
});

await test('F14 range finalization requires integer minor units and explicit reason before RPC', async () => {
  const realFetch = globalThis.fetch;
  let guardedCalls = 0;
  globalThis.fetch = baseFetch({
    rpc: async (url, init) => {
      guardedCalls += 1;
      assert.equal(url.pathname, '/rest/v1/rpc/finalize_ticket_service_price_guarded');
      const body = JSON.parse(init.body);
      assert.equal(body.p_final_unit_price_minor, 25000);
      assert.equal(body.p_reason, 'Gerçekleşen tutar');
      return json({ ticketId, version: 2, settlementReady: true, totalMinor: 25000 });
    },
  });
  try {
    const invalid = await app.request(
      `http://localhost/api/tickets/${ticketId}/lines/${lineId}/finalize-price`,
      {
        method: 'POST',
        headers: mutationHeaders('f1402-http-finalize-bad'),
        body: JSON.stringify({ finalUnitPriceMinor: 250.5, reason: '', expectedVersion: 1 }),
      },
      env,
    );
    assert.equal(invalid.status, 400);
    assert.equal(guardedCalls, 0);

    const valid = await app.request(
      `http://localhost/api/tickets/${ticketId}/lines/${lineId}/finalize-price`,
      {
        method: 'POST',
        headers: mutationHeaders('f1402-http-finalize-ok'),
        body: JSON.stringify({ finalUnitPriceMinor: 25000, reason: '  Gerçekleşen tutar  ', expectedVersion: 1 }),
      },
      env,
    );
    assert.equal(valid.status, 200);
    assert.equal(guardedCalls, 1);
  } finally { globalThis.fetch = realFetch; }
});

await test('F14 stale discount maps to explicit 409 and payments_write is not consumed by this phase', async () => {
  const realFetch = globalThis.fetch;
  const permissions = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([member()]);
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') {
      const body = JSON.parse(init.body);
      permissions.push(body.p_permission);
      return json(true);
    }
    assert.equal(url.pathname, '/rest/v1/rpc/set_ticket_service_discount_guarded');
    return json({ message: 'STALE_WRITE' }, 400);
  };
  try {
    const response = await app.request(
      `http://localhost/api/tickets/${ticketId}/lines/${lineId}/discount`,
      {
        method: 'PUT',
        headers: mutationHeaders('f1402-http-discount'),
        body: JSON.stringify({ discountMinor: 5000, reason: 'Sadakat', expectedVersion: 2 }),
      },
      env,
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'STALE_WRITE');
    assert.deepEqual(permissions, ['pricing_adjustments_write']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F14 closed ticket mutation maps to stable conflict vocabulary', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = baseFetch({
    rpc: async (url) => {
      assert.equal(url.pathname, '/rest/v1/rpc/cancel_ticket_guarded');
      return json({ message: 'TICKET_NOT_OPEN' }, 400);
    },
  });
  try {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}/cancel`, {
      method: 'POST',
      headers: mutationHeaders('f1402-http-cancel'),
      body: JSON.stringify({ reason: 'Yanlış adisyon', expectedVersion: 4 }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'TICKET_NOT_OPEN');
  } finally { globalThis.fetch = realFetch; }
});
