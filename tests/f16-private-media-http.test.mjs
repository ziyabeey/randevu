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
const user = { id: 'f1600000-0000-4000-8000-000000000301', email: 'f1603@example.test' };
const businessId = 'f1600000-0000-4000-8000-000000000302';
const foreignBusinessId = 'f1600000-0000-4000-8000-000000000399';
const groupId = 'f1600000-0000-4000-8000-000000000303';
const mediaId = 'f1600000-0000-4000-8000-000000000304';
const serviceId = 'f1600000-0000-4000-8000-000000000305';
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function accessToken(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: 'f1600000-0000-4000-8000-000000000306',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function cookies(method) {
  return `yzt_access=${accessToken(method)}; yzt_refresh=refresh-token; yzt_business=${businessId}; yzt_csrf=${csrf}`;
}
function readHeaders(method) { return { Cookie: cookies(method) }; }
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
function membership(role = 'staff') {
  return { id: 'f1600000-0000-4000-8000-000000000307', business_id: businessId, role, active: true };
}
function mediaRow(extra = {}) {
  return {
    id: mediaId, appointment_group_id: groupId, service_id: serviceId, service_name: 'Boya',
    caption: 'Önce', width: 800, height: 600, size_bytes: 30, created_at: '2026-09-24T10:00:00.000Z',
    published: false, can_delete: true, can_publish: false, ...extra,
  };
}

async function withFetch(handler, run, role = 'staff') {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership(role)]);
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    const headers = new Headers(init.headers);
    calls.push({ method, path: decodeURIComponent(url.pathname), body, authorization: headers.get('Authorization') });
    const result = await handler({ method, path: decodeURIComponent(url.pathname), body, url, headers });
    if (!result) throw new Error(`unexpected fetch ${method} ${url.pathname}`);
    return result;
  };
  try { await run(calls); } finally { globalThis.fetch = realFetch; }
}

await test('F16-03 upload derives tenant/path from membership, stores privately and finalizes', async () => {
  await withFetch(async ({ method, path, body, headers }) => {
    if (path === '/rest/v1/rpc/list_appointment_private_media_cleanup') return json([]);
    if (path === '/rest/v1/rpc/begin_appointment_private_media_upload') {
      assert.equal(body.p_business_id, businessId);
      assert.equal(body.p_group_id, groupId);
      assert.equal(body.p_service_id, serviceId);
      assert.equal(body.p_caption, 'Önce');
      assert.equal(body.p_storage_path, `${businessId}/${groupId}/${body.p_media_id}.webp`);
      assert.deepEqual([body.p_size_bytes, body.p_width, body.p_height], [30, 800, 600]);
      return json([{ ...mediaRow(), id: body.p_media_id, status: 'pending' }]);
    }
    if (path.startsWith('/storage/v1/object/appointment-private-media/') && method === 'POST') {
      assert.match(path, new RegExp(`^/storage/v1/object/appointment-private-media/${businessId}/${groupId}/[0-9a-f-]{36}\\.webp$`));
      assert.match(headers.get('Authorization') ?? '', /^Bearer ey/);
      assert.notEqual(headers.get('Authorization'), `Bearer ${env.SUPABASE_ANON_KEY}`);
      return json({ Key: path });
    }
    if (path === '/rest/v1/rpc/finalize_appointment_private_media_upload') return json([{ ...mediaRow(), id: body.p_media_id, status: 'ready' }]);
    return null;
  }, async (calls) => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/photos?serviceId=${serviceId}&caption=%C3%96nce`, {
      method: 'POST', headers: { ...mutationHeaders('image/webp'), 'X-YZT-Business': foreignBusinessId }, body: validWebp(),
    }, env);
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.photo.groupId, groupId);
    assert.match(payload.photo.contentUrl, /^\/api\/private-media\/[0-9a-f-]{36}\/content$/);
    assert.equal(payload.photo.canPublish, false, 'staff never gets the publish affordance');
    assert.deepEqual(calls.map((call) => call.path.split('/').slice(0, 4).join('/')),
      ['/rest/v1/rpc', '/rest/v1/rpc', '/storage/v1/object', '/rest/v1/rpc']);
    assert.ok(calls.every((call) => !JSON.stringify(call.body ?? '').includes(foreignBusinessId)));
  });
});

await test('F16-03 upload rejects wrong type, size, edge and service input before any RPC', async () => {
  const cases = [
    ['image/png', validWebp(), '', 415],
    ['image/webp', new Uint8Array(5 * 1024 * 1024 + 1), '', 413],
    ['image/webp', new Uint8Array(30), '', 400],
    ['image/webp', validWebp(), '?serviceId=not-a-uuid', 400],
    ['image/webp', validWebp(), `?caption=${'x'.repeat(241)}`, 400],
  ];
  for (const [type, body, query, status] of cases) {
    await withFetch(async () => null, async (calls) => {
      const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/photos${query}`, {
        method: 'POST', headers: mutationHeaders(type), body,
      }, env);
      assert.equal(response.status, status, `${type} ${query}`);
      assert.equal((await response.json()).error.code, 'INVALID_PRIVATE_MEDIA');
      assert.equal(calls.length, 0);
    });
  }
});

await test('F16-03 failed storage upload is marked for cleanup and never finalized', async () => {
  await withFetch(async ({ method, path }) => {
    if (path === '/rest/v1/rpc/list_appointment_private_media_cleanup') return json([]);
    if (path === '/rest/v1/rpc/begin_appointment_private_media_upload') return json([mediaRow({ status: 'pending' })]);
    if (path.startsWith('/storage/v1/object/appointment-private-media/') && method === 'POST') return json({ message: 'boom' }, 500);
    if (path === '/rest/v1/rpc/mark_appointment_private_media_cleanup') return json(true);
    return null;
  }, async (calls) => {
    const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/photos`, {
      method: 'POST', headers: mutationHeaders('image/webp'), body: validWebp(),
    }, env);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'PRIVATE_MEDIA_STORAGE_FAILED');
    assert.ok(calls.some((call) => call.path.endsWith('/mark_appointment_private_media_cleanup')));
    assert.ok(!calls.some((call) => call.path.endsWith('/finalize_appointment_private_media_upload')));
  });
});

await test('F16-03 limit and foreign-group errors are mapped without leaking internals', async () => {
  for (const [message, status, code] of [
    ['PRIVATE_MEDIA_LIMIT_EXCEEDED', 409, 'PRIVATE_MEDIA_LIMIT_EXCEEDED'],
    ['PRIVATE_MEDIA_GROUP_NOT_FOUND', 404, 'PRIVATE_MEDIA_GROUP_NOT_FOUND'],
    ['NOT_ALLOWED', 403, 'NOT_ALLOWED'],
  ]) {
    await withFetch(async ({ path }) => {
      if (path === '/rest/v1/rpc/list_appointment_private_media_cleanup') return json([]);
      if (path === '/rest/v1/rpc/begin_appointment_private_media_upload') return json({ message, details: 'pg internals' }, 400);
      return null;
    }, async (calls) => {
      const response = await app.request(`http://localhost/api/bookings/groups/${groupId}/photos`, {
        method: 'POST', headers: mutationHeaders('image/webp'), body: validWebp(),
      }, env);
      assert.equal(response.status, status);
      const text = await response.text();
      assert.equal(JSON.parse(text).error.code, code);
      assert.doesNotMatch(text, /pg internals/);
      assert.ok(!calls.some((call) => call.path.startsWith('/storage/')));
    });
  }
});

await test('F16-03 content is streamed with the caller JWT, never cached and never public', async () => {
  await withFetch(async ({ method, path, body }) => {
    if (path === '/rest/v1/rpc/get_appointment_private_media_object') {
      assert.equal(body.p_business_id, businessId);
      return json([{ storage_path: `${businessId}/${groupId}/${mediaId}.webp`, mime_type: 'image/webp' }]);
    }
    if (path === `/storage/v1/object/appointment-private-media/${businessId}/${groupId}/${mediaId}.webp` && method === 'GET') {
      return new Response(validWebp(), { status: 200, headers: { 'Content-Type': 'image/webp' } });
    }
    return null;
  }, async (calls) => {
    const response = await app.request(`http://localhost/api/private-media/${mediaId}/content`, { headers: readHeaders() }, env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/webp');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal((await response.arrayBuffer()).byteLength, 30);
    const storage = calls.find((call) => call.path.startsWith('/storage/'));
    assert.match(storage.authorization ?? '', /^Bearer ey/);
  });
  for (const [rpc, status, code] of [
    [json([]), 404, 'PRIVATE_MEDIA_NOT_FOUND'],
    [json({ message: 'NOT_ALLOWED' }, 403), 403, 'NOT_ALLOWED'],
  ]) {
    await withFetch(async ({ path }) => (path === '/rest/v1/rpc/get_appointment_private_media_object' ? rpc.clone() : null), async (calls) => {
      const response = await app.request(`http://localhost/api/private-media/${mediaId}/content`, { headers: readHeaders() }, env);
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
      assert.ok(!calls.some((call) => call.path.startsWith('/storage/')), 'storage must not be touched after an authorization miss');
    });
  }
});

await test('F16-03 password-recovery sessions cannot read or change private photos', async () => {
  await withFetch(async () => null, async (calls) => {
    const response = await app.request(`http://localhost/api/private-media/${mediaId}/content`, { headers: readHeaders('recovery') }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'PASSWORD_UPDATE_REQUIRED');
    assert.equal(calls.length, 0);
  });
});

await test('F16-03 delete restores the row when storage removal fails and finishes otherwise', async () => {
  for (const storageStatus of [500, 200]) {
    await withFetch(async ({ method, path }) => {
      if (path === '/rest/v1/rpc/begin_appointment_private_media_delete') return json([{ storage_path: `${businessId}/${groupId}/${mediaId}.webp` }]);
      if (path.startsWith('/storage/v1/object/appointment-private-media/') && method === 'DELETE') return new Response(null, { status: storageStatus });
      if (path === '/rest/v1/rpc/restore_appointment_private_media_delete') return json(true);
      if (path === '/rest/v1/rpc/finish_appointment_private_media_delete') return json(true);
      return null;
    }, async (calls) => {
      const response = await app.request(`http://localhost/api/private-media/${mediaId}`, { method: 'DELETE', headers: mutationHeaders() }, env);
      const names = calls.map((call) => call.path.split('/').pop());
      if (storageStatus === 500) {
        assert.equal(response.status, 502);
        assert.ok(names.includes('restore_appointment_private_media_delete'));
        assert.ok(!names.includes('finish_appointment_private_media_delete'));
      } else {
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { deleted: true });
        assert.ok(names.includes('finish_appointment_private_media_delete'));
      }
    });
  }
});

await test('F16-03 publish is manager-only and requires explicit consent before any RPC', async () => {
  await withFetch(async () => null, async (calls) => {
    const response = await app.request(`http://localhost/api/private-media/${mediaId}/publish`, {
      method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ consentConfirmed: true }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  }, 'staff');
  await withFetch(async () => null, async (calls) => {
    const response = await app.request(`http://localhost/api/private-media/${mediaId}/publish`, {
      method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ consentConfirmed: 'true' }),
    }, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'PRIVATE_MEDIA_CONSENT_REQUIRED');
    assert.equal(calls.length, 0);
  }, 'manager');
});

await test('F16-03 publish copies bytes into a new public media row and links it', async () => {
  let publicId = '';
  await withFetch(async ({ method, path, body }) => {
    if (path === '/rest/v1/rpc/begin_appointment_private_media_publish') {
      assert.equal(body.p_consent_confirmed, true);
      return json([{ storage_path: `${businessId}/${groupId}/${mediaId}.webp`, caption: 'Önce', size_bytes: 30, width: 800, height: 600 }]);
    }
    if (path === `/storage/v1/object/appointment-private-media/${businessId}/${groupId}/${mediaId}.webp` && method === 'GET') {
      return new Response(validWebp(), { status: 200 });
    }
    if (path === '/rest/v1/rpc/begin_business_public_media_upload') {
      publicId = body.p_media_id;
      assert.notEqual(publicId, mediaId);
      assert.equal(body.p_storage_path, `${businessId}/${publicId}.webp`);
      assert.equal(body.p_alt_text, 'Galeri');
      return json([{ id: publicId }]);
    }
    if (path === `/storage/v1/object/salon-public-media/${businessId}/${publicId}.webp` && method === 'POST') return json({ Key: path });
    if (path === '/rest/v1/rpc/finalize_business_public_media_upload') return json({ id: publicId, status: 'ready' });
    if (path === '/rest/v1/rpc/finish_appointment_private_media_publish') {
      assert.equal(body.p_public_media_id, publicId);
      return json(true);
    }
    return null;
  }, async () => {
    const response = await app.request(`http://localhost/api/private-media/${mediaId}/publish`, {
      method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ consentConfirmed: true, altText: 'Galeri' }),
    }, env);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { published: true, publicMediaId: publicId });
  }, 'owner');
});

await test('F16-03 a lost publish race removes the duplicate public copy', async () => {
  await withFetch(async ({ method, path, body }) => {
    if (path === '/rest/v1/rpc/begin_appointment_private_media_publish') return json([{ storage_path: `${businessId}/${groupId}/${mediaId}.webp`, caption: null, size_bytes: 30, width: 800, height: 600 }]);
    if (path.startsWith('/storage/v1/object/appointment-private-media/') && method === 'GET') return new Response(validWebp(), { status: 200 });
    if (path === '/rest/v1/rpc/begin_business_public_media_upload') return json([{ id: body.p_media_id }]);
    if (path.startsWith('/storage/v1/object/salon-public-media/') && method === 'POST') return json({});
    if (path === '/rest/v1/rpc/finalize_business_public_media_upload') return json({});
    if (path === '/rest/v1/rpc/finish_appointment_private_media_publish') return json({ message: 'PRIVATE_MEDIA_ALREADY_PUBLISHED' }, 400);
    if (path === '/rest/v1/rpc/begin_business_public_media_delete') return json([{ storage_path: 'x', was_cover: false }]);
    if (path === '/rest/v1/rpc/mark_business_public_media_cleanup') return json({});
    if (path.startsWith('/storage/v1/object/salon-public-media/') && method === 'DELETE') return new Response(null, { status: 200 });
    if (path === '/rest/v1/rpc/finish_business_public_media_delete') return json(true);
    return null;
  }, async (calls) => {
    const response = await app.request(`http://localhost/api/private-media/${mediaId}/publish`, {
      method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ consentConfirmed: true }),
    }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'PRIVATE_MEDIA_ALREADY_PUBLISHED');
    const names = calls.map((call) => `${call.method} ${call.path.split('/').slice(0, 5).join('/')}`);
    assert.ok(names.includes('DELETE /storage/v1/object/salon-public-media'));
    assert.ok(calls.some((call) => call.path.endsWith('/finish_business_public_media_delete')));
  }, 'manager');
});

await test('F16-03 archive probes one extra row for a stable next cursor and validates filters', async () => {
  const rows = [0, 1, 2].map((index) => mediaRow({
    id: `f1600000-0000-4000-8000-00000000031${index}`, customer_name: 'Ayşe', created_at: `2026-09-2${4 - index}T10:00:00.000Z`,
  }));
  await withFetch(async ({ path, body }) => {
    if (path === '/rest/v1/rpc/list_business_private_media_archive') {
      assert.equal(body.p_limit, 3);
      assert.equal(body.p_service_id, serviceId);
      return json(rows);
    }
    return null;
  }, async () => {
    const response = await app.request(`http://localhost/api/private-media?serviceId=${serviceId}&limit=2`, { headers: readHeaders() }, env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.photos.length, 2);
    assert.deepEqual(payload.next, { beforeCreatedAt: rows[1].created_at, beforeId: rows[1].id });
    assert.equal(payload.photos[0].customerName, 'Ayşe');
  });
  for (const query of ['limit=0', 'limit=101', 'serviceId=bad', `beforeId=${mediaId}`, 'beforeCreatedAt=nope&beforeId=bad']) {
    await withFetch(async () => null, async (calls) => {
      const response = await app.request(`http://localhost/api/private-media?${query}`, { headers: readHeaders() }, env);
      assert.equal(response.status, 400, query);
      assert.equal(calls.length, 0);
    });
  }
});
