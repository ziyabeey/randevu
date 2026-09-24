import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTwilioRecipient,
  queryTwilioMessageStatus,
  sendTwilioSms,
  twilioConfigured,
} from '../worker/twilio.ts';

const trialEnv = {
  TWILLO_ID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  TWILLO_SECRET_API: 'test-auth-token-1234567890',
  TWILIO_TRIAL_MODE: 'true',
};

test('F16-02 Twilio accepts the configured legacy secret aliases and normalizes Turkish recipients', () => {
  const config = twilioConfigured(trialEnv);
  assert.ok(config);
  assert.equal(config.accountSid, trialEnv.TWILLO_ID);
  assert.equal(config.trialMode, true);
  assert.equal(config.senderLabel, 'twilio-trial-managed');
  assert.equal(normalizeTwilioRecipient('05551602001'), '+905551602001');
  assert.equal(normalizeTwilioRecipient('5551602001'), '+905551602001');
  assert.equal(normalizeTwilioRecipient('+905551602001'), '+905551602001');
});

test('F16-02 Twilio trial send uses the appointment reminder template and no production sender', async () => {
  let request = null;
  const result = await sendTwilioSms(trialEnv, {
    recipient: '05551602001',
    message: 'Kepenk canonical product copy is intentionally not sent in trial mode.',
  }, async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      sid: 'SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'queued',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });

  assert.deepEqual(result, {
    status: 'accepted',
    providerMessageId: 'SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  assert.equal(request.url, 'https://api.twilio.com/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages.json');
  assert.match(new Headers(request.init.headers).get('Authorization') ?? '', /^Basic /);
  const body = new URLSearchParams(String(request.init.body));
  assert.equal(body.get('To'), '+905551602001');
  assert.equal(body.get('Body'), 'sms_appointment_reminders');
  assert.equal(body.has('From'), false);
  assert.equal(body.has('MessagingServiceSid'), false);
});

test('F16-02 Twilio production send keeps canonical product copy and explicit sender', async () => {
  let body = null;
  const result = await sendTwilioSms({
    TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    TWILIO_AUTH_TOKEN: 'test-auth-token-1234567890',
    TWILIO_FROM: 'KEPENK',
  }, {
    recipient: '+905551602001',
    message: 'Kepenk: randevunuz yarın 10:00.',
  }, async (_url, init) => {
    body = new URLSearchParams(String(init.body));
    return new Response(JSON.stringify({
      sid: 'SMcccccccccccccccccccccccccccccccc',
      status: 'queued',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });

  assert.equal(result.status, 'accepted');
  assert.equal(body.get('Body'), 'Kepenk: randevunuz yarın 10:00.');
  assert.equal(body.get('From'), 'KEPENK');
});

test('F16-02 Twilio response loss is ambiguous and never automatically replayable', async () => {
  const result = await sendTwilioSms(trialEnv, {
    recipient: '+905551602001',
    message: 'appointment reminder',
  }, async () => {
    throw new TypeError('connection lost after write');
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, false);
  assert.equal(result.definitelyRejected, false);
  assert.equal(result.errorClass, 'twilio_send_network_ambiguous');
});

test('F16-02 Twilio delivery lookup maps provider states into the shared reconciliation vocabulary', async () => {
  const delivered = await queryTwilioMessageStatus(
    trialEnv,
    'SMdddddddddddddddddddddddddddddddd',
    async (url, init) => {
      assert.equal(init.method, 'GET');
      assert.ok(String(url).endsWith('/Messages/SMdddddddddddddddddddddddddddddddd.json'));
      return new Response(JSON.stringify({
        sid: 'SMdddddddddddddddddddddddddddddddd',
        status: 'delivered',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  );
  assert.deepEqual(delivered, {
    status: 'ok',
    providerMessageId: 'SMdddddddddddddddddddddddddddddddd',
    providerStatus: 'delivered',
    delivered: true,
    waiting: false,
  });

  const waiting = await queryTwilioMessageStatus(
    trialEnv,
    'SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    async () => new Response(JSON.stringify({
      sid: 'SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      status: 'sent',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  assert.equal(waiting.status, 'ok');
  assert.equal(waiting.providerStatus, 'waiting');
  assert.equal(waiting.delivered, false);
});
