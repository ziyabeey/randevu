import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import entry from '../worker/entry.ts';
import { dispatchNotificationBatch } from '../worker/notifications.ts';
import {
  OutboundRequestTimeoutError,
  fetchTextWithTimeout,
} from '../worker/outbound-request.ts';

const dispatchSecret = 'sssssssssssssssssssssssssssssssssssssssssss';
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const managementToken = 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';
const recoveryId = '8c000000-0000-4000-8000-000000000007';
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
  NOTIFICATION_DISPATCH_SECRET: dispatchSecret,
  RESEND_API_KEY: 're_test_key',
  NOTIFICATION_FROM_EMAIL: 'Randevu <randevu@example.test>',
  PUBLIC_APP_ORIGIN: 'https://app.example.test',
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

function hangingBody(init = {}) {
  let streamController;
  const body = new ReadableStream({
    start(controller) {
      streamController = controller;
      controller.enqueue(new TextEncoder().encode('{"partial":'));
    },
  });
  init.signal?.addEventListener('abort', () => streamController.error(init.signal.reason), { once: true });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function encryptedMaterial(token, id) {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(Buffer.from(encryptionKey, 'base64url')),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = new Uint8Array(12);
  iv.fill(7);
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`public-booking-recovery:v1|${id}`),
  }, key, new TextEncoder().encode(token));
  return {
    ciphertext: Buffer.from(encrypted).toString('base64url'),
    iv: Buffer.from(iv).toString('base64url'),
  };
}

async function claimRow(overrides = {}) {
  const encrypted = await encryptedMaterial(managementToken, recoveryId);
  return {
    job_id: '9c000000-0000-4000-8000-000000000007',
    lease_token: 'aa000000-0000-4000-8000-000000000007',
    event_id: 'bb000000-0000-4000-8000-000000000007',
    event_version: 1,
    template_version: 1,
    appointment_id: 'ac000000-0000-4000-8000-000000000007',
    recovery_id: recoveryId,
    recipient: 'notify@example.test',
    provider: 'resend',
    channel: 'email',
    kind: 'public_booking_confirmation',
    event_reason: 'created',
    provider_reference_id: null,
    provider_idempotency_key: 'public-booking-confirmation/bb000000-0000-4000-8000-000000000007',
    attempt_count: 1,
    retry_until: '2026-09-18T07:05:00.000Z',
    business_name_snapshot: 'S07 Test',
    customer_name_snapshot: 'S07 Müşteri',
    starts_at_snapshot: '2026-09-15T07:05:00.000Z',
    timezone_snapshot: 'Europe/Istanbul',
    service_name_snapshot: 'S07 Hizmeti',
    staff_name_snapshot: 'S07 Ayşe',
    price_minor_snapshot: 210000,
    currency_snapshot: 'TRY',
    sender_snapshot: null,
    origin_snapshot: null,
    request_fingerprint: null,
    first_provider_attempt_at: null,
    provider_idempotency_expires_at: null,
    delivery_certainty: 'unattempted',
    management_token_ciphertext: encrypted.ciphertext,
    management_token_iv: encrypted.iv,
    key_version: 1,
    ...overrides,
  };
}

function sendPermission(overrides = {}) {
  return {
    server_time: new Date().toISOString(),
    send_before: new Date(Date.now() + 30_000).toISOString(),
    receipt_token: 'cc000000-0000-4000-8000-000000000107',
    ...overrides,
  };
}

test('S07 outbound request timeout covers native fetch headers and body consumption', async (t) => {
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/body') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"partial":');
      return;
    }
    if (request.url === '/ok') {
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    if (request.url === '/error') {
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.end('unavailable');
    }
    // /headers intentionally never sends a response.
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  await assert.rejects(
    fetchTextWithTimeout(`${origin}/headers`, {}, fetch, 50),
    OutboundRequestTimeoutError,
  );
  await assert.rejects(
    fetchTextWithTimeout(`${origin}/body`, {}, fetch, 50),
    OutboundRequestTimeoutError,
  );

  const success = await fetchTextWithTimeout(`${origin}/ok`, {}, fetch, 500);
  assert.equal(success.response.status, 201);
  assert.equal(success.bodyText, '{"ok":true}');
  const failure = await fetchTextWithTimeout(`${origin}/error`, {}, fetch, 500);
  assert.equal(failure.response.status, 503);
  assert.equal(failure.bodyText, 'unavailable');
});

test('S07 outbound request preserves caller abort and cleans its caller listener', async () => {
  const caller = new AbortController();
  const signal = caller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  let adds = 0;
  let removes = 0;
  signal.addEventListener = (...args) => {
    adds += 1;
    return originalAdd(...args);
  };
  signal.removeEventListener = (...args) => {
    removes += 1;
    return originalRemove(...args);
  };
  let forwardedSignal;
  const reason = new DOMException('caller stopped', 'AbortError');
  const request = fetchTextWithTimeout('https://example.test/hang', { signal }, async (_input, init) => {
    forwardedSignal = init.signal;
    return abortableHang(init);
  }, 500);
  caller.abort(reason);
  await assert.rejects(request, (error) => error === reason);
  assert.equal(forwardedSignal.aborted, true);
  assert.equal(forwardedSignal.reason, reason);
  assert.equal(adds, 1);
  assert.equal(removes, 1);

  const successfulCaller = new AbortController();
  let successfulAdds = 0;
  let successfulRemoves = 0;
  const successfulAdd = successfulCaller.signal.addEventListener.bind(successfulCaller.signal);
  const successfulRemove = successfulCaller.signal.removeEventListener.bind(successfulCaller.signal);
  successfulCaller.signal.addEventListener = (...args) => {
    successfulAdds += 1;
    return successfulAdd(...args);
  };
  successfulCaller.signal.removeEventListener = (...args) => {
    successfulRemoves += 1;
    return successfulRemove(...args);
  };
  let completedSignal;
  await fetchTextWithTimeout('https://example.test/ok', { signal: successfulCaller.signal }, async (_input, init) => {
    completedSignal = init.signal;
    return json({ ok: true });
  }, 15);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(completedSignal.aborted, false, 'successful completion clears the deadline timer');
  assert.equal(successfulAdds, 1);
  assert.equal(successfulRemoves, 1);
});

test('S07 notification DB deadlines prevent unsafe or unbounded provider progress', async (t) => {
  await t.test('claim timeout prevents provider calls', async (t) => {
    const deadlineWasArmed = shortenTenSecondDeadline(t);
    let providerCalls = 0;
    const summary = await dispatchNotificationBatch(env, async (input, init) => {
      if (String(input) === 'https://api.resend.com/emails') providerCalls += 1;
      return abortableHang(init);
    });
    assert.equal(summary.status, 'claim_failed');
    assert.equal(providerCalls, 0);
    deadlineWasArmed();
  });

  await t.test('lock body timeout prevents provider calls', async (t) => {
    const deadlineWasArmed = shortenTenSecondDeadline(t);
    const row = await claimRow();
    let providerCalls = 0;
    let lockCalls = 0;
    const summary = await dispatchNotificationBatch(env, async (input, init) => {
      const url = String(input);
      if (url.endsWith('/rpc/claim_notification_jobs_v3')) return json([row]);
      if (url.endsWith('/rpc/lock_notification_request_v3')) {
        lockCalls += 1;
        return hangingBody(init);
      }
      if (url === 'https://api.resend.com/emails') providerCalls += 1;
      throw new Error(`unexpected fetch ${url}`);
    });
    assert.equal(summary.leaseErrors, 1);
    assert.equal(lockCalls, 1);
    assert.equal(providerCalls, 0);
    deadlineWasArmed();
  });

  for (const finalRpc of ['complete_notification_job_v2', 'release_notification_job_v2']) {
    await t.test(`${finalRpc} timeout bounds the batch`, async (t) => {
      const deadlineWasArmed = shortenTenSecondDeadline(t);
      const row = await claimRow();
      let providerCalls = 0;
      let finalCalls = 0;
      let finalSignal;
      const summary = await dispatchNotificationBatch(env, async (input, init) => {
        const url = String(input);
        if (url.endsWith('/rpc/claim_notification_jobs_v3')) return json([row]);
        if (url.endsWith('/rpc/lock_notification_request_v3')) return json(sendPermission());
        if (url === 'https://api.resend.com/emails') {
          providerCalls += 1;
          return finalRpc.startsWith('complete')
            ? json({ id: 'resend-s07-success' })
            : json({ name: 'validation_error' }, 400);
        }
        if (url.endsWith(`/rpc/${finalRpc}`)) {
          finalCalls += 1;
          finalSignal = init.signal;
          return abortableHang(init);
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      assert.equal(summary.leaseErrors, 1);
      assert.equal(summary.sent, 0);
      assert.equal(providerCalls, 1);
      assert.equal(finalCalls, 1);
      assert.equal(finalSignal.aborted, true);
      deadlineWasArmed();
    });
  }

  await t.test('a delayed send permission cannot start provider delivery', async () => {
    const row = await claimRow();
    let providerCalls = 0;
    const summary = await dispatchNotificationBatch(env, async (input) => {
      const url = String(input);
      if (url.endsWith('/rpc/claim_notification_jobs_v3')) return json([row]);
      if (url.endsWith('/rpc/lock_notification_request_v3')) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json(sendPermission({
          server_time: new Date(Date.now() - 25).toISOString(),
          send_before: new Date(Date.now() - 1).toISOString(),
        }));
      }
      if (url === 'https://api.resend.com/emails') providerCalls += 1;
      throw new Error(`unexpected fetch ${url}`);
    });
    assert.equal(summary.leaseErrors, 1);
    assert.equal(providerCalls, 0);
  });
});

test('S07 scheduled work starts maintenance, dispatch and heartbeat independently', async (t) => {
  const calls = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let releaseMaintenanceDeadline;
  let productionDeadlines = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 10_000) {
      productionDeadlines += 1;
      const handle = realSetTimeout(callback, 1_000, ...args);
      if (!releaseMaintenanceDeadline) {
        releaseMaintenanceDeadline = () => {
          realClearTimeout(handle);
          callback(...args);
        };
      }
      return handle;
    }
    return realSetTimeout(callback, delay, ...args);
  });
  let resolveClaimStarted;
  const claimStarted = new Promise((resolve) => {
    resolveClaimStarted = resolve;
  });
  let maintenanceSignal;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rpc/maintain_notification_jobs')) {
      maintenanceSignal = init.signal;
      return abortableHang(init);
    }
    if (url.endsWith('/rpc/claim_notification_jobs_v3')) {
      resolveClaimStarted();
      return json([]);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  t.after(() => t.mock.restoreAll());
  const pending = [];
  entry.scheduled({}, env, { waitUntil: (promise) => pending.push(promise) });
  assert.equal(pending.length, 3);
  let guard;
  try {
    await Promise.race([
      claimStarted,
      new Promise((_, reject) => {
        guard = realSetTimeout(() => reject(new Error('dispatch claim did not start')), 1_000);
      }),
    ]);
  } finally {
    realClearTimeout(guard);
  }
  assert.equal(maintenanceSignal.aborted, false, 'dispatch starts while maintenance is still pending');
  assert.ok(calls.some((url) => url.endsWith('/rpc/maintain_notification_jobs')));
  assert.ok(calls.some((url) => url.endsWith('/rpc/claim_notification_jobs_v3')));
  releaseMaintenanceDeadline();
  await Promise.all(pending);
  assert.ok(productionDeadlines >= 2, 'maintenance and claim each arm the production deadline');
});
