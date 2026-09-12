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

function accessToken(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: user.id,
    role: 'authenticated',
    session_id: '40000000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookieHeader(extra = '') {
  return [
    `yzt_access=${accessToken()}`,
    'yzt_refresh=refresh-token-one',
    `yzt_business=${businessId}`,
    extra,
  ].filter(Boolean).join('; ');
}

function setCookieValues(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function assertSessionCookiesPreserved(response) {
  const values = setCookieValues(response).join('\n');
  assert.doesNotMatch(values, /yzt_access=;.*max-age=0/i);
  assert.doesNotMatch(values, /yzt_refresh=;.*max-age=0/i);
  assert.doesNotMatch(values, /yzt_business=;.*max-age=0/i);
}

await test('S02 feature auth provider outage is retryable and preserves a valid session', async () => {
  const realFetch = globalThis.fetch;
  let userCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      userCalls += 1;
      return userCalls === 1 ? json(user) : json({ message: 'temporary outage' }, 503);
    }
    if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
      return json({ message: 'temporary outage' }, 503);
    }
    throw new Error(`unexpected provider-outage fetch: ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/calendar?date=2026-09-12&days=1', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error?.code, 'AUTH_UNAVAILABLE');
    assertSessionCookiesPreserved(response);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S02 feature membership outage is not misreported as a missing tenant', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return json(user);
    if (url.includes('/rest/v1/memberships?')) return json({ message: 'temporary outage' }, 503);
    throw new Error(`unexpected membership-outage fetch: ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/availability/setup', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error?.code, 'AUTH_UNAVAILABLE');
    assertSessionCookiesPreserved(response);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S02 missing browser provenance cannot bypass a cookie mutation guard', async () => {
  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return json({ message: 'must not reach Supabase' }, 401);
  };

  try {
    const response = await app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', password: 'correct-horse-battery-staple' }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'ORIGIN_FORBIDDEN');
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S02 feature mutations are guarded before auth or business work', async () => {
  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    upstreamCalls += 1;
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return json(user);
    if (url.includes('/rest/v1/memberships?')) return json([membership]);
    if (url.endsWith('/rest/v1/rpc/replace_business_hours')) return json([]);
    throw new Error(`unexpected feature-mutation fetch: ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/availability/business-hours/1', {
      method: 'PUT',
      headers: {
        Cookie: cookieHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ intervals: [{ start: '09:00', end: '17:00' }] }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'ORIGIN_FORBIDDEN');
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S02 capability mutations remain an explicit non-cookie exception', async () => {
  const realFetch = globalThis.fetch;
  const token = 'T'.repeat(48);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/get_public_managed_appointment')) {
      return json([{
        appointment_id: '50000000-0000-4000-8000-000000000001',
        business_name: 'Test Salon',
        status: 'confirmed',
        starts_at: '2026-09-13T09:00:00.000Z',
        ends_at: '2026-09-13T10:00:00.000Z',
        timezone: 'Europe/Istanbul',
        service_name: 'Kesim',
        staff_name: 'Ada',
        price_minor: 10000,
        currency: 'TRY',
      }]);
    }
    throw new Error(`unexpected capability fetch: ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/manage/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).appointment?.business_name, 'Test Salon');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S02 unknown unsafe API routes fail closed instead of inheriting an exception', async () => {
  const response = await app.request('http://localhost/api/unknown-mutation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: true }),
  }, env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error?.code, 'ORIGIN_FORBIDDEN');
});
