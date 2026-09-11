import test from 'node:test';
import assert from 'node:assert/strict';
import bookingRecovery from '../worker/public-booking-recovery.ts';

const managementToken = 'ccccccccccccccccccccccccccccccccccccccccccc';
const recoverySecret = 'ddddddddddddddddddddddddddddddddddddddddddd';
const recoveryId = '8a000000-0000-4000-8000-000000000001';
const idempotencyKey = 'phase9-http-create-0001';
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
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
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function post(path, body, testEnv = env, headers = {}) {
  return bookingRecovery.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, testEnv);
}

test('F09-02 booking recovery HTTP contract', async (t) => {
  const realFetch = globalThis.fetch;
  let encryptedPayload = null;

  await t.test('fails closed before DB when encryption secret is missing', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return json([]); };
    const response = await post(
      '/business/recovery-test/book',
      bookingBody,
      { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY },
      { 'Idempotency-Key': idempotencyKey },
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'BOOKING_RECOVERY_UNAVAILABLE');
    assert.equal(calls, 0);
  });

  await t.test('atomic booking request sends only hashes/ciphertext to Supabase', async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      assert.match(url, /create_public_appointment_with_recovery$/);
      assert.ok(!url.includes(managementToken));
      assert.ok(!url.includes(recoverySecret));
      encryptedPayload = JSON.parse(String(init?.body ?? '{}'));
      assert.ok(!String(init?.body).includes(managementToken));
      assert.ok(!String(init?.body).includes(recoverySecret));
      assert.match(encryptedPayload.p_management_token_hash, /^[0-9a-f]{64}$/);
      assert.match(encryptedPayload.p_recovery_secret_hash, /^[0-9a-f]{64}$/);
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
      assert.match(url, /recover_public_appointment$/);
      assert.ok(!url.includes(recoverySecret));
      const requestBody = JSON.parse(String(init?.body ?? '{}'));
      assert.ok(!String(init?.body).includes(recoverySecret));
      assert.match(requestBody.p_recovery_secret_hash, /^[0-9a-f]{64}$/);
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
