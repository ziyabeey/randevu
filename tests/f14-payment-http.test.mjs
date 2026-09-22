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

const user = { id: 'f1500000-0000-4000-8000-000000000001', email: 'f1503@example.test' };
const businessId = 'f1510000-0000-4000-8000-000000000001';
const otherBusinessId = 'f1510000-0000-4000-8000-000000000002';
const membershipId = 'f1520000-0000-4000-8000-000000000001';
const ticketId = 'f1530000-0000-4000-8000-000000000001';
const paymentId = 'f1540000-0000-4000-8000-000000000001';
const csrfValue = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function accessToken(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    session_id: 'f1550000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookies() {
  return [
    `yzt_access=${accessToken()}`,
    'yzt_refresh=f1503-refresh',
    `yzt_business=${businessId}`,
    `yzt_csrf=${csrfValue}`,
  ].join('; ');
}

function headers(key) {
  return {
    Origin: 'http://localhost',
    Cookie: cookies(),
    'X-YZT-CSRF': csrfValue,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}

function membership(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function expectedHash(command, payload) {
  return sha256Hex(JSON.stringify({ command, ...payload }));
}

function baseFetch({ permission = true, role = 'owner', rpc }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership(role)]);
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') {
      const body = JSON.parse(init.body);
      assert.equal(body.p_business_id, businessId);
      assert.equal(body.p_permission, 'payments_write');
      return json(permission);
    }
    return rpc(url, init);
  };
}

await test('F14-03 denied payments_write stops before payment mutation RPC', async () => {
  const realFetch = globalThis.fetch;
  const extraCalls = [];
  globalThis.fetch = baseFetch({
    permission: false,
    role: 'staff',
    rpc: async (url) => {
      extraCalls.push(url.pathname);
      throw new Error(`unexpected payment mutation fetch: ${url}`);
    },
  });
  try {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}/payments`, {
      method: 'POST',
      headers: headers('f1503-denied-key'),
      body: JSON.stringify({ method: 'cash', amountMinor: 20000 }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PAYMENTS_PERMISSION_REQUIRED');
    assert.deepEqual(extraCalls, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F14-03 payment derives tenant server-side and hashes exact command intent', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = baseFetch({
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/record_ticket_payment_guarded');
      rpcBody = JSON.parse(init.body);
      return json({
        ticketId,
        paymentStatus: 'partial',
        paidMinor: 20000,
        balanceMinor: 40000,
      });
    },
  });
  try {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}/payments`, {
      method: 'POST',
      headers: headers('f1503-payment-key'),
      body: JSON.stringify({
        method: 'cash',
        amountMinor: 20000,
        businessId: otherBusinessId,
      }),
    }, env);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).ticket.paidMinor, 20000);
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_ticket_id, ticketId);
    assert.equal(rpcBody.p_payment_method, 'cash');
    assert.equal(rpcBody.p_amount_minor, 20000);
    assert.equal(rpcBody.p_idempotency_key, 'f1503-payment-key');
    assert.equal(
      rpcBody.p_request_hash,
      await expectedHash('record_payment', { ticketId, method: 'cash', amountMinor: 20000 }),
    );
    assert.equal(JSON.stringify(rpcBody).includes(otherBusinessId), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F14-03 invalid payment amount fails before guarded RPC', async () => {
  const realFetch = globalThis.fetch;
  let rpcCalls = 0;
  globalThis.fetch = baseFetch({
    rpc: async () => {
      rpcCalls += 1;
      return json({});
    },
  });
  try {
    const response = await app.request(`http://localhost/api/tickets/${ticketId}/payments`, {
      method: 'POST',
      headers: headers('f1503-invalid-payment'),
      body: JSON.stringify({ method: 'card', amountMinor: 12.5 }),
    }, env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error?.code, 'INVALID_PAYMENT');
    assert.equal(rpcCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F14-03 correction trims reason and binds source payment in request hash', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = baseFetch({
    rpc: async (url, init) => {
      assert.equal(url.pathname, '/rest/v1/rpc/record_ticket_correction_guarded');
      rpcBody = JSON.parse(init.body);
      return json({ ticketId, paidMinor: 25000, balanceMinor: 35000 });
    },
  });
  try {
    const response = await app.request(
      `http://localhost/api/tickets/${ticketId}/payments/${paymentId}/corrections`,
      {
        method: 'POST',
        headers: headers('f1503-correction-key'),
        body: JSON.stringify({
          direction: 'increase',
          amountMinor: 5000,
          reason: '  Eksik nakit kaydı  ',
        }),
      },
      env,
    );
    assert.equal(response.status, 201);
    assert.equal(rpcBody.p_source_payment_event_id, paymentId);
    assert.equal(rpcBody.p_direction, 'increase');
    assert.equal(rpcBody.p_reason, 'Eksik nakit kaydı');
    assert.equal(
      rpcBody.p_request_hash,
      await expectedHash('record_correction', {
        ticketId,
        paymentId,
        direction: 'increase',
        amountMinor: 5000,
        reason: 'Eksik nakit kaydı',
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F14-03 refund maps source over-refund to stable 409', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = baseFetch({
    rpc: async (url) => {
      assert.equal(url.pathname, '/rest/v1/rpc/record_ticket_refund_guarded');
      return json({ message: 'REFUND_EXCEEDS_SOURCE' }, 400);
    },
  });
  try {
    const response = await app.request(
      `http://localhost/api/tickets/${ticketId}/payments/${paymentId}/refunds`,
      {
        method: 'POST',
        headers: headers('f1503-refund-key'),
        body: JSON.stringify({ amountMinor: 50000, reason: 'Müşteri iadesi' }),
      },
      env,
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error?.code, 'REFUND_EXCEEDS_SOURCE');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('F14-03 overpayment and close-with-balance use explicit conflict vocabulary', async () => {
  const realFetch = globalThis.fetch;
  let mutation = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    if (url.pathname === '/rest/v1/rpc/has_financial_permission') return json(true);
    if (url.pathname === '/rest/v1/rpc/record_ticket_payment_guarded') {
      mutation += 1;
      return json({ message: 'OVERPAYMENT' }, 400);
    }
    if (url.pathname === '/rest/v1/rpc/close_ticket_guarded') {
      mutation += 1;
      return json({ message: 'TICKET_BALANCE_REMAINS' }, 400);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const pay = await app.request(`http://localhost/api/tickets/${ticketId}/payments`, {
      method: 'POST',
      headers: headers('f1503-overpay-key'),
      body: JSON.stringify({ method: 'cash', amountMinor: 70000 }),
    }, env);
    assert.equal(pay.status, 409);
    assert.equal((await pay.json()).error?.code, 'OVERPAYMENT');

    const close = await app.request(`http://localhost/api/tickets/${ticketId}/close`, {
      method: 'POST',
      headers: headers('f1503-close-balance'),
      body: JSON.stringify({ expectedVersion: 2 }),
    }, env);
    assert.equal(close.status, 409);
    assert.equal((await close.json()).error?.code, 'TICKET_BALANCE_REMAINS');
    assert.equal(mutation, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
