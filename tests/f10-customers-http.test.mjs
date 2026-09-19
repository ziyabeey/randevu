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

const user = { id: 'd1000000-0000-4000-8000-000000000001', email: 'customer-owner@example.test' };
const businessId = 'd2000000-0000-4000-8000-000000000001';
const forgedBusinessId = 'd2000000-0000-4000-8000-000000000099';
const membershipId = 'd3000000-0000-4000-8000-000000000001';
const customerId = 'd4000000-0000-4000-8000-000000000001';
const csrfValue = 'C'.repeat(43);

function membership() {
  return { id: membershipId, business_id: businessId, role: 'staff', active: true };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function token(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: user.id,
    role: 'authenticated',
    session_id: 'd5000000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function cookie({ recovery = false } = {}) {
  return [
    `yzt_access=${token(recovery ? 'recovery' : 'password')}`,
    'yzt_refresh=f10-customer-refresh',
    `yzt_business=${businessId}`,
    `yzt_csrf=${csrfValue}`,
  ].join('; ');
}

function mutationHeaders(options) {
  return {
    Origin: 'http://localhost',
    Cookie: cookie(options),
    'X-YZT-CSRF': csrfValue,
    'Content-Type': 'application/json',
  };
}

function customerRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    customer_id: `d4000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    name: `Müşteri ${index + 1}`,
    phone: null,
    email: `customer-${index + 1}@example.test`,
    notes: null,
    created_at: new Date(Date.UTC(2026, 8, 14, 10, 0, count - index)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 8, 14, 10, 0, count - index)).toISOString(),
  }));
}

function setCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

await test('F10-05 customer list derives tenant from selected Membership and uses default 25 + max+1', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') {
      assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
      assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
      return json([membership()]);
    }
    assert.equal(url.pathname, '/rest/v1/rpc/list_business_customers_page');
    rpcBody = JSON.parse(init.body);
    return json(customerRows(26));
  };
  try {
    const response = await app.request(`http://localhost/api/customers?businessId=${forgedBusinessId}&search=Ayşe`, {
      headers: { Cookie: cookie() },
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.customers.length, 25);
    assert.equal(body.page.limit, 25);
    assert.equal(body.page.hasMore, true);
    assert.equal(typeof body.page.nextCursor, 'string');
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_search, 'Ayşe');
    assert.equal(rpcBody.p_limit, 26);
    assert.equal(rpcBody.p_after_created_at, null);
    assert.equal(rpcBody.p_after_id, null);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(forgedBusinessId));
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-05 customer list accepts 100 but rejects larger page sizes before DB', async () => {
  const realFetch = globalThis.fetch;
  let rpcLimit;
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls += 1;
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/list_business_customers_page');
    rpcLimit = JSON.parse(init.body).p_limit;
    return json([]);
  };
  try {
    const max = await app.request('http://localhost/api/customers?limit=100', { headers: { Cookie: cookie() } }, env);
    assert.equal(max.status, 200);
    assert.equal(rpcLimit, 101);

    calls = 0;
    const invalid = await app.request('http://localhost/api/customers?limit=101', { headers: { Cookie: cookie() } }, env);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error?.code, 'INVALID_PAGE');
    assert.equal(calls, 2, 'auth/member lookup may run, but list RPC must not run');
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-05 recovery session is rejected before membership or customer data', async () => {
  const realFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    throw new Error(`recovery unexpectedly reached ${url.pathname}`);
  };
  try {
    const response = await app.request('http://localhost/api/customers', {
      headers: { Cookie: cookie({ recovery: true }) },
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.deepEqual(paths, ['/auth/v1/user']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-05 anonymous/public caller cannot read customer list', async () => {
  const realFetch = globalThis.fetch;
  let customerRpc = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json({ message: 'invalid token' }, 401);
    if (url.pathname.includes('list_business_customers_page')) customerRpc = true;
    return json({ message: 'unexpected' }, 500);
  };
  try {
    const response = await app.request('http://localhost/api/customers', {}, env);
    assert.equal(response.status, 401);
    assert.equal(customerRpc, false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-05 create forwards only selected tenant and maps exact-contact collision to 409', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/create_business_customer');
    rpcBody = JSON.parse(init.body);
    return json({ message: 'CUSTOMER_CONTACT_EXISTS' }, 400);
  };
  try {
    const response = await app.request('http://localhost/api/customers', {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ name: 'Ayşe Yılmaz', phone: '0555 111 22 33', email: 'ayse@example.test' }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'CUSTOMER_CONTACT_EXISTS');
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_name, 'Ayşe Yılmaz');
    assert.equal(Object.hasOwn(rpcBody, 'businessId'), false);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-05 edit requires optimistic version and maps stale writes to deterministic 409', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/update_business_customer');
    rpcBody = JSON.parse(init.body);
    return json({ message: 'CUSTOMER_VERSION_CONFLICT' }, 400);
  };
  try {
    const response = await app.request(`http://localhost/api/customers/${customerId}`, {
      method: 'PATCH',
      headers: mutationHeaders(),
      body: JSON.stringify({
        expectedUpdatedAt: '2026-09-14T10:00:00.000Z',
        name: 'Güncel Müşteri',
        phone: null,
        email: 'current@example.test',
        notes: null,
      }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'CUSTOMER_VERSION_CONFLICT');
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_customer_id, customerId);
    assert.equal(rpcBody.p_expected_updated_at, '2026-09-14T10:00:00.000Z');
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-05 customer history is paginated from appointment snapshots, not current customer fields', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  const appointments = Array.from({ length: 26 }, (_, index) => ({
    appointment_id: `d6000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    status: 'completed',
    starts_at: new Date(Date.UTC(2026, 7, 26 - index, 9)).toISOString(),
    ends_at: new Date(Date.UTC(2026, 7, 26 - index, 9, 30)).toISOString(),
    timezone: 'Europe/Istanbul',
    customer_name_snapshot: 'Randevu Anındaki Ad',
    customer_phone_snapshot: '0555 000 00 01',
    customer_email_snapshot: 'snapshot@example.test',
    service_name_snapshot: 'Kesim',
    staff_name_snapshot: 'Ece',
    price_minor_snapshot: 12000,
    currency_snapshot: 'TRY',
    notes: null,
    cancellation_reason: null,
  }));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/list_business_customer_appointments_page_v2');
    rpcBody = JSON.parse(init.body);
    return json(appointments);
  };
  try {
    const response = await app.request(`http://localhost/api/customers/${customerId}/history`, {
      headers: { Cookie: cookie() },
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.appointments.length, 25);
    assert.equal(body.page.hasMore, true);
    assert.equal(body.appointments[0].customer_name_snapshot, 'Randevu Anındaki Ad');
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_customer_id, customerId);
    assert.equal(rpcBody.p_limit, 26);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-05 transient customer read failure stays 503 and preserves selected tenant cookie', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    if (url.pathname === '/rest/v1/rpc/list_business_customers_page') return json({ message: 'temporary' }, 503);
    throw new Error(`unexpected path ${url.pathname}`);
  };
  try {
    const response = await app.request('http://localhost/api/customers', { headers: { Cookie: cookie() } }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error?.code, 'CUSTOMERS_UNAVAILABLE');
    assert.doesNotMatch(setCookies(response).join('\n'), /yzt_business=;.*max-age=0/i);
  } finally { globalThis.fetch = realFetch; }
});
