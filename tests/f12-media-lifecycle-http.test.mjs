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
const user = { id: 'd1000000-0000-4000-8000-000000000001', email: 'f12-lifecycle@example.test' };
const businessId = 'd2000000-0000-4000-8000-000000000001';
const membership = { id: 'd3000000-0000-4000-8000-000000000001', business_id: businessId, role: 'owner', active: true };
const staleMediaId = 'd4000000-0000-4000-8000-000000000001';
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: 'd5000000-0000-4000-8000-000000000001',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function cookies() {
  return `yzt_access=${accessToken()}; yzt_refresh=refresh-token; yzt_business=${businessId}; yzt_csrf=${csrf}`;
}
function mutationHeaders(contentType = 'application/json') {
  return { Origin: 'http://localhost', Cookie: cookies(), 'X-YZT-CSRF': csrf, 'Content-Type': contentType };
}
function validWebp() {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from('VP8X'), 12);
  bytes[16] = 10;
  bytes[24] = 0x1f; bytes[25] = 0x03; bytes[26] = 0x00; // 800px
  bytes[27] = 0x57; bytes[28] = 0x02; bytes[29] = 0x00; // 600px
  return bytes;
}

await test('F12 cleanup endpoint treats an already-absent stale Storage object as terminal success', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const stalePath = `${businessId}/${staleMediaId}.webp`;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership]);
    if (url.pathname === '/rest/v1/rpc/list_business_public_media_cleanup') {
      calls.push('claim');
      assert.equal(JSON.parse(init.body).p_business_id, businessId);
      return json([{ id: staleMediaId, storage_path: stalePath }]);
    }
    if (url.pathname.includes('/storage/v1/object/salon-public-media/') && method === 'DELETE') {
      calls.push('delete-404');
      assert.ok(decodeURIComponent(url.pathname).endsWith(stalePath));
      return new Response(null, { status: 404 });
    }
    if (url.pathname === '/rest/v1/rpc/finish_business_public_media_delete') {
      calls.push('finish');
      const body = JSON.parse(init.body);
      assert.equal(body.p_business_id, businessId);
      assert.equal(body.p_media_id, staleMediaId);
      return json(true);
    }
    throw new Error(`unexpected lifecycle cleanup fetch ${method} ${url.pathname}`);
  };

  try {
    const response = await app.request('http://localhost/api/public/profile/media/cleanup', {
      method: 'POST', headers: mutationHeaders(), body: '{}',
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cleaned: 1 });
    assert.deepEqual(calls, ['claim', 'delete-404', 'finish']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F12 upload retry reclaims stale media before reserving a new quota slot', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const stalePath = `${businessId}/${staleMediaId}.webp`;
  let newMediaId = '';
  let newPath = '';

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership]);
    if (url.pathname === '/rest/v1/rpc/list_business_public_media_cleanup') {
      calls.push('claim');
      return json([{ id: staleMediaId, storage_path: stalePath }]);
    }
    if (url.pathname.includes('/storage/v1/object/salon-public-media/') && method === 'DELETE') {
      calls.push('delete-404');
      return new Response(null, { status: 404 });
    }
    if (url.pathname === '/rest/v1/rpc/finish_business_public_media_delete') {
      calls.push('finish');
      return json(true);
    }
    if (url.pathname === '/rest/v1/rpc/begin_business_public_media_upload') {
      calls.push('begin');
      const body = JSON.parse(init.body);
      assert.equal(body.p_business_id, businessId);
      newMediaId = body.p_media_id;
      newPath = body.p_storage_path;
      assert.match(newMediaId, /^[0-9a-f-]{36}$/i);
      assert.equal(newPath, `${businessId}/${newMediaId}.webp`);
      return json([{ id: newMediaId, storage_path: newPath, status: 'pending', alt_text: null, sort_order: 0, mime_type: 'image/webp', size_bytes: 30, width: 800, height: 600 }]);
    }
    if (url.pathname.includes('/storage/v1/object/salon-public-media/') && method === 'POST') {
      calls.push('upload');
      assert.ok(newPath && decodeURIComponent(url.pathname).endsWith(newPath));
      return json({ Key: newPath });
    }
    if (url.pathname === '/rest/v1/rpc/finalize_business_public_media_upload') {
      calls.push('finalize');
      assert.equal(JSON.parse(init.body).p_media_id, newMediaId);
      return json({ id: newMediaId, storage_path: newPath, status: 'ready', alt_text: null, sort_order: 0, mime_type: 'image/webp', size_bytes: 30, width: 800, height: 600 });
    }
    throw new Error(`unexpected lifecycle retry fetch ${method} ${url.pathname}`);
  };

  try {
    const response = await app.request('http://localhost/api/public/profile/media', {
      method: 'POST', headers: mutationHeaders('image/webp'), body: validWebp(),
    }, env);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).media?.status, 'ready');
    assert.deepEqual(calls, ['claim', 'delete-404', 'finish', 'begin', 'upload', 'finalize']);
  } finally { globalThis.fetch = realFetch; }
});
