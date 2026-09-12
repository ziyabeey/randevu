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

async function csrf(jar) {
  const response = await request(jar, '/api/csrf');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.csrfToken, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(jar.get('yzt_csrf'), body.csrfToken);
  assert.match(setCookieValues(response).join('\n'), /yzt_csrf=.*HttpOnly/i);
  return body.csrfToken;
}

function browserHeaders(csrfToken, origin = 'http://localhost') {
  return {
    Origin: origin,
    'Sec-Fetch-Site': origin === 'http://localhost' ? 'same-origin' : 'cross-site',
    'X-YZT-CSRF': csrfToken,
  };
}

function decodeFlowCookie(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

const user = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const token = {
  access_token: 'access-token-one',
  refresh_token: 'refresh-token-one',
  expires_in: 3600,
  user,
};

await test('F10-01 auth, session and request security contract', async (t) => {
  const realFetch = globalThis.fetch;

  await t.test('browser mutations require exact Origin and matching double-submit CSRF', async () => {
    const jar = new Map();
    const csrfToken = await csrf(jar);
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return json(token); };

    const crossSite = await request(jar, '/api/auth/login', {
      method: 'POST',
      headers: browserHeaders(csrfToken, 'https://attacker.example'),
      body: JSON.stringify({ email: user.email, password: 'not-used-here' }),
    });
    assert.equal(crossSite.status, 403);
    assert.equal((await crossSite.json()).error.code, 'ORIGIN_FORBIDDEN');

    const missingCsrf = await request(jar, '/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ email: user.email, password: 'not-used-here' }),
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).error.code, 'CSRF_INVALID');
    assert.equal(calls, 0, 'rejected browser requests must not reach Supabase');
  });

  await t.test('login stores tokens only in HttpOnly cookies', async () => {
    const jar = new Map();
    const csrfToken = await csrf(jar);
    globalThis.fetch = async (input, init = {}) => {
      assert.match(String(input), /auth\/v1\/token\?grant_type=password$/);
      const body = JSON.parse(String(init.body));
      assert.equal(body.email, user.email);
      return json(token);
    };

    const response = await request(jar, '/api/auth/login', {
      method: 'POST',
      headers: browserHeaders(csrfToken),
      body: JSON.stringify({ email: user.email, password: 'correct-password' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const cookies = setCookieValues(response).join('\n');
    assert.match(cookies, /yzt_access=.*HttpOnly/i);
    assert.match(cookies, /yzt_refresh=.*HttpOnly/i);
    assert.equal(jar.get('yzt_access'), token.access_token);
    assert.equal(jar.get('yzt_refresh'), token.refresh_token);
  });

  await t.test('expired access cookie refreshes and memberships are read from current DB state', async () => {
    const jar = new Map([
      ['yzt_access', 'expired-access'],
      ['yzt_refresh', 'refresh-token-one'],
      ['yzt_business', '20000000-0000-4000-8000-000000000001'],
    ]);
    const refreshed = {
      ...token,
      access_token: 'access-token-two',
      refresh_token: 'refresh-token-two',
    };
    const membership = {
      id: '30000000-0000-4000-8000-000000000001',
      business_id: '20000000-0000-4000-8000-000000000001',
      role: 'owner',
      active: true,
      businesses: {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Session Test',
        slug: 'session-test',
        timezone: 'Europe/Istanbul',
      },
    };
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return json({ message: 'expired' }, 401);
      if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
        assert.equal(JSON.parse(String(init.body)).refresh_token, 'refresh-token-one');
        return json(refreshed);
      }
      if (url.includes('/rest/v1/memberships?')) return json([membership]);
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await request(jar, '/api/session');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.id, user.id);
    assert.equal(body.memberships.length, 1);
    assert.equal(body.activeBusinessId, membership.business_id);
    assert.match(body.csrfToken, /^[A-Za-z0-9_-]{43,128}$/);
    assert.equal(jar.get('yzt_access'), refreshed.access_token);
    assert.equal(jar.get('yzt_refresh'), refreshed.refresh_token);
    assert.equal(calls.filter((call) => call.url.includes('/memberships?')).length, 1);
  });

  await t.test('a removed membership invalidates the selected business cookie immediately', async () => {
    const jar = new Map([
      ['yzt_access', 'current-access'],
      ['yzt_refresh', 'current-refresh'],
      ['yzt_business', '20000000-0000-4000-8000-000000000001'],
    ]);
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return json(user);
      if (url.includes('/rest/v1/memberships?')) return json([]);
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await request(jar, '/api/session');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.memberships, []);
    assert.equal(body.activeBusinessId, null);
    assert.equal(jar.has('yzt_business'), false);
  });

  await t.test('recovery creates a bounded HttpOnly PKCE flow without exposing the verifier', async () => {
    const jar = new Map();
    const csrfToken = await csrf(jar);
    let redirectTo = '';
    let requestBody = null;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/auth/v1/recover');
      redirectTo = url.searchParams.get('redirect_to') ?? '';
      requestBody = JSON.parse(String(init.body));
      return json({});
    };

    const response = await request(jar, '/api/auth/recovery', {
      method: 'POST',
      headers: browserHeaders(csrfToken),
      body: JSON.stringify({ email: user.email }),
    });
    assert.equal(response.status, 202);
    assert.match((await response.json()).message, /hesaba bağlıysa/i);
    assert.match(redirectTo, /^http:\/\/localhost\/api\/auth\/callback\?state=/);
    assert.match(requestBody.code_challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(requestBody.code_challenge_method, 's256');
    assert.equal('code_verifier' in requestBody, false);

    const flows = decodeFlowCookie(jar.get('yzt_auth_flows'));
    assert.equal(flows.length, 1);
    assert.equal(flows[0].action, 'recovery');
    assert.match(flows[0].state, /^[A-Za-z0-9_-]{32,128}$/);
    assert.match(flows[0].verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.ok(flows[0].expiresAt > Date.now());
    const flowCookie = setCookieValues(response).join('\n');
    assert.match(flowCookie, /yzt_auth_flows=.*HttpOnly/i);
    assert.match(flowCookie, /Path=\/api\/auth/i);
  });

  await t.test('PKCE callback binds state to verifier, rejects replay and never redirects tokens', async () => {
    const jar = new Map();
    const csrfToken = await csrf(jar);
    globalThis.fetch = async () => json({});
    const recovery = await request(jar, '/api/auth/recovery', {
      method: 'POST',
      headers: browserHeaders(csrfToken),
      body: JSON.stringify({ email: user.email }),
    });
    assert.equal(recovery.status, 202);
    const [flow] = decodeFlowCookie(jar.get('yzt_auth_flows'));

    let exchangedBody = null;
    globalThis.fetch = async (input, init = {}) => {
      assert.match(String(input), /auth\/v1\/token\?grant_type=pkce$/);
      exchangedBody = JSON.parse(String(init.body));
      return json({ ...token, type: 'recovery' });
    };

    const callback = await request(jar, `/api/auth/callback?state=${encodeURIComponent(flow.state)}&code=auth-code-one`);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), 'http://localhost/?auth=recovery');
    assert.deepEqual(exchangedBody, { auth_code: 'auth-code-one', code_verifier: flow.verifier });
    assert.equal(callback.headers.get('location').includes(token.access_token), false);
    assert.equal(jar.get('yzt_access'), token.access_token);
    assert.equal(jar.get('yzt_password_recovery'), '1');

    let replayCalls = 0;
    globalThis.fetch = async () => { replayCalls += 1; return json(token); };
    const replay = await request(jar, `/api/auth/callback?state=${encodeURIComponent(flow.state)}&code=auth-code-one`);
    assert.equal(replay.status, 303);
    assert.equal(replay.headers.get('location'), 'http://localhost/?auth=link-invalid');
    assert.equal(replayCalls, 0);
  });

  await t.test('invalid token-hash confirmation is one generic safe error', async () => {
    const jar = new Map();
    const csrfToken = await csrf(jar);
    globalThis.fetch = async (input) => {
      assert.match(String(input), /auth\/v1\/verify$/);
      return json({ message: 'token expired' }, 403);
    };
    const response = await request(jar, '/api/auth/confirm', {
      method: 'POST',
      headers: browserHeaders(csrfToken),
      body: JSON.stringify({ tokenHash: 'A'.repeat(32), type: 'recovery' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'AUTH_LINK_INVALID');
  });

  await t.test('password change signs out globally and never returns tokens', async () => {
    const jar = new Map([
      ['yzt_access', token.access_token],
      ['yzt_refresh', token.refresh_token],
      ['yzt_password_recovery', '1'],
    ]);
    const csrfToken = await csrf(jar);
    const calls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user') && (init.method ?? 'GET') === 'GET') return json(user);
      if (url.endsWith('/auth/v1/user') && init.method === 'PUT') {
        assert.equal(JSON.parse(String(init.body)).password, 'new-password-123');
        return json(user);
      }
      if (url.endsWith('/auth/v1/logout?scope=global')) return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await request(jar, '/api/auth/password', {
      method: 'PUT',
      headers: browserHeaders(csrfToken),
      body: JSON.stringify({ password: 'new-password-123' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, signedOut: true });
    assert.equal(jar.has('yzt_access'), false);
    assert.equal(jar.has('yzt_refresh'), false);
    assert.equal(jar.has('yzt_password_recovery'), false);
    assert.ok(calls.some((call) => call.url.endsWith('/auth/v1/logout?scope=global')));
  });

  await t.test('logout clears local cookies even when Auth is unavailable', async () => {
    const jar = new Map([
      ['yzt_access', token.access_token],
      ['yzt_refresh', token.refresh_token],
      ['yzt_business', '20000000-0000-4000-8000-000000000001'],
    ]);
    const csrfToken = await csrf(jar);
    globalThis.fetch = async () => { throw new Error('upstream unavailable'); };
    const response = await request(jar, '/api/auth/logout', {
      method: 'POST',
      headers: browserHeaders(csrfToken),
    });
    assert.equal(response.status, 200);
    assert.equal(jar.has('yzt_access'), false);
    assert.equal(jar.has('yzt_refresh'), false);
    assert.equal(jar.has('yzt_business'), false);
  });

  globalThis.fetch = realFetch;
});
