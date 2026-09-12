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
    session_id: '40000000-0000-4000-8000-000000000009',
    amr: [{ method: 'recovery', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function setCookieValues(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

await test('S01 a corrupted marker cannot widen a verified recovery session', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return json(user);
    throw new Error(`corrupted-marker request escaped to ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/catalog', {
      method: 'GET',
      headers: {
        Cookie: `yzt_access=${recoveryAccessToken()}; yzt_refresh=recovery-refresh; yzt_password_recovery=corrupted`,
      },
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.match(setCookieValues(response).join('\n'), /yzt_password_recovery=1/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
