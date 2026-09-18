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

const user = { id: 'fa000000-0000-4000-8000-000000000001', email: 'workspace-owner@example.test' };
const businessA = 'fa100000-0000-4000-8000-000000000001';
const businessB = 'fa100000-0000-4000-8000-000000000002';
const csrf = 'C'.repeat(43);

function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: user.id,
    role: 'authenticated',
    session_id: 'fa200000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function headers(cookieBusiness, expectedBusiness) {
  return {
    Origin: 'http://localhost',
    'Content-Type': 'application/json',
    'X-YZT-CSRF': csrf,
    'X-YZT-Expected-User': user.id,
    'X-YZT-Expected-Business': expectedBusiness,
    Cookie: [
      `yzt_access=${accessToken()}`,
      'yzt_refresh=workspace-refresh',
      `yzt_business=${cookieBusiness}`,
      `yzt_csrf=${csrf}`,
    ].join('; '),
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

await test('Worker rejects a stale-tab mutation when expected business and request cookie diverge', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    throw new Error(`workspace assertion leaked past auth: ${url.pathname}`);
  };
  try {
    const response = await app.request('http://localhost/api/team/invitations', {
      method: 'POST',
      headers: headers(businessB, businessA),
      body: JSON.stringify({ email: 'x@example.test', role: 'staff' }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'WORKSPACE_CONTEXT_CHANGED');
    assert.deepEqual(calls, ['/auth/v1/user']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('authenticated /api/public operator mutations use the same authoritative workspace assertion', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    throw new Error(`public settings mutation escaped workspace assertion: ${url.pathname}`);
  };
  try {
    const response = await app.request('http://localhost/api/public/settings', {
      method: 'PUT',
      headers: headers(businessB, businessA),
      body: '{}',
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'WORKSPACE_CONTEXT_CHANGED');
  } finally {
    globalThis.fetch = realFetch;
  }
});
