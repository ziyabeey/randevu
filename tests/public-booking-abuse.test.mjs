import test from 'node:test';
import assert from 'node:assert/strict';
import publicBooking from '../worker/public-booking.ts';
import bookingRecovery from '../worker/public-booking-recovery.ts';

const gateSecret = 'ggggggggggggggggggggggggggggggggggggggggggg';
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const managementToken = 'ccccccccccccccccccccccccccccccccccccccccccc';
const recoverySecret = 'ddddddddddddddddddddddddddddddddddddddddddd';
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
  PUBLIC_BOOKING_GATE_SECRET: gateSecret,
  COOKIE_SECURE: 'false',
};
const business = {
  name: 'Abuse Test',
  slug: 'abuse-test',
  timezone: 'Europe/Istanbul',
  local_date: '2026-09-12',
  max_date: '2026-10-12',
  step_minutes: 15,
  min_notice_minutes: 0,
  horizon_days: 30,
};
const service = {
  service_id: '6b000000-0000-4000-8000-000000000001',
  name: 'Abuse Hizmeti',
  duration_minutes: 30,
  price_minor: 180000,
  currency: 'TRY',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(status < 300 ? { ok: true, data } : { ok: false, error: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cookiePair(response) {
  const value = response.headers.get('set-cookie') ?? '';
  return value.split(';')[0] ?? '';
}

function requestHeaders(ip, cookie) {
  return {
    'CF-Connecting-IP': ip,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

test('F09-04 public abuse Worker boundary', async (t) => {
  const realFetch = globalThis.fetch;

  await t.test('fails closed without the server gate secret before Supabase', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return json([]); };
    const response = await publicBooking.request(
      'http://localhost/business/abuse-test',
      { headers: requestHeaders('203.0.113.44') },
      { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, COOKIE_SECURE: 'false' },
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'PUBLIC_BOOKING_UNAVAILABLE');
    assert.equal(calls, 0);
  });

  await t.test('catalog uses guarded RPCs and stores only signed client proof in browser', async () => {
    const bodies = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}'));
      bodies.push({ url, body });
      if (url.endsWith('/rpc/execute_public_operation') && JSON.parse(init.body).p_action === 'business') return json([business]);
      if (url.endsWith('/rpc/execute_public_operation') && JSON.parse(init.body).p_action === 'services') return json([service]);
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await publicBooking.request(
      'http://localhost/business/abuse-test',
      { headers: requestHeaders('203.0.113.44') },
      env,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.business.slug, 'abuse-test');
    assert.equal(payload.services.length, 1);

    const setCookie = response.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /yzt_public_client_v2=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.ok(!setCookie.includes(gateSecret));

    for (const { url, body } of bodies) {
      assert.match(url, /execute_public_operation$/);
      assert.equal(body.p_gate_secret, gateSecret);
      assert.match(body.p_actor_hash, /^[0-9a-f]{64}$/);
      assert.match(body.p_network_hash, /^[0-9a-f]{64}$/);
      assert.ok(!JSON.stringify(body).includes('203.0.113.44'));
    }
    assert.equal(bodies[0].body.p_actor_hash, bodies[1].body.p_actor_hash);
    assert.equal(bodies[0].body.p_network_hash, bodies[1].body.p_network_hash);
  });

  await t.test('valid signed cookie keeps actor stable and same IPv4 /24 shares network bucket', async () => {
    const seen = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}'));
      seen.push(body);
      if (url.endsWith('/rpc/execute_public_operation') && JSON.parse(init.body).p_action === 'business') return json([business]);
      if (url.endsWith('/rpc/execute_public_operation') && JSON.parse(init.body).p_action === 'services') return json([service]);
      throw new Error(`unexpected fetch ${url}`);
    };

    const first = await publicBooking.request(
      'http://localhost/business/abuse-test',
      { headers: requestHeaders('203.0.113.44') },
      env,
    );
    const cookie = cookiePair(first);
    assert.ok(cookie);
    await first.text();

    const firstActor = seen[0].p_actor_hash;
    const firstNetwork = seen[0].p_network_hash;
    seen.length = 0;

    const second = await publicBooking.request(
      'http://localhost/business/abuse-test',
      { headers: requestHeaders('203.0.113.99', cookie) },
      env,
    );
    assert.equal(second.status, 200);
    await second.text();
    assert.equal(seen[0].p_actor_hash, firstActor);
    assert.equal(seen[0].p_network_hash, firstNetwork);
  });

  await t.test('tampered signed cookie is rejected and rotated', async () => {
    const seen = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      seen.push(JSON.parse(String(init?.body ?? '{}')));
      if (url.endsWith('/rpc/execute_public_operation') && JSON.parse(init.body).p_action === 'business') return json([business]);
      if (url.endsWith('/rpc/execute_public_operation') && JSON.parse(init.body).p_action === 'services') return json([service]);
      throw new Error(`unexpected fetch ${url}`);
    };

    const first = await publicBooking.request(
      'http://localhost/business/abuse-test',
      { headers: requestHeaders('198.51.100.25') },
      env,
    );
    const originalCookie = cookiePair(first);
    await first.text();
    const originalActor = seen[0].p_actor_hash;
    seen.length = 0;

    const tampered = `${originalCookie.slice(0, -1)}${originalCookie.endsWith('a') ? 'b' : 'a'}`;
    const second = await publicBooking.request(
      'http://localhost/business/abuse-test',
      { headers: requestHeaders('198.51.100.25', tampered) },
      env,
    );
    await second.text();
    assert.notEqual(seen[0].p_actor_hash, originalActor);
    assert.match(second.headers.get('set-cookie') ?? '', /yzt_public_client_v2=/);
  });

  await t.test('rate-limit RPC error becomes clear HTTP 429 with Retry-After', async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/rpc/execute_public_operation') && JSON.parse(init.body).p_action === 'slots') {
        return json({ message: 'PUBLIC_BOOKING_RATE_LIMITED:37' }, 400);
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await publicBooking.request(
      `http://localhost/business/abuse-test/slots?serviceId=${service.service_id}&date=2026-09-15&staffId=any`,
      { headers: requestHeaders('203.0.113.44') },
      env,
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '37');
    const body = await response.json();
    assert.equal(body.error.code, 'PUBLIC_BOOKING_RATE_LIMITED');
    assert.equal(body.error.retryAfterSeconds, 37);
  });

  await t.test('booking create also surfaces 429 without reporting appointment failure', async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const wire = JSON.parse(String(init?.body ?? '{}'));
      if (url.endsWith('/rpc/execute_public_operation') && wire.p_action === 'profile') {
        return json([{
          kvkk_notice_text: 'Abuse fixture işletmesinin test aydınlatma metni.',
          kvkk_notice_url: 'https://abuse.example.test/kvkk',
          privacy_policy_url: 'https://abuse.example.test/privacy',
          booking_terms_text: 'Abuse fixture işletmesinin test randevu koşulları.',
          booking_terms_url: 'https://abuse.example.test/terms',
        }]);
      }
      if (url.endsWith('/rpc/execute_public_operation') && wire.p_action === 'book') {
        return json({ message: 'PUBLIC_BOOKING_RATE_LIMITED:19' }, 400);
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await bookingRecovery.request(
      'http://localhost/business/abuse-test/book',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'abuse-http-create-0001',
          ...requestHeaders('203.0.113.44'),
        },
        body: JSON.stringify({
          customerName: 'Rate Limit Test',
          customerPhone: '+90 555 900 00 44',
          customerEmail: 'ratelimit@example.test',
          serviceId: service.service_id,
          staffId: '7b000000-0000-4000-8000-000000000001',
          startsAt: '2026-09-15T07:05:00.000Z',
          managementToken,
          recoveryId: '8b000000-0000-4000-8000-000000000001',
          recoverySecret,
        }),
      },
      env,
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '19');
    assert.equal((await response.json()).error.code, 'PUBLIC_BOOKING_RATE_LIMITED');
  });

  globalThis.fetch = realFetch;
});
