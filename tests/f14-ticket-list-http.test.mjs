import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { encodePageCursor } from '../worker/pagination.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
};

const user = { id: 'f1900000-0000-4000-8000-000000000001', email: 'f1404@example.test' };
const businessId = 'f1910000-0000-4000-8000-000000000001';
const otherBusinessId = 'f1910000-0000-4000-8000-000000000002';
const membershipId = 'f1920000-0000-4000-8000-000000000001';
const customerId = 'f1930000-0000-4000-8000-000000000001';
const ticketA = 'f1940000-0000-4000-8000-000000000001';
const ticketB = 'f1940000-0000-4000-8000-000000000002';
const ticketC = 'f1940000-0000-4000-8000-000000000003';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1950000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookies() {
  return [
    `yzt_access=${accessToken()}`,
    'yzt_refresh=f1404-refresh',
    `yzt_business=${businessId}`,
    'yzt_csrf=' + 'C'.repeat(43),
  ].join('; ');
}

function membership() {
  return { id: membershipId, business_id: businessId, role: 'owner', active: true };
}

await test('F14-04 ticket list derives tenant and preserves server projection pagination', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/list_ticket_contracts_page');
    rpcBody = JSON.parse(init.body);
    return json([
      {
        ticket: { ticketId: ticketA, businessId, status: 'open', customerId, totalMinor: 60000, paidMinor: 20000, balanceMinor: 40000 },
        sort_updated_at: '2026-09-22T12:00:00Z',
        sort_id: ticketA,
      },
      {
        ticket: { ticketId: ticketB, businessId, status: 'open', customerId, totalMinor: 60000, paidMinor: 60000, balanceMinor: 0 },
        sort_updated_at: '2026-09-22T11:00:00Z',
        sort_id: ticketB,
      },
      {
        ticket: { ticketId: ticketC, businessId, status: 'open', customerId, totalMinor: 10000, paidMinor: 0, balanceMinor: 10000 },
        sort_updated_at: '2026-09-22T10:00:00Z',
        sort_id: ticketC,
      },
    ]);
  };

  try {
    const response = await app.request(
      `http://localhost/api/tickets?status=open&customerId=${customerId}&limit=2&businessId=${otherBusinessId}`,
      { headers: { Cookie: cookies() } },
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.tickets.map((ticket) => ticket.ticketId), [ticketA, ticketB]);
    assert.equal(body.page.limit, 2);
    assert.equal(body.page.hasMore, true);
    assert.equal(typeof body.page.nextCursor, 'string');

    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_status, 'open');
    assert.equal(rpcBody.p_customer_id, customerId);
    assert.equal(rpcBody.p_limit, 3);
    assert.equal(rpcBody.p_after_updated_at, null);
    assert.equal(rpcBody.p_after_id, null);
    assert.equal(JSON.stringify(rpcBody).includes(otherBusinessId), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F14-04 ticket cursor is decoded and forwarded as deterministic keyset', async () => {
  const realFetch = globalThis.fetch;
  const cursor = encodePageCursor('tickets', { at: '2026-09-22T11:00:00Z', id: ticketB });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/list_ticket_contracts_page');
    const body = JSON.parse(init.body);
    assert.equal(body.p_after_updated_at, '2026-09-22T11:00:00Z');
    assert.equal(body.p_after_id, ticketB);
    return json([]);
  };

  try {
    const response = await app.request(`http://localhost/api/tickets?limit=25&cursor=${cursor}`, {
      headers: { Cookie: cookies() },
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).tickets, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F14-04 invalid list filters fail before list RPC', async () => {
  const realFetch = globalThis.fetch;
  const extra = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    extra.push(url.pathname);
    throw new Error(`unexpected list RPC: ${url}`);
  };

  try {
    const badStatus = await app.request('http://localhost/api/tickets?status=paid', {
      headers: { Cookie: cookies() },
    }, env);
    assert.equal(badStatus.status, 400);

    const badCustomer = await app.request('http://localhost/api/tickets?customerId=not-a-uuid', {
      headers: { Cookie: cookies() },
    }, env);
    assert.equal(badCustomer.status, 400);

    const badCursor = await app.request('http://localhost/api/tickets?cursor=not_base64***', {
      headers: { Cookie: cookies() },
    }, env);
    assert.equal(badCursor.status, 400);

    assert.deepEqual(extra, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});
