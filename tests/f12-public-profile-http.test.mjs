import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { webpDimensions } from '../worker/public-profile.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
};
const user = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const businessId = '20000000-0000-4000-8000-000000000001';
const ownerMembership = { id: '30000000-0000-4000-8000-000000000001', business_id: businessId, role: 'owner', active: true };
const staffMembership = { ...ownerMembership, role: 'staff' };
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: '40000000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function cookies() {
  return `yzt_access=${accessToken()}; yzt_refresh=refresh-token; yzt_business=${businessId}; yzt_csrf=${csrf}`;
}
function publicProfile() {
  return {
    public_name: 'Test Salon', short_description: 'Kısa açıklama', long_description: null,
    public_phone: null, public_email: null, public_website: null, public_whatsapp: null,
    address_text: null, show_work_hours: true, cover_media_id: null, work_hours: [], media: [],
  };
}

await test('F12 public profile consumes only the guarded public operation and returns sanitized data', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    assert.equal(url.pathname, '/rest/v1/rpc/execute_public_operation');
    const body = JSON.parse(init.body);
    assert.equal(body.p_action, 'profile');
    assert.deepEqual(body.p_args, { p_slug: 'test-salon' });
    return json({ ok: true, data: [publicProfile()] });
  };
  try {
    const response = await app.request('http://localhost/api/public/business/test-salon/profile', {}, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).profile.public_name, 'Test Salon');
    assert.deepEqual(seen, ['/rest/v1/rpc/execute_public_operation']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12 disabled or stale-readiness public profile is indistinguishable from an inactive link', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ ok: true, data: [] });
  try {
    const response = await app.request('http://localhost/api/public/business/test-salon/profile', {}, env);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error?.code, 'PUBLIC_BOOKING_NOT_FOUND');
  } finally { globalThis.fetch = realFetch; }
});

await test('F12 authenticated profile read stays on the active membership business', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([ownerMembership]);
    if (url.pathname === '/rest/v1/rpc/get_business_public_profile') {
      assert.equal(JSON.parse(init.body).p_business_id, businessId);
      return json([{ business_id: businessId, ...publicProfile() }]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/public/profile', { headers: { Cookie: cookies() } }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).profile.business_id, businessId);
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships', '/rest/v1/rpc/get_business_public_profile']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12 staff cannot mutate public profile and no profile RPC is attempted', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([staffMembership]);
    throw new Error(`unexpected privileged fetch ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/public/profile', {
      method: 'PUT',
      headers: { Origin: 'http://localhost', Cookie: cookies(), 'X-YZT-CSRF': csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicName: 'Kaçak' }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'NOT_ALLOWED');
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12 upload rejects fake WebP content before metadata or Storage writes', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([ownerMembership]);
    throw new Error(`unexpected upload fetch ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/public/profile/media', {
      method: 'POST',
      headers: { Origin: 'http://localhost', Cookie: cookies(), 'X-YZT-CSRF': csrf, 'Content-Type': 'image/webp' },
      body: new Uint8Array([1, 2, 3, 4]),
    }, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error?.code, 'INVALID_PUBLIC_MEDIA');
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12 WebP parser accepts bounded VP8X dimensions and rejects non-WebP bytes', () => {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from('VP8X'), 12);
  bytes[16] = 10;
  bytes[24] = 0xff; bytes[25] = 0x03; bytes[26] = 0x00;
  bytes[27] = 0x57; bytes[28] = 0x02; bytes[29] = 0x00;
  assert.deepEqual(webpDimensions(bytes), { width: 1024, height: 600 });
  assert.equal(webpDimensions(new Uint8Array([1, 2, 3, 4])), null);
});
