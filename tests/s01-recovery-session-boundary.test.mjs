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
const businessId = '20000000-0000-4000-8000-000000000001';
const membership = {
  id: '30000000-0000-4000-8000-000000000001',
  business_id: businessId,
  role: 'owner',
  active: true,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function accessToken(method, suffix = 'one') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: user.id,
    role: 'authenticated',
    session_id: `40000000-0000-4000-8000-0000000000${suffix === 'one' ? '01' : '02'}`,
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function setCookieValues(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function absorbCookies(jar, response) {
  for (const value of setCookieValues(response)) {
    const pair = value.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index);
    const cookieValue = pair.slice(index + 1);
    if (!cookieValue) jar.delete(name);
    else jar.set(name, cookieValue);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  if (jar.size) headers.set('Cookie', cookieHeader(jar));
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await app.request(`http://localhost${path}`, { ...init, headers }, env);
  absorbCookies(jar, response);
  return response;
}

await test('S01 recovery authority survives a missing marker and a second-tab cookie jar', async () => {
  const realFetch = globalThis.fetch;
  const recoveryAccess = accessToken('recovery');
  const jar = new Map([
    ['yzt_access', recoveryAccess],
    ['yzt_refresh', 'recovery-refresh-one'],
  ]);
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return json(user);
    throw new Error(`unexpected recovery fetch: ${url}`);
  };

  try {
    const response = await request(jar, '/api/catalog');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.equal(jar.get('yzt_password_recovery'), '1', 'server-verified recovery repairs the UI hint');
    assert.deepEqual(calls, ['https://supabase.example.test/auth/v1/user']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S01 a forged recovery marker cannot downgrade a normal password session', async () => {
  const realFetch = globalThis.fetch;
  const jar = new Map([
    ['yzt_access', accessToken('password')],
    ['yzt_refresh', 'password-refresh-one'],
    ['yzt_business', businessId],
    ['yzt_password_recovery', '1'],
  ]);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return json(user);
    if (url.includes('/rest/v1/memberships?')) return json([membership]);
    if (url.endsWith('/rest/v1/rpc/get_catalog_snapshot')) {
      return json([{ services: [], staff: [], assignments: [] }]);
    }
    throw new Error(`unexpected normal-session fetch: ${url}`);
  };

  try {
    const response = await request(jar, '/api/catalog');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.membership.business_id, businessId);
    assert.equal(jar.has('yzt_password_recovery'), false, 'stale UI hint is cleared from a normal session');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S01 refresh rotation preserves the Supabase recovery session classification', async () => {
  const realFetch = globalThis.fetch;
  const recoveryAccess = accessToken('recovery', 'two');
  const jar = new Map([
    ['yzt_access', 'expired-access-token'],
    ['yzt_refresh', 'recovery-refresh-one'],
  ]);
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return json({ message: 'expired' }, 401);
    if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
      assert.equal(JSON.parse(String(init.body)).refresh_token, 'recovery-refresh-one');
      return json({
        access_token: recoveryAccess,
        refresh_token: 'recovery-refresh-two',
        expires_in: 3600,
        user,
      });
    }
    if (url.includes('/rest/v1/memberships?')) return json([]);
    throw new Error(`unexpected refresh fetch: ${url}`);
  };

  try {
    const response = await request(jar, '/api/session');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.passwordRecovery, true);
    assert.equal(jar.get('yzt_access'), recoveryAccess);
    assert.equal(jar.get('yzt_refresh'), 'recovery-refresh-two');
    assert.equal(jar.get('yzt_password_recovery'), '1');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S01 an invalid confirmation cannot widen an existing recovery session', async () => {
  const realFetch = globalThis.fetch;
  const csrf = 'C'.repeat(43);
  const jar = new Map([
    ['yzt_access', accessToken('recovery')],
    ['yzt_refresh', 'recovery-refresh-one'],
    ['yzt_csrf', csrf],
    ['yzt_password_recovery', '1'],
  ]);
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/verify')) return json({ message: 'token expired' }, 403);
    if (url.endsWith('/auth/v1/user')) return json(user);
    throw new Error(`unexpected invalid-confirmation fetch: ${url}`);
  };

  try {
    const invalid = await request(jar, '/api/auth/confirm', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Sec-Fetch-Site': 'same-origin',
        'X-YZT-CSRF': csrf,
      },
      body: JSON.stringify({ tokenHash: 'A'.repeat(32), type: 'recovery' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error?.code, 'AUTH_LINK_INVALID');

    const catalog = await request(jar, '/api/catalog');
    assert.equal(catalog.status, 403);
    assert.equal((await catalog.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.equal(jar.get('yzt_password_recovery'), '1');
    assert.deepEqual(calls, [
      'https://supabase.example.test/auth/v1/verify',
      'https://supabase.example.test/auth/v1/user',
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
