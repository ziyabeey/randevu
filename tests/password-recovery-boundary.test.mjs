import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
};

await test('F10-01 password recovery session is confined to password update', async () => {
  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    for (const path of [
      '/api/catalog',
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
    assert.equal(upstreamCalls, 0, 'recovery-only requests must be rejected before Supabase');
  } finally {
    globalThis.fetch = realFetch;
  }
});
