import test from 'node:test';
import assert from 'node:assert/strict';

import {
  netgsmConfigured,
  normalizeNetgsmRecipient,
  sendNetgsmSms,
} from '../worker/netgsm.ts';

const env = {
  NETGSM_USERCODE: '8500000000',
  NETGSM_PASSWORD: 'test-secret',
  NETGSM_MSGHEADER: 'KEPENK',
  NETGSM_APPNAME: 'kepenk',
};

test('F16-02 NetGSM config and Turkish recipient normalization fail closed', () => {
  assert.ok(netgsmConfigured(env));
  assert.equal(normalizeNetgsmRecipient('+90 555 160 2001'), '5551602001');
  assert.equal(normalizeNetgsmRecipient('05551602001'), '5551602001');
  assert.equal(normalizeNetgsmRecipient('5551602001'), '5551602001');
  assert.equal(normalizeNetgsmRecipient('+44 7700 900123'), null);
  assert.equal(netgsmConfigured({ ...env, NETGSM_MSGHEADER: 'X' }), null);
});

test('F16-02 NetGSM accepted send is preflighted and returns provider jobid', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/length')) {
      return new Response(JSON.stringify({
        parts: 2,
        charsUsed: 200,
        charsLeft: 688,
        charsLeftUntilNextPart: 96,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      code: '00',
      jobid: '17377215342605050417149344',
      description: 'success',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await sendNetgsmSms(env, {
    recipient: '+905551602001',
    message: 'Randevunuz yarın 10:00.',
    referenceId: 'kepenk-12345678',
  }, fetchImpl);

  assert.deepEqual(result, {
    status: 'accepted',
    providerMessageId: '17377215342605050417149344',
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/sms/rest/v2/length'));
  assert.ok(calls[1].url.endsWith('/sms/rest/v2/send'));
  assert.match(new Headers(calls[1].init.headers).get('Authorization') ?? '', /^Basic /);

  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.msgheader, 'KEPENK');
  assert.equal(body.messages[0].no, '5551602001');
  assert.equal(body.encoding, 'TR');
  assert.equal(body.iysfilter, '0');
  assert.equal(body.referansID, 'kepenk-12345678');
});

test('F16-02 NetGSM segment limit blocks provider send before side effect', async () => {
  let sends = 0;
  const result = await sendNetgsmSms(env, {
    recipient: '05551602001',
    message: 'uzun mesaj',
    referenceId: 'kepenk-87654321',
  }, async (url) => {
    if (String(url).endsWith('/length')) {
      return new Response(JSON.stringify({ parts: 7 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    sends += 1;
    return new Response(JSON.stringify({ code: '00', jobid: 'should-not-send' }), { status: 200 });
  });

  assert.equal(sends, 0);
  assert.deepEqual(result, {
    status: 'failed',
    errorClass: 'netgsm_segment_limit_exceeded',
    retryable: false,
    definitelyRejected: true,
  });
});

test('F16-02 NetGSM response loss after send is ambiguous and never auto-retryable', async () => {
  let call = 0;
  const result = await sendNetgsmSms(env, {
    recipient: '5551602001',
    message: 'Randevunuz güncellendi.',
    referenceId: 'kepenk-ambiguous',
  }, async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({ parts: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new TypeError('socket closed after request write');
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, false);
  assert.equal(result.definitelyRejected, false);
  assert.equal(result.errorClass, 'netgsm_send_network_ambiguous');
});

test('F16-02 NetGSM known rate rejection is safe to retry within queue bounds', async () => {
  let call = 0;
  const result = await sendNetgsmSms(env, {
    recipient: '5551602001',
    message: 'Randevunuz güncellendi.',
    referenceId: 'kepenk-rate-limit',
  }, async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({ parts: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ code: '80', description: 'limit' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.definitelyRejected, true);
  assert.equal(result.errorClass, 'netgsm_80');
  assert.equal(result.retryAfterSeconds, 60);
});
