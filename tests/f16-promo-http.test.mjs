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
const user = { id: 'f1680000-0000-4000-8000-000000000401', email: 'f1606@example.test' };
const businessId = 'f1680000-0000-4000-8000-000000000402';
const promoId = 'f1680000-0000-4000-8000-000000000403';
const ticketId = 'f1680000-0000-4000-8000-000000000404';
const serviceId = 'f1680000-0000-4000-8000-000000000405';
const token = 'T'.repeat(43);
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: 'f1680000-0000-4000-8000-000000000406',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function memberHeaders(extra = {}) {
  return { Origin: 'http://localhost', Cookie: `yzt_access=${accessToken()}; yzt_refresh=r; yzt_business=${businessId}; yzt_csrf=${csrf}`, 'X-YZT-CSRF': csrf, 'Content-Type': 'application/json', ...extra };
}

async function withFetch(handler, run, permissions = {}) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([{ id: 'f1680000-0000-4000-8000-000000000407', business_id: businessId, role: 'owner', active: true }]);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') return json(permissions[body.p_permission] ?? true);
    calls.push({ path: url.pathname, body, url: url.toString() });
    const result = await handler({ path: url.pathname, body });
    if (!result) throw new Error(`unexpected fetch ${url.pathname}`);
    return result;
  };
  try { await run(calls); } finally { globalThis.fetch = realFetch; }
}

await test('F16-06 public preview goes through the gated promo operation and returns terms only', async () => {
  await withFetch(async ({ path, body }) => {
    assert.equal(path, '/rest/v1/rpc/execute_public_promo_operation');
    assert.equal(body.p_action, 'promo_preview');
    assert.equal(body.p_gate_secret, env.PUBLIC_BOOKING_GATE_SECRET);
    assert.deepEqual(body.p_args, { p_slug: 'salon-a', p_code: 'YAZ20', p_service_ids: [serviceId] });
    return json({ ok: true, data: [{ code: 'YAZ20', kind: 'percent', percent_bps: 2000, amount_minor: null, currency: 'TRY', ends_at: null, applicable: true, scoped: false }] });
  }, async (calls) => {
    const response = await app.request(`http://localhost/api/public/business/salon-a/promo?code=yaz20&serviceIds=${serviceId}`, {
      headers: { 'CF-Connecting-IP': '203.0.113.80' },
    }, env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual((await response.json()).promo, { code: 'YAZ20', kind: 'percent', percentBps: 2000, amountMinor: null, currency: 'TRY', endsAt: null, applicable: true, scoped: false });
    assert.equal(calls.length, 1);
  });
});

await test('F16-06 invalid public input is rejected before any upstream call', async () => {
  await withFetch(async () => null, async (calls) => {
    for (const path of [
      '/api/public/business/salon-a/promo?code=a',
      '/api/public/business/salon-a/promo?code=YAZ20&serviceIds=not-a-uuid',
      `/api/public/business/salon-a/promo?code=${'A'.repeat(40)}`,
    ]) {
      const response = await app.request(`http://localhost${path}`, { headers: { 'CF-Connecting-IP': '203.0.113.81' } }, env);
      assert.equal(response.status, 400, path);
    }
    const noToken = await app.request('http://localhost/api/manage/promo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'short', code: 'YAZ20' }),
    }, env);
    assert.equal(noToken.status, 404);
    const badCode = await app.request('http://localhost/api/manage/promo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, code: '!!' }),
    }, env);
    assert.equal(badCode.status, 400);
    assert.equal(calls.length, 0);
  });
});

await test('F16-06 capability attach keeps the token out of URLs and maps refusals', async () => {
  let refusal = null;
  await withFetch(async ({ path, body }) => {
    assert.equal(path, '/rest/v1/rpc/execute_public_promo_operation');
    if (body.p_action === 'manage_promo_view') {
      assert.deepEqual(body.p_args, { p_token: token });
      return json({ ok: true, data: [{ code: null, kind: null, percent_bps: null, amount_minor: null, currency: null, status: null, attachable: true }] });
    }
    assert.equal(body.p_action, 'manage_promo_attach');
    assert.deepEqual(body.p_args, { p_token: token, p_code: 'YAZ20' });
    if (refusal) return json({ ok: false, error: { message: refusal } });
    return json({ ok: true, data: [{ code: 'YAZ20', kind: 'percent', percent_bps: 2000, amount_minor: null, currency: 'TRY', status: 'reserved', attachable: false }] });
  }, async (calls) => {
    const view = await app.request('http://localhost/api/manage/promo/view', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.82' }, body: JSON.stringify({ token }),
    }, env);
    assert.equal(view.status, 200);
    assert.equal((await view.json()).promo.attachable, true);
    const attach = await app.request('http://localhost/api/manage/promo', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.82' }, body: JSON.stringify({ token, code: ' yaz20 ' }),
    }, env);
    assert.equal(attach.status, 201);
    assert.equal((await attach.json()).promo.status, 'reserved');
    for (const [message, status] of [['PROMO_EXHAUSTED', 409], ['PROMO_EXPIRED', 409], ['PROMO_NOT_FOUND', 404], ['PROMO_NOT_ATTACHABLE', 409], ['PROMO_ALREADY_APPLIED', 409], ['MANAGEMENT_NOT_FOUND', 404], ['PUBLIC_BOOKING_RATE_LIMITED:30', 429]]) {
      refusal = message;
      const response = await app.request('http://localhost/api/manage/promo', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.82' }, body: JSON.stringify({ token, code: 'YAZ20' }),
      }, env);
      assert.equal(response.status, status, message);
      if (status !== 429) assert.equal((await response.json()).error.code, message.split(':')[0]);
    }
    assert.ok(calls.every((call) => !call.url.includes(token)), 'token never appears in an upstream URL');
  });
});

await test('F16-06 member definitions derive the tenant and validate terms before the RPC', async () => {
  await withFetch(async ({ path, body }) => {
    assert.equal(path, '/rest/v1/rpc/create_promo_code_guarded');
    assert.deepEqual(body, {
      p_business_id: businessId, p_promo_id: promoId, p_code: 'YAZ20', p_kind: 'percent', p_percent_bps: 2000, p_amount_minor: null,
      p_starts_at: '2026-09-24T00:00:00.000Z', p_ends_at: null, p_usage_limit: 50, p_service_ids: [serviceId],
    });
    return json({ promoId, code: 'YAZ20' });
  }, async (calls) => {
    const ok = await app.request('http://localhost/api/promo-codes', {
      method: 'POST', headers: memberHeaders(),
      body: JSON.stringify({ promoId, code: 'yaz20', kind: 'percent', percentBps: 2000, amountMinor: null, startsAt: '2026-09-24T00:00:00Z', endsAt: null, usageLimit: 50, serviceIds: [serviceId], businessId: 'f1680000-0000-4000-8000-000000000499' }),
    }, env);
    assert.equal(ok.status, 201);
    for (const body of [
      { promoId, code: 'YAZ20', kind: 'percent', percentBps: 0, startsAt: '2026-09-24T00:00:00Z', serviceIds: [] },
      { promoId, code: 'YAZ20', kind: 'percent', percentBps: 2000, amountMinor: 100, startsAt: '2026-09-24T00:00:00Z', serviceIds: [] },
      { promoId, code: 'YAZ20', kind: 'fixed', amountMinor: 0, startsAt: '2026-09-24T00:00:00Z', serviceIds: [] },
      { promoId, code: 'YAZ20', kind: 'percent', percentBps: 2000, startsAt: '2026-09-24', serviceIds: [] },
      { promoId, code: 'YAZ20', kind: 'percent', percentBps: 2000, startsAt: '2026-09-24T00:00:00Z', endsAt: '2026-09-23T00:00:00Z', serviceIds: [] },
      { promoId, code: 'YAZ20', kind: 'percent', percentBps: 2000, startsAt: '2026-09-24T00:00:00Z', usageLimit: 0, serviceIds: [] },
      { promoId, code: 'YAZ20', kind: 'percent', percentBps: 2000, startsAt: '2026-09-24T00:00:00Z', serviceIds: ['x'] },
      { promoId, code: 'Y', kind: 'percent', percentBps: 2000, startsAt: '2026-09-24T00:00:00Z', serviceIds: [] },
    ]) {
      const response = await app.request('http://localhost/api/promo-codes', { method: 'POST', headers: memberHeaders(), body: JSON.stringify(body) }, env);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal(calls.length, 1);
  });
});

await test('F16-06 ticket apply/remove are idempotent pricing commands; staff without pricing are refused first', async () => {
  await withFetch(async ({ path, body }) => {
    assert.match(path, /^\/rest\/v1\/rpc\/(apply|remove)_ticket_promo_guarded$/);
    assert.equal(body.p_business_id, businessId);
    assert.match(body.p_request_hash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(body).includes('discount'), false);
    return json({ ticketId, businessId, version: 4 });
  }, async (calls) => {
    const apply = await app.request(`http://localhost/api/tickets/${ticketId}/promo`, {
      method: 'POST', headers: memberHeaders({ 'Idempotency-Key': 'f1606-http-apply' }), body: JSON.stringify({ code: 'yaz20', expectedVersion: 3, discountMinor: 999 }),
    }, env);
    assert.equal(apply.status, 200);
    assert.equal(calls[0].body.p_code, 'YAZ20');
    const remove = await app.request(`http://localhost/api/tickets/${ticketId}/promo/remove`, {
      method: 'POST', headers: memberHeaders({ 'Idempotency-Key': 'f1606-http-remove' }), body: JSON.stringify({ reason: ' Yanlış kod ', expectedVersion: 4 }),
    }, env);
    assert.equal(remove.status, 200);
    assert.equal(calls[1].body.p_reason, 'Yanlış kod');
    const noKey = await app.request(`http://localhost/api/tickets/${ticketId}/promo`, {
      method: 'POST', headers: memberHeaders(), body: JSON.stringify({ code: 'YAZ20', expectedVersion: 3 }),
    }, env);
    assert.equal(noKey.status, 400);
    assert.equal(calls.length, 2);
  });
  await withFetch(async () => null, async (calls) => {
    const denied = await app.request(`http://localhost/api/tickets/${ticketId}/promo`, {
      method: 'POST', headers: memberHeaders({ 'Idempotency-Key': 'f1606-http-denied' }), body: JSON.stringify({ code: 'YAZ20', expectedVersion: 3 }),
    }, env);
    assert.equal(denied.status, 403);
    assert.equal(calls.length, 0);
  }, { pricing_adjustments_write: false });
});

await test('F16-06 ticket promo refusals map to exact codes', async () => {
  for (const [message, status] of [['PROMO_ALREADY_APPLIED', 409], ['PROMO_EXHAUSTED', 409], ['PROMO_NOT_APPLICABLE', 409], ['TICKET_TOTAL_BELOW_PAID', 409], ['PROMO_NOT_APPLIED', 409]]) {
    await withFetch(async () => json({ message }, 400), async () => {
      const response = await app.request(`http://localhost/api/tickets/${ticketId}/promo`, {
        method: 'POST', headers: memberHeaders({ 'Idempotency-Key': `f1606-http-${message.toLowerCase()}` }), body: JSON.stringify({ code: 'YAZ20', expectedVersion: 3 }),
      }, env);
      assert.equal(response.status, status, message);
      assert.equal((await response.json()).error.code, message);
    });
  }
});
