import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { api, ApiRequestError, clearCsrfToken, seedCsrfToken } from '../src/api.ts';

const initialCsrf = 'a'.repeat(43);
const renewedCsrf = 'b'.repeat(43);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(t, responder) {
  clearCsrfToken();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, init = {}) => {
    const call = { path, ...init, headers: new Headers(init.headers) };
    calls.push(call);
    return responder(call, calls);
  });
  t.after(() => {
    t.mock.restoreAll();
    clearCsrfToken();
  });
  return calls;
}

function assertTypedError(status, code, message) {
  return (error) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  };
}

test('S02 client: safe reads use same-origin credentials without bootstrapping CSRF', async (t) => {
  const calls = stubFetch(t, () => json({ appointments: [] }));
  assert.deepEqual(await api('/api/calendar'), { appointments: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/calendar');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(calls[0].cache, 'no-store');
  assert.equal(calls[0].headers.get('Accept'), 'application/json');
  assert.equal(calls[0].headers.get('X-YZT-CSRF'), null);
});

test('S02 client: concurrent cookie mutations share one CSRF bootstrap', async (t) => {
  let releaseBootstrap;
  const bootstrap = new Promise((resolve) => { releaseBootstrap = resolve; });
  const calls = stubFetch(t, (call) => call.path === '/api/csrf'
    ? bootstrap
    : json({ saved: true }));
  const body = JSON.stringify({ notes: 'Aynı istek gövdesi' });

  const booking = api('/api/bookings', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'client-booking-command' },
    body,
  });
  const availability = api('/api/availability/rules', { method: 'PUT', body: '{}' });
  assert.deepEqual(calls.map((call) => call.path), ['/api/csrf']);
  releaseBootstrap(json({ csrfToken: initialCsrf }));
  assert.deepEqual(await Promise.all([booking, availability]), [{ saved: true }, { saved: true }]);

  assert.equal(calls.filter((call) => call.path === '/api/csrf').length, 1);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.cache, 'no-store');
  }
  for (const call of calls.slice(1)) {
    assert.equal(call.headers.get('X-YZT-CSRF'), initialCsrf);
    assert.equal(call.headers.get('Content-Type'), 'application/json');
  }
  const sentBooking = calls.find((call) => call.path === '/api/bookings');
  assert.equal(sentBooking.body, body);
  assert.equal(sentBooking.headers.get('Idempotency-Key'), 'client-booking-command');
});

test('S02 client: a CSRF rejection retries once with the identical booking command', async (t) => {
  let attempts = 0;
  const calls = stubFetch(t, (call) => {
    if (call.path === '/api/csrf') return json({ csrfToken: renewedCsrf });
    attempts += 1;
    return attempts === 1
      ? json({ error: { code: 'CSRF_INVALID', message: 'Güvenlik doğrulaması yenilenmeli.' } }, 403)
      : json({ appointment: { id: 'test-appointment' } });
  });
  seedCsrfToken(initialCsrf);
  const body = JSON.stringify({ staffId: 'test-staff', startsAt: '2026-09-15T10:00:00Z' });
  const result = await api('/api/bookings', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'stable-client-command' },
    body,
  });
  assert.deepEqual(result, { appointment: { id: 'test-appointment' } });
  assert.deepEqual(calls.map((call) => call.path), ['/api/bookings', '/api/csrf', '/api/bookings']);
  const mutations = calls.filter((call) => call.path === '/api/bookings');
  assert.deepEqual(mutations.map((call) => call.body), [body, body]);
  assert.deepEqual(mutations.map((call) => call.headers.get('Idempotency-Key')), [
    'stable-client-command', 'stable-client-command',
  ]);
  assert.deepEqual(mutations.map((call) => call.headers.get('X-YZT-CSRF')), [initialCsrf, renewedCsrf]);
});

test('S02 client: repeated CSRF rejection stops after one retry', async (t) => {
  const message = 'Güvenlik doğrulaması başarısız.';
  const calls = stubFetch(t, (call) => call.path === '/api/csrf'
    ? json({ csrfToken: renewedCsrf })
    : json({ error: { code: 'CSRF_INVALID', message } }, 403));
  seedCsrfToken(initialCsrf);
  await assert.rejects(api('/api/bookings', { method: 'POST', body: '{}' }),
    assertTypedError(403, 'CSRF_INVALID', message));
  assert.deepEqual(calls.map((call) => call.path), ['/api/bookings', '/api/csrf', '/api/bookings']);
});

for (const [status, code] of [
  [401, 'AUTH_REQUIRED'],
  [403, 'TENANT_REQUIRED'],
  [403, 'PASSWORD_UPDATE_REQUIRED'],
  [503, 'AUTH_UNAVAILABLE'],
]) {
  test(`S02 client: ${status} ${code} remains a typed error and is not retried`, async (t) => {
    const message = `Sunucu hatası: ${code}`;
    const calls = stubFetch(t, () => json({ error: { code, message } }, status));
    seedCsrfToken(initialCsrf);
    await assert.rejects(api('/api/bookings', { method: 'POST', body: '{}' }),
      assertTypedError(status, code, message));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get('X-YZT-CSRF'), initialCsrf);
  });
}

test('S02 client: failed CSRF bootstrap prevents the cookie mutation from being sent', async (t) => {
  const calls = stubFetch(t, () => json({ error: { code: 'AUTH_UNAVAILABLE' } }, 503));
  await assert.rejects(api('/api/bookings', { method: 'POST', body: '{}' }), (error) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'CSRF_UNAVAILABLE');
    return true;
  });
  assert.deepEqual(calls.map((call) => call.path), ['/api/csrf']);
});

test('S02 client: public create and recovery skip CSRF without changing proof or command body', async (t) => {
  const calls = stubFetch(t, () => json({ recovered: true }));
  const body = JSON.stringify({ recoveryId: 'test-recovery', recoverySecret: 'test-proof' });
  for (const path of ['/api/public/business/test-salon/book', '/api/public/booking/recover', '/api/public/booking/resolve']) {
    assert.deepEqual(await api(path, {
      method: 'POST',
      csrf: 'skip',
      headers: { 'Idempotency-Key': 'public-client-command' },
      body,
    }), { recovered: true });
  }
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.headers.get('X-YZT-CSRF'), null);
    assert.equal(call.headers.get('Idempotency-Key'), 'public-client-command');
    assert.equal(call.body, body);
    assert.equal(call.credentials, 'same-origin');
  }
});

test('S07 client: caller timeout covers response headers and body consumption', async (t) => {
  const calls = stubFetch(t, (call) => {
    if (call.path.endsWith('/headers')) {
      return new Promise((_resolve, reject) => {
        call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
      });
    }
    let streamController;
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode('{"partial":'));
      },
    });
    call.signal.addEventListener('abort', () => streamController.error(call.signal.reason), { once: true });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  for (const path of ['/api/public/booking/headers', '/api/public/booking/body']) {
    await assert.rejects(api(path, { csrf: 'skip', timeoutMs: 25 }), (error) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 0);
      assert.equal(error.code, 'REQUEST_TIMEOUT');
      return true;
    });
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
});

test('S07 client: bounded request preserves caller abort and cleans timer/listener', async (t) => {
  const caller = new AbortController();
  const signal = caller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  let adds = 0;
  let removes = 0;
  signal.addEventListener = (...args) => { adds += 1; return originalAdd(...args); };
  signal.removeEventListener = (...args) => { removes += 1; return originalRemove(...args); };
  const calls = stubFetch(t, (call) => new Promise((_resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
  }));
  const reason = new DOMException('caller stopped', 'AbortError');
  const request = api('/api/public/booking/resolve', {
    method: 'POST', csrf: 'skip', body: '{}', signal, timeoutMs: 500,
  });
  caller.abort(reason);
  await assert.rejects(request, (error) => error === reason);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[0].signal.reason, reason);
  assert.equal(adds, 1);
  assert.equal(removes, 1);

  const successfulCaller = new AbortController();
  let completedSignal;
  globalThis.fetch.mock.mockImplementation(async (_path, init) => {
    completedSignal = init.signal;
    return json({ ok: true });
  });
  assert.deepEqual(await api('/api/public/business/test-salon', {
    signal: successfulCaller.signal, timeoutMs: 15,
  }), { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(completedSignal.aborted, false);
});

test('S07 client: Retry-After is exposed on the typed API error', async (t) => {
  stubFetch(t, () => new Response(JSON.stringify({
    error: { code: 'PUBLIC_BOOKING_RATE_LIMITED', message: 'Çok fazla istek yapıldı.' },
  }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '17' },
  }));
  await assert.rejects(api('/api/public/booking/resolve', {
    method: 'POST', csrf: 'skip', body: '{}', timeoutMs: 100,
  }), (error) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 429);
    assert.equal(error.code, 'PUBLIC_BOOKING_RATE_LIMITED');
    assert.equal(error.retryAfter, 17);
    return true;
  });
});

for (const succeeds of [true, false]) {
  test(`S02 client: capability ${succeeds ? 'success' : 'failure'} keeps its token in the POST body`, async (t) => {
    const token = 'test-only-capability-token';
    const message = 'Yönetim bağlantısı geçerli değil.';
    const calls = stubFetch(t, () => succeeds
      ? json({ appointment: { id: 'test-appointment' } })
      : json({ error: { code: 'MANAGEMENT_INVALID', message } }, 403));
    const body = JSON.stringify({ token, date: '2026-09-15' });
    const paths = ['/api/manage/view', '/api/manage/slots', '/api/manage/reschedule', '/api/manage/cancel'];
    for (const path of paths) {
      const operation = api(path, {
        method: 'POST',
        csrf: 'skip',
        headers: { 'Idempotency-Key': 'manage-client-command' },
        body,
      });
      if (succeeds) assert.deepEqual(await operation, { appointment: { id: 'test-appointment' } });
      else await assert.rejects(operation, assertTypedError(403, 'MANAGEMENT_INVALID', message));
    }
    assert.deepEqual(calls.map((call) => call.path), paths);
    for (const call of calls) {
      assert.equal(call.method, 'POST');
      assert.equal(call.body, body);
      assert.equal(JSON.parse(call.body).token, token);
      assert.equal(call.path.includes(token), false);
      assert.equal(new URL(call.path, 'https://example.test').search, '');
      assert.equal(call.headers.get('X-YZT-CSRF'), null);
      assert.equal(call.headers.get('Idempotency-Key'), 'manage-client-command');
      assert.equal(call.credentials, 'same-origin');
    }
  });
}

test('S02 client: migrated feature pages import the shared API and have no local fetch path', async () => {
  const pages = [
    'AvailabilityPage.tsx', 'BookingPage.tsx', 'CalendarPage.tsx',
    'PublicBookingSettingsPage.tsx', 'PublicBookingPage.tsx', 'ManageAppointmentPage.tsx',
  ];
  for (const page of pages) {
    // This is only a wiring guard; the behavior above runs api.ts itself.
    // Browser acceptance remains responsible for the rendered feature flows.
    const source = await readFile(new URL(`../src/${page}`, import.meta.url), 'utf8');
    assert.match(source, /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*['"]\.\/api['"]/,
      `${page} must import the shared API contract tested above`);
    assert.doesNotMatch(source, /\bfetch\s*\(/,
      `${page} must not bypass the shared credential/CSRF/error contract`);
  }
});
