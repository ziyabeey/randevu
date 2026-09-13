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

function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: user.id,
    role: 'authenticated',
    session_id: '40000000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookieHeader(withBusiness = true) {
  return [
    `yzt_access=${accessToken()}`,
    'yzt_refresh=refresh-token-one',
    withBusiness ? `yzt_business=${businessId}` : '',
  ].filter(Boolean).join('; ');
}

function authenticatedBaseFetch(url) {
  if (url.endsWith('/auth/v1/user')) return json(user);
  if (url.includes('/rest/v1/memberships?')) return json([membership]);
  return null;
}

await test('S07 C2b session probes 101 memberships and fails instead of returning a partial snapshot', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return json(user);
    if (url.includes('/rest/v1/memberships?')) {
      return json(Array.from({ length: 101 }, () => ({
        ...membership,
        businesses: { id: businessId, name: 'Salon', slug: 'salon', timezone: 'Europe/Istanbul' },
      })));
    }
    throw new Error(`unexpected session fetch ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/session', {
      headers: { Cookie: cookieHeader(false) },
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'MEMBERSHIP_LIMIT_EXCEEDED');
    assert.ok(calls.some((url) => url.includes('/rest/v1/memberships?') && url.includes('limit=101')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S07 C2b catalog accepts exact ceilings with explicit max+1 probes', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const auth = authenticatedBaseFetch(url);
    if (auth) return auth;
    if (url.includes('/rest/v1/services?')) return json(Array.from({ length: 100 }, (_, i) => ({ id: `service-${i}` })));
    if (url.includes('/rest/v1/staff_profiles?')) return json(Array.from({ length: 100 }, (_, i) => ({ id: `staff-${i}` })));
    if (url.includes('/rest/v1/staff_services?')) return json(Array.from({ length: 5000 }, () => ({})));
    throw new Error(`unexpected catalog fetch ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/catalog', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.services.length, 100);
    assert.equal(body.staff.length, 100);
    assert.equal(body.assignments.length, 5000);
    assert.ok(calls.some((url) => url.includes('/rest/v1/services?') && url.includes('limit=101')));
    assert.ok(calls.some((url) => url.includes('/rest/v1/staff_profiles?') && url.includes('limit=101')));
    assert.ok(calls.some((url) => url.includes('/rest/v1/staff_services?') && url.includes('limit=5001')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S07 C2b catalog rejects service and assignment overflow without a partial success', async (t) => {
  await t.test('101 services', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      const auth = authenticatedBaseFetch(url);
      if (auth) return auth;
      if (url.includes('/rest/v1/services?')) return json(Array.from({ length: 101 }, () => ({})));
      if (url.includes('/rest/v1/staff_profiles?')) return json([]);
      if (url.includes('/rest/v1/staff_services?')) return json([]);
      throw new Error(`unexpected service-overflow fetch ${url}`);
    };
    try {
      const response = await app.request('http://localhost/api/catalog', {
        headers: { Cookie: cookieHeader() },
      }, env);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error?.code, 'CATALOG_SERVICES_LIMIT_EXCEEDED');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await t.test('5001 assignments', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      const auth = authenticatedBaseFetch(url);
      if (auth) return auth;
      if (url.includes('/rest/v1/services?')) return json([]);
      if (url.includes('/rest/v1/staff_profiles?')) return json([]);
      if (url.includes('/rest/v1/staff_services?')) return json(Array.from({ length: 5001 }, () => ({})));
      throw new Error(`unexpected assignment-overflow fetch ${url}`);
    };
    try {
      const response = await app.request('http://localhost/api/catalog', {
        headers: { Cookie: cookieHeader() },
      }, env);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error?.code, 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

await test('S07 C2b calendar staff probe fails before appointment RPC when 101st staff exists', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const auth = authenticatedBaseFetch(url);
    if (auth) return auth;
    if (url.includes('/rest/v1/businesses?')) {
      return json([{ id: businessId, name: 'Salon', timezone: 'Europe/Istanbul' }]);
    }
    if (url.includes('/rest/v1/staff_profiles?')) {
      return json(Array.from({ length: 101 }, (_, i) => ({ id: `staff-${i}`, name: `Staff ${i}`, active: true })));
    }
    if (url.endsWith('/rest/v1/rpc/get_calendar_appointments')) {
      throw new Error('calendar appointments RPC must not run after staff overflow');
    }
    throw new Error(`unexpected calendar fetch ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/calendar?date=2026-09-13&days=1', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'CALENDAR_STAFF_LIMIT_EXCEEDED');
    assert.ok(calls.some((url) => url.includes('/rest/v1/staff_profiles?') && url.includes('limit=101')));
    assert.equal(calls.some((url) => url.endsWith('/rest/v1/rpc/get_calendar_appointments')), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S07 C2b public service and staff overflow codes survive the gated RPC boundary', async (t) => {
  await t.test('services', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (!url.endsWith('/rest/v1/rpc/execute_public_operation')) {
        throw new Error(`unexpected public-services fetch ${url}`);
      }
      const body = JSON.parse(String(init.body));
      if (body.p_action === 'business') {
        return json({ ok: true, data: [{
          name: 'Salon', slug: 'salon', timezone: 'Europe/Istanbul',
          local_date: '2026-09-13', max_date: '2026-10-13',
          step_minutes: 15, min_notice_minutes: 0, horizon_days: 30,
        }] });
      }
      if (body.p_action === 'services') {
        return json({ ok: false, error: { message: 'PUBLIC_SERVICES_LIMIT_EXCEEDED' } });
      }
      throw new Error(`unexpected public action ${body.p_action}`);
    };
    try {
      const response = await app.request('http://localhost/api/public/business/salon', {}, env);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error?.code, 'PUBLIC_SERVICES_LIMIT_EXCEEDED');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await t.test('staff', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (!url.endsWith('/rest/v1/rpc/execute_public_operation')) {
        throw new Error(`unexpected public-staff fetch ${url}`);
      }
      const body = JSON.parse(String(init.body));
      if (body.p_action === 'staff') {
        return json({ ok: false, error: { message: 'PUBLIC_STAFF_LIMIT_EXCEEDED' } });
      }
      throw new Error(`unexpected public action ${body.p_action}`);
    };
    try {
      const response = await app.request(
        'http://localhost/api/public/business/salon/staff?serviceId=50000000-0000-4000-8000-000000000001',
        {},
        env,
      );
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error?.code, 'PUBLIC_STAFF_LIMIT_EXCEEDED');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
