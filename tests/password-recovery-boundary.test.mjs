import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

await test('F10-01 password recovery session cannot enter protected feature routers', async () => {
  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return json({});
  };

  try {
    for (const path of [
      '/api/availability',
      '/api/bookings',
      '/api/calendar',
      '/api/public/settings',
    ]) {
      const response = await app.request(`http://localhost${path}`, {
        method: 'GET',
        headers: { Cookie: 'yzt_password_recovery=1' },
      }, env);
      assert.equal(response.status, 403, `${path} must be unavailable during recovery`);
      const body = await response.json();
      assert.equal(body.error?.code, 'PASSWORD_UPDATE_REQUIRED');
    }
    assert.equal(upstreamCalls, 0, 'recovery-only feature requests must be rejected before Supabase');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F10-01 authenticated recovery is rejected before selected-business lookup', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) {
      return json({
        id: '10000000-0000-4000-8000-000000000001',
        email: 'owner@example.test',
      });
    }
    throw new Error(`unexpected recovery boundary fetch: ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/catalog', {
      method: 'GET',
      headers: {
        Cookie: 'yzt_access=recovery-access-token; yzt_password_recovery=1',
      },
    }, env);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error?.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.deepEqual(calls, ['https://supabase.example.test/auth/v1/user']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
