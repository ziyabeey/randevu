import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

// Run the actual smoke script against the real Worker router with an isolated
// Supabase fixture. This checks the harness contract, not hosted acceptance.
test('S02 staging smoke performs feature reads, negative guards and refresh without business writes', async () => {
  const env = { SUPABASE_URL: 'https://supabase.example.test', SUPABASE_ANON_KEY: 'test-key', COOKIE_SECURE: 'false', PUBLIC_APP_ORIGIN: 'http://localhost' };
  const user = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
  const business = { id: '20000000-0000-4000-8000-000000000001', name: 'Fixture', slug: 'fixture', timezone: 'Europe/Istanbul' };
  const member = { id: '30000000-0000-4000-8000-000000000001', business_id: business.id, role: 'owner', active: true, businesses: business };
  const claims = { sub: user.id, session_id: '40000000-0000-4000-8000-000000000001', amr: [{ method: 'password' }] };
  const access = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const previousEnv = Object.fromEntries(['STAGING_APP_ORIGIN', 'STAGING_OWNER_A_EMAIL', 'STAGING_OWNER_A_PASSWORD'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { STAGING_APP_ORIGIN: env.PUBLIC_APP_ORIGIN, STAGING_OWNER_A_EMAIL: user.email, STAGING_OWNER_A_PASSWORD: 'fixture-only-password' });
  const realFetch = globalThis.fetch;
  const observations = [];
  const unknown = [];
  let refreshes = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === env.PUBLIC_APP_ORIGIN) {
      const response = await app.request(url.toString(), init, env);
      observations.push([init.method ?? 'GET', url.pathname, response.status]);
      return response;
    }
    if (url.origin !== env.SUPABASE_URL) { unknown.push(url.origin); return json({}, 500); }
    const path = url.pathname;
    if (path === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') refreshes += 1;
      return json({ user, access_token: access, refresh_token: `fixture-refresh-${refreshes}`, expires_in: 3600 });
    }
    if (path === '/auth/v1/user') return json(user);
    if (path === '/rest/v1/memberships') return json([member]);
    if (path === '/rest/v1/businesses') return json([business]);
    if (path === '/rest/v1/public_booking_settings') return json([{ business_id: business.id, enabled: false }]);
    if (path === '/rest/v1/rpc/get_catalog_snapshot') {
      return json([{
        services: [{ id: business.id, name: 'Fixture', active: true }],
        staff: [{ id: business.id, name: 'Fixture', active: true }],
        assignments: [],
      }]);
    }
    if (path === '/rest/v1/rpc/get_business_onboarding_snapshot') {
      return json([{
        business,
        business_hours: [],
        staff_hours: [],
      }]);
    }
    if (path === '/rest/v1/services' || path === '/rest/v1/staff_profiles') return json([{ id: business.id, name: 'Fixture', active: true }]);
    if (['/rest/v1/staff_services', '/rest/v1/business_hours', '/rest/v1/staff_hours', '/rest/v1/availability_blocks', '/rest/v1/rpc/get_calendar_appointments', '/rest/v1/rpc/get_calendar_appointments_v2', '/rest/v1/rpc/list_appointments_page', '/rest/v1/rpc/list_business_customer_appointments_page_v2'].includes(path)) return json([]);
    unknown.push(path); return json({}, 500);
  };
  try {
    await import('../scripts/staging-smoke.mjs');
    assert.deepEqual(unknown, [], 'smoke must never call business-write RPCs');
    assert.equal(refreshes, 1);
    for (const path of ['/api/bookings', '/api/calendar', '/api/availability/setup', '/api/public/settings']) {
      assert.ok(observations.some(([method, seen, status]) => method === 'GET' && seen === path && status === 200));
    }
    assert.deepEqual(observations.filter(([method, path]) => method === 'PUT' && path === '/api/public/settings').map(([, , status]) => status), [403, 403, 403, 403, 403, 400]);
    assert.ok(observations.some(([method, path, status]) => method === 'POST' && path === '/api/manage/view' && status === 404));
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
