import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { supabaseRequest } from '../worker/auth.ts';
import bookingRecovery from '../worker/public-booking-recovery.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
};

const publishedInformation = {
  kvkk_notice_text: 'Test işletmesi aydınlatma metni.',
  kvkk_notice_url: 'https://example.test/kvkk',
  privacy_policy_url: 'https://example.test/privacy',
  booking_terms_text: 'Test işletmesi randevu koşulları.',
  booking_terms_url: 'https://example.test/terms',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function shortenTenSecondDeadline(t, milliseconds = 30) {
  const realSetTimeout = globalThis.setTimeout;
  let deadlines = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 10_000) {
      deadlines += 1;
      return realSetTimeout(callback, milliseconds, ...args);
    }
    return realSetTimeout(callback, delay, ...args);
  });
  return () => assert.ok(deadlines > 0, 'the production 10 second deadline was armed');
}

function abortableHang(init = {}) {
  return new Promise((_, reject) => {
    const signal = init.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function hangingBody(init = {}, onAbort = () => undefined) {
  let streamController;
  const body = new ReadableStream({
    start(controller) {
      streamController = controller;
      controller.enqueue(new TextEncoder().encode('{"partial":'));
    },
  });
  init.signal?.addEventListener('abort', () => {
    onAbort(init.signal.reason);
    streamController.error(init.signal.reason);
  }, { once: true });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function setCookieValues(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function assertSessionCookiesPreserved(response) {
  const values = setCookieValues(response).join('\n');
  assert.doesNotMatch(values, /yzt_access=;.*max-age=0/i);
  assert.doesNotMatch(values, /yzt_refresh=;.*max-age=0/i);
  assert.doesNotMatch(values, /yzt_business=;.*max-age=0/i);
}

await test('S07 common Supabase transport bounds headers and body without retrying writes', async (t) => {
  await t.test('header timeout becomes status zero and aborts the one fetch', async (t) => {
    const deadlineWasArmed = shortenTenSecondDeadline(t);
    let calls = 0;
    let forwardedSignal;
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      calls += 1;
      forwardedSignal = init.signal;
      return abortableHang(init);
    });

    const result = await supabaseRequest(env, 'rest/v1/rpc/write_once', {
      method: 'POST',
      body: '{}',
    });

    assert.deepEqual(result, { ok: false, status: 0, data: null });
    assert.equal(calls, 1, 'a timed-out write was retried');
    assert.equal(forwardedSignal.aborted, true);
    deadlineWasArmed();
  });

  await t.test('body timeout cancels consumption and remains status zero', async (t) => {
    const deadlineWasArmed = shortenTenSecondDeadline(t);
    let calls = 0;
    let bodyAbortReason;
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      calls += 1;
      return hangingBody(init, (reason) => { bodyAbortReason = reason; });
    });

    const result = await supabaseRequest(env, 'rest/v1/appointments?select=id');

    assert.deepEqual(result, { ok: false, status: 0, data: null });
    assert.equal(calls, 1);
    assert.equal(bodyAbortReason?.name, 'OutboundRequestTimeoutError');
    deadlineWasArmed();
  });

  await t.test('success preserves parsing, caller listener cleanup and a cleared timer', async (t) => {
    shortenTenSecondDeadline(t);
    const caller = new AbortController();
    const signal = caller.signal;
    const realAdd = signal.addEventListener.bind(signal);
    const realRemove = signal.removeEventListener.bind(signal);
    let adds = 0;
    let removes = 0;
    signal.addEventListener = (...args) => {
      adds += 1;
      return realAdd(...args);
    };
    signal.removeEventListener = (...args) => {
      removes += 1;
      return realRemove(...args);
    };
    let forwardedSignal;
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      forwardedSignal = init.signal;
      return json({ rows: [1] }, 201);
    });

    const result = await supabaseRequest(env, 'rest/v1/rpc/read_once', { signal });
    await new Promise((resolve) => setTimeout(resolve, 45));

    assert.deepEqual(result, { ok: true, status: 201, data: { rows: [1] } });
    assert.equal(forwardedSignal.aborted, false, 'successful response left its deadline armed');
    assert.equal(adds, 1);
    assert.equal(removes, 1);
  });

  await t.test('caller abort reaches the fetch and is cleaned up', async (t) => {
    const deadlineWasArmed = shortenTenSecondDeadline(t, 500);
    const caller = new AbortController();
    const signal = caller.signal;
    const realAdd = signal.addEventListener.bind(signal);
    const realRemove = signal.removeEventListener.bind(signal);
    let adds = 0;
    let removes = 0;
    signal.addEventListener = (...args) => {
      adds += 1;
      return realAdd(...args);
    };
    signal.removeEventListener = (...args) => {
      removes += 1;
      return realRemove(...args);
    };
    let forwardedSignal;
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      forwardedSignal = init.signal;
      return abortableHang(init);
    });

    const pending = supabaseRequest(env, 'rest/v1/rpc/write_once', {
      method: 'POST', body: '{}', signal,
    });
    const reason = new DOMException('caller stopped', 'AbortError');
    caller.abort(reason);
    const result = await pending;

    assert.deepEqual(result, { ok: false, status: 0, data: null });
    assert.equal(forwardedSignal.aborted, true);
    assert.equal(forwardedSignal.reason, reason);
    assert.equal(adds, 1);
    assert.equal(removes, 1);
    deadlineWasArmed();
  });
});

await test('S07 timed-out refresh body preserves the browser session cookies', async (t) => {
  const deadlineWasArmed = shortenTenSecondDeadline(t);
  const calls = [];
  let refreshSignal;
  let refreshBodyAborted = false;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/auth/v1/user') return json({ message: 'expired' }, 401);
    if (path === '/auth/v1/token') {
      refreshSignal = init.signal;
      return hangingBody(init, () => { refreshBodyAborted = true; });
    }
    throw new Error(`unexpected refresh fetch ${path}`);
  });

  const response = await app.request('http://localhost/api/calendar?date=2026-09-14&days=1', {
    headers: {
      Cookie: [
        'yzt_access=expired-access',
        'yzt_refresh=refresh-token-one',
        'yzt_business=20000000-0000-4000-8000-000000000001',
      ].join('; '),
    },
  }, env);

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error?.code, 'AUTH_UNAVAILABLE');
  assert.deepEqual(calls, ['/auth/v1/user', '/auth/v1/token']);
  assert.equal(refreshSignal.aborted, true);
  assert.equal(refreshBodyAborted, true);
  assertSessionCookiesPreserved(response);
  deadlineWasArmed();
});

await test('S07 legacy first-create cutover error is mapped without another request', async (t) => {
  const bookingEnv = {
    ...env,
    MANAGEMENT_LINK_ENCRYPTION_KEY_V1: 'A'.repeat(43),
    PUBLIC_BOOKING_GATE_SECRET: 'g'.repeat(43),
  };
  const recoveryId = '8c000000-0000-4000-8000-000000000230';
  const key = 's07-legacy-client-cutover-0001';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    calls += 1;
    const wire = JSON.parse(String(init.body));
    if (wire.p_action === 'profile') return json({ ok: true, data: [publishedInformation] });
    assert.equal(wire.p_action, 'book');
    assert.equal(wire.p_args.p_idempotency_key, key);
    return json({ ok: false, error: { message: 'BOOKING_CLIENT_UPDATE_REQUIRED' } });
  });

  const response = await bookingRecovery.request('http://localhost/business/s07-salon/book', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.230',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      customerName: 'Legacy Client',
      customerPhone: '05550000230',
      customerEmail: 'legacy-cutover@example.test',
      notes: null,
      serviceId: '6c000000-0000-4000-8000-000000000230',
      staffId: '7c000000-0000-4000-8000-000000000230',
      startsAt: '2026-09-20T09:00:00.000Z',
      managementToken: 'm'.repeat(43),
      recoveryId,
      recoverySecret: 'r'.repeat(43),
    }),
  }, bookingEnv);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error?.code, 'BOOKING_CLIENT_UPDATE_REQUIRED');
  assert.equal(calls, 2, 'cutover response retried the profile/create sequence');
});
