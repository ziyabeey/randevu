import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHopTrace } from './helpers/f17-hop-trace.mjs';

const origin = 'https://supabase.example.test';
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

await test('trace recorder distinguishes sequential and overlapping requests', async () => {
  const wait = deferred();
  const trace = createHopTrace(async (endpoint) => {
    if (endpoint === 'business' || endpoint === 'staff') await wait.promise;
    return json([]);
  });
  await trace.fetch(`${origin}/auth/v1/user`);
  const business = trace.fetch(`${origin}/rest/v1/businesses`);
  const staff = trace.fetch(`${origin}/rest/v1/staff_profiles`);
  assert.throws(() => trace.snapshot(), /incomplete/);
  wait.resolve();
  await Promise.all([business, staff]);
  await trace.fetch(`${origin}/rest/v1/memberships`);
  const result = trace.snapshot();
  assert.equal(result.upstreamCalls, 4);
  assert.equal(result.peakInFlight, 2);
  assert.deepEqual(result.overlapWaves, [['auth_user'], ['business', 'staff'], ['memberships']]);
  assert.ok(result.calls[2].start < result.calls[1].end);
});

await test('trace recorder retains failed-call counts but never exception content', async () => {
  const trace = createHopTrace(async () => { throw new Error('synthetic-secret-in-upstream-error'); });
  await assert.rejects(trace.fetch(`${origin}/auth/v1/user`), /synthetic-secret/);
  const result = trace.snapshot();
  assert.equal(result.upstreamCalls, 1);
  assert.equal(result.calls[0].outcome, 'rejected');
  assert.equal(result.calls[0].status, null);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
});

await test('trace recorder refuses unknown origins, endpoints and methods without network fallback', async () => {
  for (const [url, init] of [
    ['https://unexpected.example.test/auth/v1/user', {}],
    [`${origin}/rest/v1/rpc/unexpected`, { method: 'POST' }],
    [`${origin}/auth/v1/user`, { method: 'DELETE' }],
    ['https://name:synthetic-password@supabase.example.test/auth/v1/user', {}],
  ]) {
    let reached = false;
    const trace = createHopTrace(() => { reached = true; return json([]); });
    await assert.rejects(trace.fetch(url, init), /unexpected request/);
    assert.equal(reached, false);
    assert.throws(() => trace.snapshot(), /refused requests/);
  }
});

await test('trace recorder strips query/header/body values and returns detached snapshots', async () => {
  const trace = createHopTrace(() => json({ sensitive: 'synthetic-body' }));
  await trace.fetch(`${origin}/rest/v1/memberships?user_id=synthetic-user`, {
    headers: { Authorization: 'Bearer synthetic-token', Cookie: 'synthetic-cookie' },
  });
  const result = trace.snapshot();
  assert.doesNotMatch(JSON.stringify(result), /synthetic-|https:|Authorization|Cookie/);
  result.calls[0].endpoint = 'changed';
  result.overlapWaves[0].push('changed');
  assert.equal(trace.snapshot().calls[0].endpoint, 'memberships');
  assert.deepEqual(trace.snapshot().overlapWaves, [['memberships']]);
});

await test('trace recorder distinguishes HTTP errors and rejects unbounded observations', async () => {
  const trace = createHopTrace(() => json({}, 503));
  for (let i = 0; i < 64; i += 1) await trace.fetch(`${origin}/auth/v1/user`);
  assert.equal(trace.snapshot().calls[0].status, 503);
  await assert.rejects(trace.fetch(`${origin}/auth/v1/user`), /call limit/);
  assert.throws(() => trace.snapshot(), /refused requests/);
});

await test('trace recorder reports zero only when no request was made', () => {
  assert.deepEqual(createHopTrace(() => json([])).snapshot(), {
    upstreamCalls: 0, peakInFlight: 0, overlapWaves: [], calls: [],
  });
});

const user = { id: '91000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const businessId = '92000000-0000-4000-8000-000000000001';
const membershipId = '93000000-0000-4000-8000-000000000001';
const staffId = '96000000-0000-4000-8000-000000000001';
const env = {
  SUPABASE_URL: origin, SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false', PUBLIC_APP_ORIGIN: 'http://localhost',
};
const business = { id: businessId, name: 'Synthetic salon', slug: 'synthetic-salon', timezone: 'Europe/Istanbul' };
const member = { id: membershipId, business_id: businessId, user_id: user.id, role: 'owner', active: true,
  businesses: business, plan: { plan_access: 'full' } };

function cookie(method = 'password') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: `${origin}/auth/v1`, aud: 'authenticated', exp: now + 3600, iat: now,
    sub: user.id, role: 'authenticated', session_id: '97000000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: now }],
  })).toString('base64url');
  // This is an existing-session read probe, not a login or refresh-token measurement.
  return `yzt_access=${header}.${payload}.test-signature; yzt_business=${businessId}; yzt_csrf=${'B'.repeat(43)}`;
}

async function probe(t, route, { mode = 'healthy', session = true, method = 'password' } = {}) {
  // Deliberately load the actual routing graph, not a copied calendar handler.
  const { default: app } = await import('../worker/app.ts');
  let contractError = null;
  const trace = createHopTrace(async (endpoint, input, init) => {
    // Equal synthetic response scheduling reveals Promise.all overlap, not hosted latency.
    await tick();
    try {
      const url = new URL(String(input));
      if (endpoint === 'auth_user') return json(user, mode === 'auth_unavailable' ? 503 : 200);
      if (endpoint === 'memberships') {
        assert.equal(url.searchParams.get('active'), 'eq.true');
        assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
        if (route !== '/api/session') assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
        return json(mode === 'revoked' ? [] : [member]);
      }
      if (endpoint === 'business') {
        assert.equal(url.searchParams.get('id'), `eq.${businessId}`);
        return json([business]);
      }
      if (endpoint === 'staff') {
        assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
        return json([{ id: staffId, name: 'Synthetic staff', active: true }]);
      }
      assert.equal(endpoint, 'calendar_v2');
      assert.equal(JSON.parse(init.body).p_business_id, businessId);
      return json(mode === 'rpc_failure' ? { message: 'unavailable' } : [], mode === 'rpc_failure' ? 503 : 200);
    } catch (error) {
      // Supabase transport catches fetch errors. Preserve assertion failures for the test.
      contractError = error;
      throw error;
    }
  });
  const mocked = t.mock.method(globalThis, 'fetch', trace.fetch);
  try {
    const response = await app.request(`http://localhost${route}`, {
      headers: session ? { Cookie: cookie(method) } : {},
    }, env);
    const data = await response.json();
    if (contractError) throw contractError;
    return { response, data, trace: trace.snapshot() };
  } finally { mocked.mock.restore(); }
}

let receipt = null;
let boundaryChecksPassed = 0;
const sessionWaves = [['auth_user'], ['memberships']];
const calendarWaves = [...sessionWaves, ['business', 'staff'], ['calendar_v2']];

await test('F17-03C2 actual Worker measures authenticated session and repeat-calendar hops', async (t) => {
  const session = await probe(t, '/api/session');
  assert.equal(session.response.status, 200);
  assert.equal(session.data.user.id, user.id);
  assert.equal(session.data.activeBusinessId, businessId);
  assert.deepEqual(session.trace.overlapWaves, sessionWaves);
  const samples = [{ name: 'authenticated_session_read', ...session.trace }];
  for (const name of ['calendar_initial_read', 'calendar_repeat_read']) {
    const result = await probe(t, '/api/calendar?date=2026-09-26&days=1');
    assert.equal(result.response.status, 200);
    assert.equal(result.data.business.id, businessId);
    assert.equal(result.data.date, '2026-09-26');
    assert.deepEqual(result.data.appointments, []);
    assert.deepEqual(result.trace.overlapWaves, calendarWaves);
    assert.equal(result.trace.peakInFlight, 2);
    samples.push({ name, ...result.trace });
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  let checkoutSha = null;
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
    if (/^[a-f0-9]{40}$/.test(value)) checkoutSha = value;
  } catch { /* Unknown provenance stays null. */ }
  const sourceDigests = Object.fromEntries([
    'worker/app.ts', 'worker/auth.ts', 'worker/snapshot-reads.ts', 'worker/f11-group-consumer-reads.ts',
  ].map((file) => [file, createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex')]));
  receipt = {
    schema: 'f17-hot-path-v1', observation: 'actual_worker_with_synthetic_upstream',
    checkoutSha, sourceDigests, samples,
    browserRequestsObserved: false, hostedLatency: 'NOT_MEASURED', p50Ms: null, p95Ms: null,
    limitations: ['Overlap waves describe fetch-promise overlap under equal synthetic scheduling, not a network critical path.',
      'Existing authenticated GETs only; no login, token refresh, browser bootstrap, polling interval or SQL-internal round trips.',
      'Empty-calendar fixture; no hosted latency, load capacity or performance improvement is claimed.'],
  };
});

for (const scenario of [
  { name: 'anonymous', session: false, status: 401, code: 'AUTH_REQUIRED', waves: [] },
  { name: 'recovery', method: 'recovery', status: 403, code: 'PASSWORD_UPDATE_REQUIRED', waves: [['auth_user']] },
  { name: 'revoked', mode: 'revoked', status: 403, code: 'TENANT_REQUIRED', waves: sessionWaves },
  { name: 'auth unavailable', mode: 'auth_unavailable', status: 503, code: 'AUTH_UNAVAILABLE', waves: [['auth_user']] },
  { name: 'RPC unavailable', mode: 'rpc_failure', status: 503, code: 'CALENDAR_UNAVAILABLE', waves: calendarWaves },
]) {
  await test(`F17-03C2 actual Worker ${scenario.name} cannot count skipped checks as success`, async (t) => {
    const result = await probe(t, '/api/calendar?date=2026-09-26&days=1', scenario);
    assert.equal(result.response.status, scenario.status);
    assert.equal(result.data.error?.code, scenario.code);
    assert.deepEqual(result.trace.overlapWaves, scenario.waves);
    boundaryChecksPassed += 1;
  });
}

await test('F17-03C2 actual Worker publishes the observation only after boundary checks pass', () => {
  assert.ok(receipt, 'The actual Worker observation must exist');
  assert.equal(boundaryChecksPassed, 5, 'A failed boundary check must withhold the receipt');
  console.log(`F17_HOT_PATH_RECEIPT ${JSON.stringify(receipt)}`);
});
