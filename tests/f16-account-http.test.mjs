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

const user = { id: 'f1a80000-0000-4000-8000-000000000001', email: 'f1608@example.test' };
const businessId = 'f1a81000-0000-4000-8000-000000000001';
const membershipId = 'f1a82000-0000-4000-8000-000000000001';
const staffId = 'f1a85000-0000-4000-8000-000000000001';
const foreignBusiness = 'f1a81000-0000-4000-8000-000000000099';
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken(method = 'password') {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1a8a000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${h}.${p}.sig`;
}

function headers({ method } = {}) {
  return {
    Origin: 'http://localhost',
    Cookie: [`yzt_access=${accessToken(method)}`, 'yzt_refresh=f16-refresh', `yzt_business=${businessId}`, `yzt_csrf=${csrf}`].join('; '),
    'Content-Type': 'application/json',
    'X-YZT-CSRF': csrf,
  };
}

const summary = (access = 'full', status = 'pilot') => ({
  businessId,
  businessName: 'Salon F16',
  membershipId,
  role: 'owner',
  financialPermissions: ['expenses_write', 'financial_reports_read'],
  plan: { planKey: 'pilot', status, periodEnd: null, access },
});

// plan: undefined leaves the embed out, as the older fixtures do; null is an
// embed that came back empty.
function withFetch({ role = 'owner', plan = { plan_access: 'full' }, rpc, seen = {} }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') {
      seen.membershipSelect = url.searchParams.get('select');
      const row = { id: membershipId, business_id: businessId, role, active: true };
      if (plan !== undefined) row.plan = plan;
      return json([row]);
    }
    seen.rpcCalls = (seen.rpcCalls ?? 0) + 1;
    return rpc(url, init);
  };
}

async function withMockedFetch(mock, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = realFetch; }
}

await test('F16-08 account summary comes from the active membership and adds the signed-in email', async () => {
  let rpcBody;
  const seen = {};
  await withMockedFetch(withFetch({
    seen,
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/get_account_summary');
      rpcBody = JSON.parse(init.body);
      return json(summary());
    },
  }), async () => {
    const response = await app.request(`http://localhost/api/account?businessId=${foreignBusiness}`, { headers: headers() }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.account.businessId, businessId);
    assert.equal(body.account.email, user.email);
    assert.equal(body.account.plan.status, 'pilot');
    assert.deepEqual(rpcBody, { p_business_id: businessId });
  });
  assert.match(seen.membershipSelect, /plan:businesses!memberships_business_id_fkey\(plan_access\)/);
});

await test('F16-08 account errors are mapped without database internals and recovery is refused', async () => {
  await withMockedFetch(withFetch({ rpc: async () => json({ message: 'upstream' }, 503) }), async () => {
    const response = await app.request('http://localhost/api/account', { headers: headers() }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'ACCOUNT_UNAVAILABLE');
  });
  await withMockedFetch(withFetch({ rpc: async () => json({ message: 'NOT_ALLOWED', code: '42501' }, 400) }), async () => {
    const response = await app.request('http://localhost/api/account', { headers: headers() }, env);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, 'ACCOUNT_READ_FAILED');
    assert.doesNotMatch(JSON.stringify(body), /NOT_ALLOWED|42501/);
  });
  const seen = {};
  await withMockedFetch(withFetch({ seen, rpc: async () => json(summary()) }), async () => {
    const response = await app.request('http://localhost/api/account', { headers: headers({ method: 'recovery' }) }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'PASSWORD_UPDATE_REQUIRED');
  });
  assert.equal(seen.rpcCalls ?? 0, 0);
});

await test('F16-08 a read-only plan keeps reads and refuses member writes before any RPC', async () => {
  await withMockedFetch(withFetch({ plan: { plan_access: 'read_only' }, rpc: async () => json(summary('read_only', 'cancelled')) }), async () => {
    const response = await app.request('http://localhost/api/account', { headers: headers() }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).account.plan.access, 'read_only');
  });
  for (const [path, method, body] of [
    [`/api/commission-rates/${staffId}`, 'POST', { serviceRateBps: 1000, productRateBps: 0, expectedVersion: 0 }],
    ['/api/customers', 'POST', { fullName: 'Plan Test', phone: '+905551112233' }],
    ['/api/expenses', 'POST', { amountMinor: 100 }],
  ]) {
    const seen = {};
    await withMockedFetch(withFetch({ seen, plan: { plan_access: 'read_only' }, rpc: async () => json({}) }), async () => {
      const response = await app.request(`http://localhost${path}`, { method, headers: headers(), body: JSON.stringify(body) }, env);
      assert.equal(response.status, 403, path);
      const error = (await response.json()).error;
      assert.equal(error.code, 'PLAN_READ_ONLY', path);
      assert.match(error.message, /yalnızca görüntülenebilir/);
    });
    assert.equal(seen.rpcCalls ?? 0, 0, `${path} reached the database on a read-only plan`);
  }
});

await test('F16-08 an empty plan embed fails closed and a full plan writes normally', async () => {
  const closed = {};
  await withMockedFetch(withFetch({ seen: closed, plan: null, rpc: async () => json({}) }), async () => {
    const response = await app.request(`http://localhost/api/commission-rates/${staffId}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ serviceRateBps: 1000, productRateBps: 0, expectedVersion: 0 }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'PLAN_READ_ONLY');
  });
  assert.equal(closed.rpcCalls ?? 0, 0);

  let rpcPath;
  await withMockedFetch(withFetch({
    rpc: async (url) => {
      rpcPath = url.pathname;
      return json({ staffId, version: 1, serviceRateBps: 1000, productRateBps: 0, overrides: [] });
    },
  }), async () => {
    const response = await app.request(`http://localhost/api/commission-rates/${staffId}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ serviceRateBps: 1000, productRateBps: 0, expectedVersion: 0 }),
    }, env);
    assert.equal(response.status, 200);
  });
  assert.equal(rpcPath, '/rest/v1/rpc/set_staff_commission_rates_guarded');
});
