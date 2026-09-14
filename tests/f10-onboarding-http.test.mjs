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

const user = { id: 'b1000000-0000-4000-8000-000000000001', email: 'setup-owner@example.test' };
const businessId = 'b2000000-0000-4000-8000-000000000001';
const forgedBusinessId = 'b2000000-0000-4000-8000-000000000099';
const membershipId = 'b3000000-0000-4000-8000-000000000001';
const csrfValue = 'C'.repeat(43);

function membership(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}

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
    session_id: 'b4000000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookieHeader({ business = businessId, recovery = false } = {}) {
  return [
    `yzt_access=${accessToken(recovery ? 'recovery' : 'password')}`,
    'yzt_refresh=f10-onboarding-refresh',
    business ? `yzt_business=${business}` : '',
    `yzt_csrf=${csrfValue}`,
  ].filter(Boolean).join('; ');
}

function mutationHeaders(options) {
  return {
    Origin: 'http://localhost',
    Cookie: cookieHeader(options),
    'X-YZT-CSRF': csrfValue,
    'Content-Type': 'application/json',
  };
}

function setCookieValues(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function onboardingResponse(pathname) {
  if (pathname === '/rest/v1/businesses') {
    return json([{ id: businessId, name: 'Setup Studio', slug: 'setup-studio', timezone: 'Europe/Istanbul' }]);
  }
  if (pathname === '/rest/v1/services') {
    return json([{ id: 'service-a', name: 'Kesim', active: true, duration_minutes: 30, price_minor: 10000, currency: 'TRY' }]);
  }
  if (pathname === '/rest/v1/staff_profiles') {
    return json([{ id: 'staff-a', membership_id: membershipId, name: 'Owner', active: true }]);
  }
  if (pathname === '/rest/v1/staff_services') return json([{ staff_id: 'staff-a', service_id: 'service-a', active: true }]);
  if (pathname === '/rest/v1/business_hours') return json([{ id: 'bh-a', weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00', active: true }]);
  if (pathname === '/rest/v1/staff_hours') return json([{ id: 'sh-a', staff_id: 'staff-a', weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00', active: true }]);
  if (pathname === '/rest/v1/public_booking_settings') return json([{ business_id: businessId, enabled: false, step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 }]);
  if (pathname === '/rest/v1/rpc/get_business_onboarding_readiness') {
    return json([{
      business_id: businessId,
      has_active_service: true,
      has_active_staff: true,
      has_active_assignment: true,
      has_business_hours: true,
      has_staff_hours: true,
      has_overlapping_hours: true,
      publishable: true,
      missing_reasons: [],
    }]);
  }
  throw new Error(`unexpected onboarding path: ${pathname}`);
}

await test('F10-03 onboarding snapshot derives every business read from selected Membership authority', async () => {
  const realFetch = globalThis.fetch;
  const businessScopedQueries = [];
  let readinessBody;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') {
      assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
      assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
      return json([membership()]);
    }
    if (url.pathname === '/rest/v1/rpc/get_business_onboarding_readiness') {
      readinessBody = JSON.parse(init.body);
    } else if (url.pathname.startsWith('/rest/v1/')) {
      const queryBusiness = url.searchParams.get('business_id') ?? (url.pathname === '/rest/v1/businesses' ? url.searchParams.get('id') : null);
      if (queryBusiness) businessScopedQueries.push(queryBusiness);
    }
    return onboardingResponse(url.pathname);
  };
  try {
    const response = await app.request('http://localhost/api/onboarding?businessId=b2000000-0000-4000-8000-000000000099', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.membership.business_id, businessId);
    assert.equal(payload.business.id, businessId);
    assert.equal(payload.readiness.business_id, businessId);
    assert.deepEqual(readinessBody, { p_business_id: businessId });
    assert.ok(businessScopedQueries.length >= 7);
    assert.ok(businessScopedQueries.every((value) => value === `eq.${businessId}`));
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(forgedBusinessId));
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-03 recovery session cannot read onboarding setup', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    throw new Error(`recovery unexpectedly reached membership or setup data: ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/onboarding', {
      headers: { Cookie: cookieHeader({ recovery: true }) },
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.deepEqual(calls, ['/auth/v1/user']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-03 onboarding preserves transient upstream failure as 503 instead of tenant loss', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    if (url.pathname === '/rest/v1/services') return json({ message: 'temporary failure' }, 503);
    return onboardingResponse(url.pathname, init);
  };
  try {
    const response = await app.request('http://localhost/api/onboarding', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error?.code, 'ONBOARDING_UNAVAILABLE');
    assert.doesNotMatch(setCookieValues(response).join('\n'), /yzt_business=;.*max-age=0/i);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-03 forged business selection remains 403 and never replaces the selected cookie', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    assert.equal(url.pathname, '/rest/v1/memberships');
    assert.equal(url.searchParams.get('business_id'), `eq.${forgedBusinessId}`);
    assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
    return json([]);
  };
  try {
    const response = await app.request('http://localhost/api/businesses/select', {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ businessId: forgedBusinessId }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'TENANT_FORBIDDEN');
    assert.doesNotMatch(setCookieValues(response).join('\n'), new RegExp(`yzt_business=${forgedBusinessId}`));
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-03 incomplete direct publish maps the DB readiness guard to deterministic 409', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/update_public_booking_settings');
    rpcBody = JSON.parse(init.body);
    return json({ message: 'PUBLIC_BOOKING_NOT_READY', details: 'SERVICE_REQUIRED' }, 400);
  };
  try {
    const response = await app.request('http://localhost/api/public/settings', {
      method: 'PUT',
      headers: mutationHeaders(),
      body: JSON.stringify({ enabled: true, stepMinutes: 15, minNoticeMinutes: 60, horizonDays: 60 }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'PUBLIC_BOOKING_NOT_READY');
    assert.equal(rpcBody.p_business_id, businessId);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10-03 public settings mutation preserves DB recovery rejection as password-update 403', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/update_public_booking_settings');
    return json({ message: 'PASSWORD_UPDATE_REQUIRED' }, 403);
  };
  try {
    const response = await app.request('http://localhost/api/public/settings', {
      method: 'PUT',
      headers: mutationHeaders({ recovery: true }),
      body: JSON.stringify({ enabled: false, stepMinutes: 15, minNoticeMinutes: 60, horizonDays: 60 }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PASSWORD_UPDATE_REQUIRED');
  } finally { globalThis.fetch = realFetch; }
});
