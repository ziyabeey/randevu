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
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) {
      return json({ message: 'temporary outage' }, 503);
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
    assert.deepEqual(calls, [`${env.SUPABASE_URL}/auth/v1/user`]);
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
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      return json({ ok: true, data: [{
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
      }] });
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

const memberReads = ['/api/catalog', '/api/calendar', '/api/availability/setup', '/api/bookings', '/api/customers', '/api/public/settings', '/api/team'];

await test('S02 every member surface shares auth, refresh and membership failure semantics', async (t) => {
  const cases = [
    ['user 503', 503, 'AUTH_UNAVAILABLE', ['user']],
    ['user network', 503, 'AUTH_UNAVAILABLE', ['user']],
    ['refresh 503', 503, 'AUTH_UNAVAILABLE', ['user', 'refresh']],
    ['refresh network', 503, 'AUTH_UNAVAILABLE', ['user', 'refresh']],
    ['invalid session', 401, 'AUTH_REQUIRED', ['user', 'refresh']],
    ['membership 503', 503, 'AUTH_UNAVAILABLE', ['user', 'membership']],
    ['membership network', 503, 'AUTH_UNAVAILABLE', ['user', 'membership']],
    ['revoked membership', 403, 'TENANT_REQUIRED', ['user', 'membership']],
    ['recovery', 403, 'PASSWORD_UPDATE_REQUIRED', ['user']],
  ];
  for (const path of memberReads) for (const [mode, status, code, expectedCalls] of cases) {
    await t.test(`${path}: ${mode}`, async () => {
      const realFetch = globalThis.fetch;
      const calls = [];
      const unexpected = [];
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/auth/v1/user')) {
          calls.push('user');
          if (mode === 'user network') throw new TypeError('network unavailable');
          if (mode === 'user 503') return json({}, 503);
          if (mode.startsWith('refresh') || mode === 'invalid session') return json({}, 401);
          return json(user);
        }
        if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
          calls.push('refresh');
          if (mode === 'refresh network') throw new TypeError('network unavailable');
          return json({}, mode === 'refresh 503' ? 503 : 400);
        }
        if (url.includes('/rest/v1/memberships?')) {
          calls.push('membership');
          if (mode === 'membership network') throw new TypeError('network unavailable');
          return mode === 'membership 503' ? json({}, 503) : json([]);
        }
        unexpected.push(url);
        return json({}, 500);
      };
      try {
        const cookie = mode === 'recovery'
          ? cookieHeader().replace(accessToken(), accessToken('recovery')) : cookieHeader();
        const response = await app.request(`http://localhost${path}`, { headers: { Cookie: cookie } }, env);
        assert.equal(response.status, status);
        assert.equal((await response.json()).error?.code, code);
        assert.deepEqual(calls, expectedCalls);
        assert.deepEqual(unexpected, []);
        const values = setCookieValues(response).join('\n');
        if (status === 503 || mode === 'recovery') assertSessionCookiesPreserved(response);
        if (status === 401) {
          assert.match(values, /yzt_access=;.*max-age=0/i);
          assert.match(values, /yzt_refresh=;.*max-age=0/i);
        }
        if (mode === 'revoked membership') {
          assert.match(values, /yzt_business=;.*max-age=0/i);
          assert.doesNotMatch(values, /yzt_(access|refresh)=;.*max-age=0/i);
        }
      } finally { globalThis.fetch = realFetch; }
    });
  }
});

await test('S02 refresh rotation happens once and refreshed authority reaches the booking read', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const rotated = accessToken();
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/auth/v1/user') return json({}, 401);
    if (path === '/auth/v1/token') return json({ access_token: rotated, refresh_token: 'rotated-refresh', user });
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${rotated}`);
    if (path === '/rest/v1/memberships') return json([membership]);
    return json([]);
  };
  try {
    const response = await app.request('http://localhost/api/bookings', { headers: { Cookie: cookieHeader() } }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['/auth/v1/user', '/auth/v1/token', '/rest/v1/memberships', '/rest/v1/rpc/list_appointments_page_v3']);
    assert.match(setCookieValues(response).join('\n'), /yzt_refresh=rotated-refresh/);
    assert.deepEqual((await response.json()).appointments, []);
  } finally { globalThis.fetch = realFetch; }
});

const cookieMutations = [
  ['POST', '/api/auth/signup'], ['POST', '/api/auth/login'], ['POST', '/api/auth/logout'],
  ['POST', '/api/auth/recovery'], ['POST', '/api/auth/confirm'], ['PUT', '/api/auth/password'],
  ['POST', '/api/businesses'], ['POST', '/api/businesses/select'],
  ['POST', '/api/services'], ['PATCH', '/api/services/:id'],
  ['POST', '/api/staff'], ['PATCH', '/api/staff/:id'], ['PUT', '/api/staff/:staffId/services/:serviceId'],
  ['POST', '/api/bookings'], ['POST', '/api/bookings/groups'],
  ['POST', '/api/bookings/groups/:groupId/reschedule'], ['POST', '/api/bookings/groups/:groupId/status'], ['POST', '/api/bookings/groups/:groupId/cancel'],
  ['POST', '/api/bookings/groups/:groupId/lines/:lineId/cancel'],
  ['POST', '/api/bookings/groups/:groupId/lines/:lineId/service'],
  ['POST', '/api/bookings/groups/:groupId/lines/:lineId/reschedule'],
  ['POST', '/api/bookings/:id/reschedule'], ['POST', '/api/bookings/:id/status'],
  ['POST', '/api/customers'], ['PATCH', '/api/customers/:id'],
  ['PUT', '/api/availability/business-hours/:weekday'], ['PUT', '/api/availability/staff/:staffId/hours/:weekday'],
  ['POST', '/api/availability/blocks'], ['DELETE', '/api/availability/blocks/:id'],
  ['POST', '/api/availability/group-slots'],
  ['PUT', '/api/public/settings'],
  ['PUT', '/api/public/profile'], ['PUT', '/api/public/profile/information'], ['POST', '/api/public/profile/media'],
  ['POST', '/api/public/profile/media/cleanup'], ['DELETE', '/api/public/profile/media/:mediaId'],
  ['POST', '/api/team/invitations'], ['POST', '/api/team/invitations/accept'], ['POST', '/api/team/invitations/:id/revoke'],
  ['PATCH', '/api/team/members/:id'], ['PUT', '/api/team/staff/:staffId/membership'],
  ['PUT', '/api/team/members/:id/financial-permissions/:permission'],
  ['POST', '/api/tickets/from-booking-group'],
  ['POST', '/api/tickets'],
  ['POST', '/api/tickets/:id/service-lines'],
  ['POST', '/api/tickets/:id/lines/:lineId/finalize-price'],
  ['PUT', '/api/tickets/:id/lines/:lineId/discount'],
  ['POST', '/api/tickets/:id/close'],
  ['POST', '/api/tickets/:id/cancel'],
  ['POST', '/api/tickets/:id/payments'],
  ['POST', '/api/tickets/:id/payments/:paymentId/corrections'],
  ['POST', '/api/tickets/:id/payments/:paymentId/refunds'],
  ['POST', '/api/tickets/product-sales'],
  ['POST', '/api/tickets/:id/product-lines'],
  ['POST', '/api/tickets/:id/lines/:lineId/product-return-refund'],
  ['POST', '/api/products'],
  ['PUT', '/api/products/:id'],
  ['POST', '/api/products/:id/archive'],
  ['POST', '/api/products/:id/stock-movements'],
  ['POST', '/api/products/:id/stock-movements/:movementId/reverse'],
  ['POST', '/api/expenses'],
  ['POST', '/api/expenses/:id/reverse'],
  ['POST', '/api/expenses/:id/correct'],
  ['POST', '/api/bookings/series/preview'],
  ['POST', '/api/bookings/series'],
  ['POST', '/api/bookings/series/:seriesId/future/preview'],
  ['POST', '/api/bookings/series/:seriesId/future/reschedule'],
  ['POST', '/api/bookings/series/:seriesId/future/cancel'],
  ['POST', '/api/bookings/groups/:groupId/photos'],
  ['POST', '/api/private-media/cleanup'],
  ['DELETE', '/api/private-media/:mediaId'],
  ['POST', '/api/private-media/:mediaId/publish'],
  ['POST', '/api/service-packages'],
  ['PATCH', '/api/service-packages/:id'],
  ['POST', '/api/tickets/package-sales'],
  ['POST', '/api/tickets/:id/package-lines'],
  ['POST', '/api/tickets/:id/lines/:lineId/package-usage'],
  ['POST', '/api/tickets/:id/lines/:lineId/package-usage/reverse'],
  ['POST', '/api/customer-packages/:id/refund'],
  ['POST', '/api/promo-codes'],
  ['PATCH', '/api/promo-codes/:id'],
  ['POST', '/api/tickets/:id/promo'],
  ['POST', '/api/tickets/:id/promo/remove'],
  ['POST', '/api/feedback/:feedbackId/moderate'],
  ['POST', '/api/commission-rates/:staffId'],
  ['POST', '/api/commission-rates/:staffId/services/:serviceId'],
];
const exceptions = [
  '/api/public/business/:slug/book',
  '/api/public/business/:slug/group-slots',
  '/api/public/business/:slug/group-book',
  '/api/public/verify/whatsapp/start', '/api/public/verify/whatsapp/check',
  '/api/public/booking/recover', '/api/public/booking/resolve',
  '/api/manage/view', '/api/manage/slots', '/api/manage/reschedule', '/api/manage/cancel',
  '/api/manage/feedback/view', '/api/manage/feedback',
  '/api/manage/promo/view', '/api/manage/promo',
];
const concrete = (path) => path.replace(':weekday', '1').replace(':slug', 'test-salon').replace(/:[A-Za-z]+/g, businessId);
const csrfValue = 'C'.repeat(43);

await test('S02 route inventory covers every mounted unsafe handler', () => {
  const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const actual = app.routes.filter((route) => unsafe.has(route.method)).map((route) => `${route.method} ${route.path.replace(/\/$/, '')}`);
  const expected = [...cookieMutations, ...exceptions.map((path) => ['POST', path])].map(([method, path]) => `${method} ${path}`);
  assert.deepEqual([...new Set(actual)].sort(), expected.sort());
});

await test('S02 every cookie mutation rejects invalid provenance or CSRF before any upstream work', async (t) => {
  const variants = [
    ['missing origin and fetch metadata', {}, 'ORIGIN_FORBIDDEN'],
    ['missing origin with fetch metadata', { 'Sec-Fetch-Site': 'same-origin' }, 'ORIGIN_FORBIDDEN'],
    ['wrong origin', { Origin: 'https://attacker.example' }, 'ORIGIN_FORBIDDEN'],
    ['cross site', { Origin: 'http://localhost', 'Sec-Fetch-Site': 'cross-site' }, 'ORIGIN_FORBIDDEN'],
    ['missing CSRF', { Origin: 'http://localhost' }, 'CSRF_INVALID'],
    ['wrong CSRF', { Origin: 'http://localhost', 'X-YZT-CSRF': 'X'.repeat(43) }, 'CSRF_INVALID'],
  ];
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return json({}, 500); };
  try {
    for (const [method, path] of cookieMutations) for (const [name, headers, code] of variants) {
      await t.test(`${method} ${path}: ${name}`, async () => {
        const response = await app.request(`http://localhost${concrete(path)}`, {
          method, headers: { Cookie: cookieHeader(`yzt_csrf=${csrfValue}`), 'Content-Type': 'application/json', ...headers }, body: '{}',
        }, env);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error?.code, code);
        assert.equal(calls, 0);
      });
    }
  } finally { globalThis.fetch = realFetch; }
});

await test('S02 public and capability exceptions require exact POST and path, and still validate their proof', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return json({}, 500); };
  try {
    for (const route of exceptions) {
      const path = concrete(route);
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const response = await app.request(`http://localhost${path}`, { method, body: '{}' }, env);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error?.code, 'ORIGIN_FORBIDDEN');
      }
      for (const suffix of ['/extra', '-other']) {
        const response = await app.request(`http://localhost${path}${suffix}`, { method: 'POST', body: '{}' }, env);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error?.code, 'ORIGIN_FORBIDDEN');
      }
      const response = await app.request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env);
      assert.ok(response.status >= 400, 'missing capability/proof is not accepted');
      const code = (await response.json()).error?.code;
      assert.ok(code && code !== 'ORIGIN_FORBIDDEN' && code !== 'CSRF_INVALID');
    }
    assert.equal(calls, 0, 'invalid public/capability proof rejected before RPC');
  } finally { globalThis.fetch = realFetch; }
});

await test('S02 legitimate cookie mutation works with exact Origin and matching CSRF, without requiring fetch metadata', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/auth/v1/user') return json(user);
    if (path === '/rest/v1/memberships') return json([membership]);
    assert.equal(path, '/rest/v1/rpc/replace_business_hours_guarded');
    const body = JSON.parse(init.body);
    assert.equal(body.p_business_id, businessId);
    assert.deepEqual(body.p_expected_intervals, []);
    return json([]);
  };
  try {
    const response = await app.request('http://localhost/api/availability/business-hours/1', {
      method: 'PUT', headers: { Origin: 'http://localhost', Cookie: cookieHeader(`yzt_csrf=${csrfValue}`), 'X-YZT-CSRF': csrfValue, 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervals: [{ start: '09:00', end: '17:00' }], expectedIntervals: [] }),
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships', '/rest/v1/rpc/replace_business_hours_guarded']);
  } finally { globalThis.fetch = realFetch; }
});

await test('S02 safe methods do not require mutation provenance', async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const response = await app.request('http://localhost/api/health', { method }, env);
    assert.notEqual(response.status, 403);
  }
});

await test('S02 business selection preserves the current business during membership provider outage', async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const network of [false, true]) {
      const calls = [];
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        if (path === '/auth/v1/user') return json(user);
        if (network) throw new TypeError('network unavailable');
        return json({}, 503);
      };
      const response = await app.request('http://localhost/api/businesses/select', {
        method: 'POST', headers: { Origin: 'http://localhost', Cookie: cookieHeader(`yzt_csrf=${csrfValue}`), 'X-YZT-CSRF': csrfValue, 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      }, env);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error?.code, 'AUTH_UNAVAILABLE');
      assertSessionCookiesPreserved(response);
      assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships']);
    }
  } finally { globalThis.fetch = realFetch; }
});

await test('S02 business selection still rejects non-members and changes only to an authorized business', async () => {
  const realFetch = globalThis.fetch;
  const targetBusinessId = '20000000-0000-4000-8000-000000000002';
  try {
    for (const allowed of [false, true]) {
      const queries = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/auth/v1/user') return json(user);
        queries.push(url);
        return json(allowed ? [{ ...membership, business_id: targetBusinessId }] : []);
      };
      const response = await app.request('http://localhost/api/businesses/select', {
        method: 'POST', headers: { Origin: 'http://localhost', Cookie: cookieHeader(`yzt_csrf=${csrfValue}`), 'X-YZT-CSRF': csrfValue, 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: targetBusinessId }),
      }, env);
      assert.equal(queries.length, 1);
      assert.equal(queries[0].searchParams.get('business_id'), `eq.${targetBusinessId}`);
      assert.equal(queries[0].searchParams.get('user_id'), `eq.${user.id}`);
      assert.equal(queries[0].searchParams.get('active'), 'eq.true');
      const cookies = setCookieValues(response).join('\n');
      if (allowed) {
        assert.equal(response.status, 200);
        assert.match(cookies, new RegExp(`yzt_business=${targetBusinessId}`));
      } else {
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error?.code, 'TENANT_FORBIDDEN');
        assert.doesNotMatch(cookies, /yzt_business=/);
      }
    }
  } finally { globalThis.fetch = realFetch; }
});
