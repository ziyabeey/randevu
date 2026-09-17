import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { derivePublicBookingIntentV2 } from '../shared/public-booking-intent.ts';

const canonicalSecret = (byte) => Buffer.alloc(32, byte).toString('base64url');
const recoveryId = '71000000-0000-4000-8000-000000000011';
const recoverySecret = canonicalSecret(2);
const managementToken = canonicalSecret(3);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: canonicalSecret(1),
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
  COOKIE_SECURE: 'false',
};
const anchorId = '81000000-0000-4000-8000-000000000011';
const secondId = '81000000-0000-4000-8000-000000000012';
const customerId = '91000000-0000-4000-8000-000000000011';
const groupId = '61000000-0000-4000-8000-000000000011';

function rpc(data) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function post(path, body) {
  return app.request(`http://localhost/api/public${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.111' },
    body: JSON.stringify(body),
  }, env);
}

async function encryptedCapability() {
  const key = await crypto.subtle.importKey(
    'raw', Buffer.from(env.MANAGEMENT_LINK_ENCRYPTION_KEY_V1, 'base64url'),
    { name: 'AES-GCM' }, false, ['encrypt'],
  );
  const iv = new Uint8Array(12);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`public-booking-recovery:v1|${recoveryId}`),
  }, key, new TextEncoder().encode(managementToken));
  return {
    management_token_ciphertext: Buffer.from(ciphertext).toString('base64url'),
    management_token_iv: Buffer.from(iv).toString('base64url'),
    key_version: 1,
  };
}

function line({
  appointmentId = anchorId,
  lineOrdinal = 1,
  serviceId = '41000000-0000-4000-8000-000000000011',
  serviceName = 'Renk Bakımı',
  staffId = '51000000-0000-4000-8000-000000000011',
  staffName = 'Ayşe',
  startsAt = '2026-09-20T07:00:00.000Z',
  endsAt = '2026-09-20T08:00:00.000Z',
  priceType = 'range',
  priceMinMinor = 20_000,
  priceMaxMinor = 35_000,
  priceMinor = null,
} = {}) {
  return {
    appointmentId, lineOrdinal, serviceId, serviceName, staffId, staffName,
    status: 'scheduled', startsAt, endsAt,
    occupiedStartsAt: startsAt, occupiedEndsAt: endsAt,
    processingCapacityPolicy: 'HOLD', passiveWaitMinutes: 0,
    processingPolicyVersion: 1, priceType, priceMinMinor, priceMaxMinor,
    priceMinor, currency: 'TRY', pricePolicyVersion: 1,
  };
}

function payload(lines) {
  return {
    groupId, status: 'scheduled', source: 'public', version: 1, customerId,
    startsAt: lines[0].startsAt, endsAt: lines.at(-1).endsAt,
    timezone: 'Europe/Istanbul', currency: 'TRY',
    estimateMinMinor: lines.reduce((sum, item) => sum + item.priceMinMinor, 0),
    estimateMaxMinor: lines.reduce((sum, item) => sum + item.priceMaxMinor, 0),
    lines,
  };
}

function rowFor(group, encrypted) {
  const anchor = group.lines[0];
  return {
    appointment_id: anchor.appointmentId,
    business_name: 'F11 Salon',
    status: anchor.status,
    starts_at: anchor.startsAt,
    ends_at: anchor.endsAt,
    timezone: group.timezone,
    service_name: anchor.serviceName,
    staff_name: anchor.staffName,
    price_minor: anchor.priceMinor,
    currency: group.currency,
    ...encrypted,
    recovery_expires_at: '2026-09-23T07:00:00.000Z',
    group_payload: group,
  };
}

const requestFor = (intent) => ({
  recoveryId,
  idempotencyKey: intent.idempotencyKey,
  recoverySecret,
});

await test('F11 group recovery and resolution validate and return canonical group payloads', async (t) => {
  const intent = await derivePublicBookingIntentV2(
    recoveryId, Math.floor(Date.now() / 1000) + 300, recoverySecret,
  );
  const encrypted = await encryptedCapability();
  const singleRange = payload([line()]);
  const multi = payload([
    line({ priceType: 'fixed', priceMinMinor: 20_000, priceMaxMinor: 20_000, priceMinor: 20_000 }),
    line({
      appointmentId: secondId, lineOrdinal: 2,
      serviceId: '41000000-0000-4000-8000-000000000012', serviceName: 'Kesim',
      staffId: '51000000-0000-4000-8000-000000000012', staffName: 'Deniz',
      startsAt: '2026-09-20T08:00:00.000Z', endsAt: '2026-09-20T08:30:00.000Z',
      priceType: 'range', priceMinMinor: 10_000, priceMaxMinor: 15_000, priceMinor: null,
    }),
  ]);

  for (const [name, group] of [['single range', singleRange], ['multiple lines', multi]]) {
    for (const action of ['recover', 'resolve']) {
      await t.test(`${name} ${action}`, async () => {
        const realFetch = globalThis.fetch;
        const row = rowFor(group, encrypted);
        globalThis.fetch = async (_input, init) => {
          const wire = JSON.parse(String(init.body));
          assert.equal(wire.p_action, action);
          assert.equal(wire.p_args.p_recovery_secret_hash, intent.secretHash);
          assert.ok(!String(init.body).includes(recoverySecret));
          return rpc([action === 'resolve'
            ? { resolution: 'committed', recovery_id: recoveryId, ...row }
            : row]);
        };
        try {
          const response = await post(`/booking/${action}`, requestFor(intent));
          const body = await response.json();
          assert.equal(response.status, 200);
          assert.deepEqual(body.group, group);
          assert.equal(body.appointment.appointment_id, anchorId);
          assert.equal(body.appointment.price_minor, group.lines[0].priceMinor);
          assert.equal(body.management.url, `/m#${managementToken}`);
          if (action === 'resolve') assert.equal(body.resolution, 'committed');
          assert.ok(!JSON.stringify(body).includes(recoverySecret));
        } finally { globalThis.fetch = realFetch; }
      });
    }
  }
});

await test('F11 recovery keeps legacy fixed projections and existing failure semantics', async (t) => {
  const intent = await derivePublicBookingIntentV2(
    recoveryId, Math.floor(Date.now() / 1000) + 300, recoverySecret,
  );
  const encrypted = await encryptedCapability();
  const fixed = payload([line({
    priceType: 'fixed', priceMinMinor: 20_000, priceMaxMinor: 20_000, priceMinor: 20_000,
  })]);
  const legacyRow = { ...rowFor(fixed, encrypted) };
  delete legacyRow.group_payload;

  await t.test('legacy committed response omits group and keeps the scalar charge', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => rpc([{
      resolution: 'committed', recovery_id: recoveryId, ...legacyRow,
    }]);
    try {
      const response = await post('/booking/resolve', requestFor(intent));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.appointment.price_minor, 20_000);
      assert.equal('group' in body, false);
    } finally { globalThis.fetch = realFetch; }
  });

  await t.test('wrong proof is denied without reaching the public gate or upstream', async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; return rpc([]); };
    try {
      const wrongKey = `${intent.idempotencyKey.slice(0, -1)}${intent.idempotencyKey.endsWith('0') ? '1' : '0'}`;
      const response = await post('/booking/resolve', {
        ...requestFor(intent), idempotencyKey: wrongKey,
      });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'BOOKING_RECOVERY_NOT_FOUND');
      assert.equal(calls, 0);
    } finally { globalThis.fetch = realFetch; }
  });

  for (const action of ['recover', 'resolve']) {
    await t.test(`${action} fails closed on an inconsistent group estimate`, async () => {
      const malformed = structuredClone(fixed);
      malformed.estimateMinMinor += 1;
      const row = rowFor(malformed, encrypted);
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (_input, init) => {
        const wire = JSON.parse(String(init.body));
        assert.equal(wire.p_action, action);
        return rpc([action === 'resolve'
          ? { resolution: 'committed', recovery_id: recoveryId, ...row }
          : row]);
      };
      try {
        const response = await post(`/booking/${action}`, requestFor(intent));
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error.code, 'BOOKING_RESULT_UNKNOWN');
      } finally { globalThis.fetch = realFetch; }
    });

    await t.test(`${action} rejects an unknown processing-capacity policy`, async () => {
      const malformed = structuredClone(fixed);
      malformed.lines[0].processingCapacityPolicy = 'exclusive';
      const row = rowFor(malformed, encrypted);
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => rpc([action === 'resolve'
        ? { resolution: 'committed', recovery_id: recoveryId, ...row }
        : row]);
      try {
        const response = await post(`/booking/${action}`, requestFor(intent));
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal(body.error.code, 'BOOKING_RESULT_UNKNOWN');
        assert.equal('management' in body, false);
        assert.equal('group' in body, false);
      } finally { globalThis.fetch = realFetch; }
    });

    await t.test(`${action} preserves decrypt-failure behavior`, async () => {
      const row = { ...rowFor(fixed, encrypted), management_token_ciphertext: 'corrupt' };
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => rpc([action === 'resolve'
        ? { resolution: 'committed', recovery_id: recoveryId, ...row }
        : row]);
      try {
        const response = await post(`/booking/${action}`, requestFor(intent));
        const body = await response.json();
        if (action === 'resolve') {
          assert.equal(response.status, 200);
          assert.deepEqual(body, { resolution: 'exists_nolink', recoveryId });
        } else {
          assert.equal(response.status, 503);
          assert.equal(body.error.code, 'BOOKING_RECOVERY_UNAVAILABLE');
        }
      } finally { globalThis.fetch = realFetch; }
    });

    await t.test(`${action} maps upstream failure to an unknown result`, async () => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ message: 'upstream unavailable' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
      try {
        const response = await post(`/booking/${action}`, requestFor(intent));
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error.code, 'BOOKING_RESULT_UNKNOWN');
      } finally { globalThis.fetch = realFetch; }
    });
  }
});
