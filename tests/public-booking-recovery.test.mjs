import test from 'node:test';
import assert from 'node:assert/strict';
import bookingRecovery from '../worker/public-booking-recovery.ts';

const managementToken = 'ccccccccccccccccccccccccccccccccccccccccccc';
const recoverySecret = 'ddddddddddddddddddddddddddddddddddddddddddd';
const recoveryId = '8a000000-0000-4000-8000-000000000001';
const idempotencyKey = 'phase9-http-create-0001';
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const gateSecret = 'ggggggggggggggggggggggggggggggggggggggggggg';
const clientIp = '203.0.113.44';
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
  PUBLIC_BOOKING_GATE_SECRET: gateSecret,
  COOKIE_SECURE: 'false',
};
const bookingBody = {
  customerName: 'HTTP Recovery',
  customerPhone: '+90 555 900 00 01',
  customerEmail: 'http-recovery@example.test',
  notes: null,
  serviceId: '6a000000-0000-4000-8000-000000000001',
  staffId: '7a000000-0000-4000-8000-000000000001',
  startsAt: '2026-09-15T07:05:00.000Z',
  managementToken,
  recoveryId,
  recoverySecret,
};
const appointment = {
  appointment_id: '9a000000-0000-4000-8000-000000000001',
  status: 'scheduled',
  starts_at: bookingBody.startsAt,
  ends_at: '2026-09-15T07:35:00.000Z',
  timezone: 'Europe/Istanbul',
  service_name: 'Recovery Hizmeti',
  staff_name: 'Recovery Ayşe',
  price_minor: 190000,
  currency: 'TRY',
  recovery_expires_at: '2026-09-18T07:05:00.000Z',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(status < 300 ? { ok: true, data } : { ok: false, error: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function post(path, body, testEnv = env, headers = {}) {
  return bookingRecovery.request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': clientIp,
      ...headers,
    },
    body: JSON.stringify(body),
  }, testEnv);
}

test('F09-02 booking recovery HTTP contract under F09-04 guard', async (t) => {
  const realFetch = globalThis.fetch;
  let encryptedPayload = null;

  await t.test('fails closed before DB when encryption secret is missing', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return json([]); };
    const response = await post(
      '/business/recovery-test/book',
      bookingBody,
      {
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
        PUBLIC_BOOKING_GATE_SECRET: gateSecret,
        COOKIE_SECURE: 'false',
      },
      { 'Idempotency-Key': idempotencyKey },
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'BOOKING_RECOVERY_UNAVAILABLE');
    assert.equal(calls, 0);
  });

  await t.test('atomic booking request sends only hashes/ciphertext plus server gate proof to Supabase', async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      assert.match(url, /execute_public_operation$/);
      assert.equal(JSON.parse(init.body).p_action, 'book');
      assert.ok(!url.includes(managementToken));
      assert.ok(!url.includes(recoverySecret));
      const wire = JSON.parse(String(init?.body ?? '{}'));
      encryptedPayload = wire.p_args;
      assert.ok(!String(init?.body).includes(managementToken));
      assert.ok(!String(init?.body).includes(recoverySecret));
      assert.ok(!String(init?.body).includes(clientIp));
      assert.match(encryptedPayload.p_management_token_hash, /^[0-9a-f]{64}$/);
      assert.match(encryptedPayload.p_recovery_secret_hash, /^[0-9a-f]{64}$/);
      assert.match(wire.p_actor_hash, /^[0-9a-f]{64}$/);
      assert.match(wire.p_network_hash, /^[0-9a-f]{64}$/);
      assert.equal(wire.p_gate_secret, gateSecret);
      assert.equal(encryptedPayload.p_recovery_id, recoveryId);
      assert.equal(encryptedPayload.p_key_version, 1);
      return json([appointment]);
    };

    const response = await post(
      '/business/recovery-test/book',
      bookingBody,
      env,
      { 'Idempotency-Key': idempotencyKey },
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.appointment.appointment_id, appointment.appointment_id);
    assert.equal(body.management.url, `/m#${managementToken}`);
    assert.equal(body.recovery.expiresAt, appointment.recovery_expires_at);
    assert.match(response.headers.get('set-cookie') ?? '', /yzt_public_client_v2=/);
  });

  await t.test('ambiguous Supabase failure is not reported as a failed booking', async () => {
    globalThis.fetch = async () => { throw new Error('connection dropped after request'); };
    const response = await post(
      '/business/recovery-test/book',
      bookingBody,
      env,
      { 'Idempotency-Key': idempotencyKey },
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'BOOKING_RESULT_UNKNOWN');
  });

  await t.test('valid recovery proof restores the original management link', async () => {
    assert.ok(encryptedPayload);
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      assert.match(url, /execute_public_operation$/);
      assert.equal(JSON.parse(init.body).p_action, 'recover');
      assert.ok(!url.includes(recoverySecret));
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      assert.ok(!String(init?.body).includes(recoverySecret));
      assert.ok(!String(init?.body).includes(clientIp));
      assert.equal(requestBody.p_gate_secret, gateSecret);
      assert.match(requestBody.p_actor_hash, /^[0-9a-f]{64}$/);
      assert.match(requestBody.p_network_hash, /^[0-9a-f]{64}$/);
      assert.match(requestBody.p_args.p_recovery_secret_hash, /^[0-9a-f]{64}$/);
      return json([{
        appointment_id: appointment.appointment_id,
        business_name: 'Recovery Test',
        status: appointment.status,
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        timezone: appointment.timezone,
        service_name: appointment.service_name,
        staff_name: appointment.staff_name,
        price_minor: appointment.price_minor,
        currency: appointment.currency,
        management_token_ciphertext: encryptedPayload.p_management_token_ciphertext,
        management_token_iv: encryptedPayload.p_management_token_iv,
        key_version: encryptedPayload.p_key_version,
        recovery_expires_at: appointment.recovery_expires_at,
      }]);
    };

    const response = await post('/booking/recover', {
      recoveryId,
      idempotencyKey,
      recoverySecret,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.appointment.appointment_id, appointment.appointment_id);
    assert.equal(body.appointment.business_name, 'Recovery Test');
    assert.equal(body.management.url, `/m#${managementToken}`);
  });

  await t.test('wrong or expired proof has one generic not-found response', async () => {
    globalThis.fetch = async () => json([]);
    const response = await post('/booking/recover', {
      recoveryId,
      idempotencyKey,
      recoverySecret: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, 'BOOKING_RECOVERY_NOT_FOUND');
  });

  globalThis.fetch = realFetch;
});
