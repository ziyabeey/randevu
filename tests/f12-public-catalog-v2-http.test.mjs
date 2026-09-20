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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

await test('F12-04C public catalog v2 uses additive services_v2 action and preserves range metadata', async () => {
  const realFetch = globalThis.fetch;
  const range = {
    service_id: 'f2300000-0000-4000-8000-000000000002',
    name: 'Range V2',
    category: 'Renk',
    sort_order: 20,
    duration_minutes: 60,
    price_type: 'range',
    price_min_minor: 12000,
    price_max_minor: 18000,
    currency: 'TRY',
    price_policy_version: 2,
  };
  let rpcCalls = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/rest/v1/rpc/execute_public_operation');
    const body = JSON.parse(String(init.body ?? '{}'));
    assert.equal(body.p_action, 'services_v2');
    assert.deepEqual(body.p_args, { p_slug: 'test-salon' });
    assert.equal(typeof body.p_gate_secret, 'string');
    assert.match(body.p_actor_hash, /^[0-9a-f]{64}$/);
    assert.match(body.p_network_hash, /^[0-9a-f]{64}$/);
    rpcCalls += 1;
    return json({ ok: true, data: [range] });
  };

  try {
    const response = await app.request(
      'http://localhost/api/public/business/test-salon/services-v2',
      { headers: { 'CF-Connecting-IP': '203.0.113.14' } },
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.services, [range]);
    assert.equal('price_minor' in body.services[0], false);
    assert.equal(rpcCalls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F12-04C invalid slug and missing gate fail before catalog RPC', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected upstream call');
  };

  try {
    const invalid = await app.request(
      'http://localhost/api/public/business/not%20valid/services-v2',
      { headers: { 'CF-Connecting-IP': '203.0.113.14' } },
      env,
    );
    assert.equal(invalid.status, 404);

    const unavailable = await app.request(
      'http://localhost/api/public/business/test-salon/services-v2',
      { headers: { 'CF-Connecting-IP': '203.0.113.14' } },
      { ...env, PUBLIC_BOOKING_GATE_SECRET: '' },
    );
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error?.code, 'PUBLIC_BOOKING_UNAVAILABLE');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});


await test('F12-04C services-v2 overflow stays a bounded 409 public error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/rest/v1/rpc/execute_public_operation');
    const body = JSON.parse(String(init.body ?? '{}'));
    assert.equal(body.p_action, 'services_v2');
    return json({ ok: false, error: { message: 'PUBLIC_SERVICES_LIMIT_EXCEEDED' } });
  };

  try {
    const response = await app.request(
      'http://localhost/api/public/business/test-salon/services-v2',
      { headers: { 'CF-Connecting-IP': '203.0.113.15' } },
      env,
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'PUBLIC_SERVICES_LIMIT_EXCEEDED');
  } finally {
    globalThis.fetch = realFetch;
  }
});
