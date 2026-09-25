import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import app from '../worker/app.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
};

const user = { id: 'f1a70000-0000-4000-8000-000000000001', email: 'f1607@example.test' };
const businessId = 'f1a71000-0000-4000-8000-000000000001';
const membershipId = 'f1a72000-0000-4000-8000-000000000001';
const staffId = 'f1a75000-0000-4000-8000-000000000001';
const serviceId = 'f1a74000-0000-4000-8000-000000000001';
const foreignBusiness = 'f1a71000-0000-4000-8000-000000000099';
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken(method = 'password') {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1a7a000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${h}.${p}.sig`;
}

function cookie(method) {
  return [`yzt_access=${accessToken(method)}`, 'yzt_refresh=f16-refresh', `yzt_business=${businessId}`, `yzt_csrf=${csrf}`].join('; ');
}

function headers({ method, withCsrf = true } = {}) {
  const result = { Origin: 'http://localhost', Cookie: cookie(method), 'Content-Type': 'application/json' };
  if (withCsrf) result['X-YZT-CSRF'] = csrf;
  return result;
}

function withFetch({ role = 'owner', rpc }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([{ id: membershipId, business_id: businessId, role, active: true }]);
    return rpc(url, init);
  };
}

async function withMockedFetch(mock, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = realFetch; }
}

await test('F16-07 report derives the tenant from the membership and forwards only the validated range', async () => {
  let rpcBody;
  await withMockedFetch(withFetch({
    role: 'staff',
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/get_staff_commission_report');
      rpcBody = JSON.parse(init.body);
      return json({ businessId, scope: 'own', staff: [], movements: [], definition: ['x'] });
    },
  }), async () => {
    const response = await app.request(
      `http://localhost/api/reports/commission?startDate=2026-09-01&endDate=2026-09-24&businessId=${foreignBusiness}&staffId=${staffId}`,
      { headers: headers() },
      env,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).report.scope, 'own');
    assert.deepEqual(rpcBody, { p_business_id: businessId, p_start_date: '2026-09-01', p_end_date: '2026-09-24' });
  });
});

await test('F16-07 invalid report ranges never reach the database', async () => {
  let calls = 0;
  await withMockedFetch(withFetch({ rpc: async () => { calls += 1; return json({}); } }), async () => {
    for (const query of [
      'startDate=2026-09-24',
      'startDate=2026-02-30&endDate=2026-03-01',
      'startDate=2026-09-24&endDate=2026-09-01',
      'startDate=24.09.2026&endDate=2026-09-24',
    ]) {
      const response = await app.request(`http://localhost/api/reports/commission?${query}`, { headers: headers() }, env);
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).error.code, 'INVALID_REPORT_RANGE');
    }
  });
  assert.equal(calls, 0);
});

await test('F16-07 report and rate errors are mapped without database internals', async () => {
  const cases = [
    ['INVALID_REPORT_RANGE', 400, 'INVALID_REPORT_RANGE'],
    ['REPORT_CURRENCY_MIXED', 409, 'REPORT_CURRENCY_MIXED'],
    ['FINANCIAL_REPORTS_PERMISSION_REQUIRED', 403, 'FINANCIAL_REPORTS_PERMISSION_REQUIRED'],
    ['NOT_ALLOWED', 403, 'COMMISSION_NOT_ALLOWED'],
    ['duplicate key value violates unique constraint "staff_commission_rates_version_key"', 400, 'COMMISSION_REQUEST_FAILED'],
  ];
  for (const [message, status, code] of cases) {
    await withMockedFetch(withFetch({ rpc: async () => json({ message, code: 'P0001' }, 400) }), async () => {
      const response = await app.request('http://localhost/api/reports/commission?startDate=2026-09-24&endDate=2026-09-24', { headers: headers() }, env);
      assert.equal(response.status, status, message);
      const body = await response.json();
      assert.equal(body.error.code, code);
      assert.doesNotMatch(JSON.stringify(body), /staff_commission|duplicate key|P0001/);
    });
  }
  await withMockedFetch(withFetch({ rpc: async () => json({ message: 'upstream' }, 503) }), async () => {
    const response = await app.request('http://localhost/api/commission-rates', { headers: headers() }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'COMMISSION_UNAVAILABLE');
  });
});

await test('F16-07 rate writes are owner/manager only and forward only validated fields', async () => {
  let rpcBody;
  let rpcPath;
  await withMockedFetch(withFetch({
    role: 'manager',
    rpc: async (url, init) => {
      rpcPath = url.pathname;
      rpcBody = JSON.parse(init.body);
      return json({ staffId, version: 2, serviceRateBps: 1500, productRateBps: 500, overrides: [] });
    },
  }), async () => {
    const response = await app.request(`http://localhost/api/commission-rates/${staffId}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ serviceRateBps: 1500, productRateBps: 500, expectedVersion: 1, businessId: foreignBusiness, staffId: 'x' }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).staff.version, 2);
    assert.equal(rpcPath, '/rest/v1/rpc/set_staff_commission_rates_guarded');
    assert.deepEqual(rpcBody, {
      p_business_id: businessId, p_staff_id: staffId, p_service_rate_bps: 1500, p_product_rate_bps: 500, p_expected_version: 1,
    });

    const cleared = await app.request(`http://localhost/api/commission-rates/${staffId}/services/${serviceId}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ rateBps: null, expectedVersion: 3 }),
    }, env);
    assert.equal(cleared.status, 200);
    assert.equal(rpcPath, '/rest/v1/rpc/set_staff_service_commission_override_guarded');
    assert.deepEqual(rpcBody, {
      p_business_id: businessId, p_staff_id: staffId, p_service_id: serviceId, p_rate_bps: null, p_expected_version: 3,
    });
  });

  let guarded = 0;
  await withMockedFetch(withFetch({ role: 'staff', rpc: async () => { guarded += 1; return json({}); } }), async () => {
    const response = await app.request(`http://localhost/api/commission-rates/${staffId}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ serviceRateBps: 9000, productRateBps: 9000, expectedVersion: 1 }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'COMMISSION_NOT_ALLOWED');
  });
  await withMockedFetch(withFetch({ rpc: async () => { guarded += 1; return json({}); } }), async () => {
    for (const [path, body] of [
      [`/api/commission-rates/${staffId}`, { serviceRateBps: 10001, productRateBps: 0, expectedVersion: 0 }],
      [`/api/commission-rates/${staffId}`, { serviceRateBps: 10.5, productRateBps: 0, expectedVersion: 0 }],
      [`/api/commission-rates/${staffId}`, { serviceRateBps: -1, productRateBps: 0, expectedVersion: 0 }],
      [`/api/commission-rates/${staffId}`, { serviceRateBps: 100, productRateBps: 0 }],
      ['/api/commission-rates/not-a-uuid', { serviceRateBps: 100, productRateBps: 0, expectedVersion: 0 }],
      [`/api/commission-rates/${staffId}/services/${serviceId}`, { rateBps: '10', expectedVersion: 0 }],
      [`/api/commission-rates/${staffId}/services/${serviceId}`, { expectedVersion: 0 }],
      [`/api/commission-rates/${staffId}/services/nope`, { rateBps: 100, expectedVersion: 0 }],
    ]) {
      const response = await app.request(`http://localhost${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, env);
      assert.equal(response.status, 400, `${path} ${JSON.stringify(body)}`);
      assert.equal((await response.json()).error.code, 'INVALID_COMMISSION_RATE');
    }
  });
  assert.equal(guarded, 0);
});

await test('F16-07 rate writes need CSRF and recovery sessions are refused before any RPC', async () => {
  let calls = 0;
  await withMockedFetch(withFetch({ rpc: async () => { calls += 1; return json({}); } }), async () => {
    const noCsrf = await app.request(`http://localhost/api/commission-rates/${staffId}`, {
      method: 'POST', headers: headers({ withCsrf: false }), body: JSON.stringify({ serviceRateBps: 1, productRateBps: 1, expectedVersion: 0 }),
    }, env);
    assert.equal(noCsrf.status, 403);
    const recovery = await app.request('http://localhost/api/reports/commission?startDate=2026-09-24&endDate=2026-09-24', {
      headers: headers({ method: 'recovery' }),
    }, env);
    assert.equal(recovery.status, 403);
    assert.equal((await recovery.json()).error.code, 'PASSWORD_UPDATE_REQUIRED');
  });
  assert.equal(calls, 0);
});

test('F16-07 migration keeps the ledger append-only and the report bounded', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20260924210000_f16_staff_commission.sql', import.meta.url), 'utf8');
  assert.match(migration, /create trigger staff_commission_entries_immutable\s+before update or delete/);
  assert.match(migration, /create trigger tickets_f16_staff_commission_close\s+after update of status on public\.tickets/);
  assert.match(migration, /create constraint trigger ticket_payment_events_f16_staff_commission[\s\S]*deferrable initially deferred/);
  assert.match(migration, /p_end_date > p_start_date \+ 91/);
  assert.match(migration, /'financial_reports_read'::public\.financial_permission_key/);
  assert.match(migration, /and \(v_full or e\.staff_id = v_own_staff\)/);
  assert.doesNotMatch(migration, /grant [^;]* on table public\.staff_commission/i);
});
