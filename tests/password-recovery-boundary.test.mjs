import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
};

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recoveryAccessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: user.id,
    role: 'authenticated',
    session_id: '40000000-0000-4000-8000-000000000001',
    amr: [{ method: 'recovery', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

await test('S01 password recovery session cannot enter protected feature routers without a marker', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return json(user);
    throw new Error(`recovery feature request escaped to ${url}`);
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
        headers: {
          Cookie: `yzt_access=${recoveryAccessToken()}; yzt_refresh=recovery-refresh`,
        },
      }, env);
      assert.equal(response.status, 403, `${path} must be unavailable during recovery`);
      const body = await response.json();
      assert.equal(body.error?.code, 'PASSWORD_UPDATE_REQUIRED');
      assert.match(response.headers.get('set-cookie') ?? '', /yzt_password_recovery=1/);
    }
    assert.equal(calls.length, 4);
    assert.ok(calls.every((url) => url === 'https://supabase.example.test/auth/v1/user'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S01 authenticated recovery is rejected before selected-business lookup', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return json(user);
    throw new Error(`unexpected recovery boundary fetch: ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/catalog', {
      method: 'GET',
      headers: {
        Cookie: `yzt_access=${recoveryAccessToken()}; yzt_refresh=recovery-refresh`,
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
