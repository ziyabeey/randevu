import test from 'node:test';
import assert from 'node:assert/strict';

import { dispatchNotificationBatch, reconcileNotificationDeliveryBatch } from '../worker/notifications.ts';

const dispatchSecret = 'sssssssssssssssssssssssssssssssssssssssssss';
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  NOTIFICATION_DISPATCH_SECRET: dispatchSecret,
  PUBLIC_APP_ORIGIN: 'https://app.example.test',
  NETGSM_USERCODE: '8500000000',
  NETGSM_PASSWORD: 'netgsm-test-secret',
  NETGSM_MSGHEADER: 'KEPENK',
  NETGSM_APPNAME: 'kepenk',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function smsRow(overrides = {}) {
  return {
    job_id: 'f2690000-0000-4000-8000-000000000001',
    lease_token: 'f2690000-0000-4000-8000-000000000002',
    event_id: 'f2690000-0000-4000-8000-000000000003',
    event_version: 1,
    event_reason: 'reminder',
    template_version: 3,
    business_id: 'f2610000-0000-4000-8000-000000000001',
    group_id: 'f2650000-0000-4000-8000-000000000001',
    appointment_id: 'f2660000-0000-4000-8000-000000000001',
    recovery_id: null,
    kind: 'booking_reminder',
    channel: 'sms',
    recipient: '05551602001',
    provider: 'netgsm',
    provider_idempotency_key: 'f16/booking_reminder/f2690000-0000-4000-8000-000000000003',
    provider_reference_id: 'kepenk-f2690000000040008000000000000003',
    attempt_count: 1,
    retry_until: '2027-01-04T07:00:00.000Z',
    business_name_snapshot: 'F16 Salon',
    customer_name_snapshot: 'Bildirim Müşteri',
    starts_at_snapshot: '2027-01-04T07:00:00.000Z',
    timezone_snapshot: 'Europe/Istanbul',
    service_name_snapshot: 'Saç Kesimi',
    staff_name_snapshot: 'Ayşe',
    price_minor_snapshot: 0,
    currency_snapshot: 'TRY',
    sender_snapshot: null,
    origin_snapshot: null,
    request_fingerprint: null,
    first_provider_attempt_at: null,
    provider_idempotency_expires_at: null,
    delivery_certainty: 'unattempted',
    management_token_ciphertext: null,
    management_token_iv: null,
    key_version: null,
    ...overrides,
  };
}

function gate() {
  return {
    server_time: new Date().toISOString(),
    send_before: new Date(Date.now() + 30_000).toISOString(),
    receipt_token: 'f2690000-0000-4000-8000-000000000004',
  };
}

test('F16-02 dispatcher claims operator SMS without recovery material and completes NetGSM jobid', async () => {
  const row = smsRow();
  const calls = [];
  let lockedFingerprint = '';
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rpc/claim_notification_jobs_v3')) return json([row]);
    if (url.endsWith('/rpc/lock_notification_request_v3')) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.p_job_id, row.job_id);
      assert.equal(body.p_sender, env.NETGSM_MSGHEADER);
      assert.equal(body.p_origin, env.PUBLIC_APP_ORIGIN);
      assert.match(body.p_request_fingerprint, /^[0-9a-f]{64}$/);
      lockedFingerprint = body.p_request_fingerprint;
      return json(gate());
    }
    if (url.endsWith('/sms/rest/v2/length')) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.encoding, 11);
      assert.match(body.context, /randevu/i);
      return json({ parts: 1, charsUsed: 100, charsLeft: 788, charsLeftUntilNextPart: 55 });
    }
    if (url.endsWith('/sms/rest/v2/send')) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.messages[0].no, '5551602001');
      assert.equal(body.iysfilter, '0');
      assert.equal(body.referansID, row.provider_reference_id);
      assert.match(body.messages[0].msg, /F16 Salon/);
      return json({ code: '00', jobid: '17377215342605050417149344', description: 'success' });
    }
    if (url.endsWith('/rpc/complete_notification_job_v2')) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.p_provider_message_id, '17377215342605050417149344');
      assert.equal(body.p_request_fingerprint, lockedFingerprint);
      assert.equal(body.p_receipt_token, gate().receipt_token);
      return json(true);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await dispatchNotificationBatch(env, fakeFetch);
  assert.deepEqual(result, {
    status: 'ok',
    claimed: 1,
    sent: 1,
    retrying: 0,
    failedTerminal: 0,
    leaseErrors: 0,
  });
  assert.ok(!calls.some((url) => url.includes('get_notification_group_snapshot')));
});

test('F16-02 dispatcher terminalizes ambiguous NetGSM response loss instead of replaying', async () => {
  const row = smsRow();
  let releaseBody = null;
  let providerCalls = 0;
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rpc/claim_notification_jobs_v3')) return json([row]);
    if (url.endsWith('/rpc/lock_notification_request_v3')) return json(gate());
    if (url.endsWith('/sms/rest/v2/length')) return json({ parts: 1 });
    if (url.endsWith('/sms/rest/v2/send')) {
      providerCalls += 1;
      throw new TypeError('response lost after request write');
    }
    if (url.endsWith('/rpc/release_notification_job_v2')) {
      releaseBody = JSON.parse(String(init.body));
      return json('failed_terminal');
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await dispatchNotificationBatch(env, fakeFetch);
  assert.equal(providerCalls, 1);
  assert.equal(result.failedTerminal, 1);
  assert.equal(releaseBody.p_retryable, false);
  assert.equal(releaseBody.p_definitely_rejected, false);
  assert.equal(releaseBody.p_error_class, 'netgsm_send_network_ambiguous');
});

test('F16-02 dispatcher keeps missing NetGSM configuration retryable before provider attempt', async () => {
  const row = smsRow();
  let releaseBody = null;
  let providerCalled = false;
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rpc/claim_notification_jobs_v3')) return json([row]);
    if (url.endsWith('/rpc/release_notification_job_v2')) {
      releaseBody = JSON.parse(String(init.body));
      return json('retry_wait');
    }
    if (url.includes('api.netgsm.com.tr')) providerCalled = true;
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await dispatchNotificationBatch({
    ...env,
    NETGSM_PASSWORD: undefined,
  }, fakeFetch);
  assert.equal(providerCalled, false);
  assert.equal(result.retrying, 1);
  assert.equal(releaseBody.p_error_class, 'netgsm_not_configured');
  assert.equal(releaseBody.p_retryable, true);
  assert.equal(releaseBody.p_definitely_rejected, true);
});


test('F16-02 delivery reconciliation uses the canonical claim/report/record path', async () => {
  const recorded = [];
  let reportBody = null;
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rpc/claim_notification_delivery_checks')) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.p_limit, 50);
      return json([
        { provider_message_id: 'job-delivered', provider_reference_id: 'ref-delivered' },
        { provider_message_id: 'job-waiting', provider_reference_id: 'ref-waiting' },
        { provider_message_id: 'job-terminal', provider_reference_id: 'ref-terminal' },
      ]);
    }
    if (url.endsWith('/sms/rest/v2/report')) {
      reportBody = JSON.parse(String(init.body));
      return json({
        code: '00',
        jobs: [
          { jobid: 'job-delivered', status: 1, referansID: 'ref-delivered', errorCode: 0 },
          { jobid: 'job-waiting', status: 0, referansID: 'ref-waiting', errorCode: 0 },
          { jobid: 'job-terminal', status: 12, referansID: 'ref-terminal', errorCode: 119 },
        ],
        description: 'success',
      });
    }
    if (url.endsWith('/rpc/record_notification_delivery_status')) {
      recorded.push(JSON.parse(String(init.body)));
      return json(true);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await reconcileNotificationDeliveryBatch(env, fakeFetch);
  assert.deepEqual(reportBody.jobids, ['job-delivered', 'job-waiting', 'job-terminal']);
  assert.deepEqual(result, {
    status: 'ok',
    claimed: 3,
    recorded: 3,
    delivered: 1,
    waiting: 1,
    terminal: 1,
    recordErrors: 0,
  });
  assert.deepEqual(recorded.map((row) => [row.p_provider_message_id, row.p_status, row.p_delivered]), [
    ['job-delivered', 'delivered', true],
    ['job-waiting', 'waiting', false],
    ['job-terminal', 'sending_error', false],
  ]);
});
