import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyIyzicoSandboxNotification } from '../worker/iyzico-sandbox-webhook.ts';

// Only fabricated credentials and locally generated payloads. Never use process.env.
const env = { IYZICO_SANDBOX_SECRET_KEY:'sandbox-fake-secret' };
const expected = () => ({conversationId:'attempt-a',token:'token-a'});
const body = (delta = {}) => ({iyziEventType:'CHECKOUT_FORM_AUTH',iyziPaymentId:12345,
  paymentConversationId:'attempt-a',token:'token-a',status:'SUCCESS',merchantId:'999999',
  iyziEventTime:1700000000000,iyziReferenceCode:'reference-fixture',...delta});
const sign = (p, secret = env.IYZICO_SANDBOX_SECRET_KEY) => createHmac('sha256',secret)
  .update(secret + p.iyziEventType + p.iyziPaymentId + p.token + p.paymentConversationId + p.status,'utf8').digest('hex');
const verify = (p = body(), e = expected(), signature = sign(p)) =>
  verifyIyzicoSandboxNotification(env,signature,JSON.stringify(p),e);
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw Error('OFFLINE_ONLY'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls,0); });

test('IYZ-01A HPP V3 verifies independent Node HMAC and returns retrieval hint only', async () => {
  const r = await verify();
  assert.deepEqual(r,{ok:true,value:{kind:'verified_sandbox_notification',paymentId:'12345',
    conversationId:'attempt-a',token:'token-a',eventStatus:'SUCCESS',nextAction:'retrieve_payment'}});
  assert.equal(networkCalls,0);
});

test('IYZ-01A numeric and decimal-string provider IDs produce the same HPP signature', async () => {
  assert.deepEqual(await verify(body({iyziPaymentId:'12345'})),await verify());
  const big = body({iyziPaymentId:'9007199254740993'});
  assert.equal((await verify(big)).value.paymentId,'9007199254740993');
});

test('IYZ-01A SUCCESS and delayed FAILURE both require fresh retrieval, neither writes payment', async () => {
  for (const status of ['SUCCESS','FAILURE']) {
    const result = await verify(body({status}));
    assert.equal(result.ok,true);
    assert.equal(result.value.eventStatus,status);
    assert.equal(result.value.nextAction,'retrieve_payment');
    assert.equal('amountMinor' in result.value,false);
    assert.equal('paid' in result.value,false);
  }
});

test('IYZ-01A signed but unsupported or mismatched notifications fail closed', async (t) => {
  for (const [name, delta] of [
    ['direct API event',{iyziEventType:'PAYMENT_API'}],
    ['wallet event',{iyziEventType:'PWI_TKN_AUTH'}],
    ['subscription event',{iyziEventType:'subscription.order.success'}],
    ['intermediate status',{status:'INIT_THREEDS'}],
    ['unknown status',{status:'REFUNDED'}],['boolean status',{status:true}],
    ['other attempt',{paymentConversationId:'attempt-b'}],
    ['other token',{token:'token-b'}],
    ['unsafe numeric payment ID',{iyziPaymentId:9007199254740992}],
    ['zero payment ID',{iyziPaymentId:0}],['negative payment ID',{iyziPaymentId:-3}],
    ['fractional payment ID',{iyziPaymentId:1.2}],['padded payment ID',{iyziPaymentId:'012345'}],
    ['exponent ID',{iyziPaymentId:'1e3'}],['null ID',{iyziPaymentId:null}],
    ['missing ID',{iyziPaymentId:undefined}],['missing token',{token:undefined}],
  ]) await t.test(name, async () => {
    assert.deepEqual(await verify(body(delta)),{ok:false,code:'INVALID_NOTIFICATION'});
  });
});

test('IYZ-01A every HPP-signed field is verified', async (t) => {
  const original = body(), signature = sign(original);
  for (const [field,value] of Object.entries({iyziEventType:'PAYMENT_API',iyziPaymentId:12346,
    token:'token-b',paymentConversationId:'attempt-b',status:'FAILURE'})) {
    await t.test(field,async () => {
      const changed={...original,[field]:value};
      // Match expected identity to altered values to exercise HMAC, not only binding rejection.
      const e={conversationId:changed.paymentConversationId,token:changed.token};
      assert.deepEqual(await verify(changed,e,signature),{ok:false,code:'INVALID_NOTIFICATION'});
    });
  }
});

test('IYZ-01A V3 is mandatory; wrong key and response-style signature never pass', async () => {
  const p=body();
  const colonMac=createHmac('sha256',env.IYZICO_SANDBOX_SECRET_KEY).update([
    env.IYZICO_SANDBOX_SECRET_KEY,p.iyziEventType,p.iyziPaymentId,p.token,p.paymentConversationId,p.status].join(':')).digest('hex');
  const noPrefix=createHmac('sha256',env.IYZICO_SANDBOX_SECRET_KEY)
    .update(p.iyziEventType+p.iyziPaymentId+p.token+p.paymentConversationId+p.status).digest('hex');
  for (const signature of [null,'',0,'a'.repeat(64),'g'.repeat(64),sign(p,'other-fake-secret'),colonMac,noPrefix]) {
    assert.deepEqual(await verifyIyzicoSandboxNotification(env,signature,JSON.stringify(p),expected()),
      {ok:false,code:'INVALID_NOTIFICATION'});
  }
  assert.equal((await verify(p,expected(),sign(p).toUpperCase())).ok,true);
  // An older header merely embedded in the JSON cannot replace a missing V3 header.
  assert.deepEqual(await verifyIyzicoSandboxNotification(env,undefined,JSON.stringify({...p,'X-Iyz-Signature-V2':sign(p)}),expected()),
    {ok:false,code:'INVALID_NOTIFICATION'});
});

test('IYZ-01A bounded JSON parsing rejects malformed and oversized UTF-8 input', async () => {
  for (const raw of [null,{},'', 'null','[]','false','bad json',' '.repeat(16*1024+1),
    JSON.stringify(body({ignored:'ğ'.repeat(9000)}))]) {
    assert.deepEqual(await verifyIyzicoSandboxNotification(env,sign(body()),raw,expected()),
      {ok:false,code:'INVALID_NOTIFICATION'});
  }
});

test('IYZ-01A unsigned metadata and untrusted monetary hints never become authority', async () => {
  const p=body(), reference=await verify(p);
  const changed={...p,merchantId:'different-merchant',iyziReferenceCode:'changed-reference',iyziEventTime:0,
    amountMinor:1,currency:'USD',paid:true,businessId:'another-business',ticketId:'another-ticket'};
  assert.deepEqual(await verify(changed,expected(),sign(p)),reference);
  // HPP does not cover those metadata fields; they are deliberately absent from the result.
  for (const key of ['merchantId','iyziReferenceCode','iyziEventTime','businessId','ticketId','amountMinor','currency','paid']) {
    assert.equal(key in reference.value,false);
  }
});

test('IYZ-01A a persisted provider payment ID cannot be substituted', async () => {
  assert.equal((await verify(body(),{...expected(),paymentId:'12345'})).ok,true);
  assert.deepEqual(await verify(body(),{...expected(),paymentId:'99999'}),{ok:false,code:'INVALID_NOTIFICATION'});
});

test('IYZ-01A invalid trusted configuration and attempt fail without secret reflection', async () => {
  for (const key of ['',undefined,' bad-key','bad\nkey','x'.repeat(513)]) {
    assert.deepEqual(await verifyIyzicoSandboxNotification({IYZICO_SANDBOX_SECRET_KEY:key},sign(body()),JSON.stringify(body()),expected()),
      {ok:false,code:'INVALID_INPUT'});
  }
  for (const e of [null,{}, {...expected(),conversationId:'a:b'}, {...expected(),token:'a b'},
    {...expected(),paymentId:12345},{...expected(),paymentId:'0'},{...expected(),unknown:'value'}]) {
    assert.deepEqual(await verify(body(),e),{ok:false,code:'INVALID_INPUT'});
  }
});

test('IYZ-01A caller mutation during async crypto cannot rewrite returned bindings', async () => {
  const e=expected(), settings={...env},p=body();
  const pending=verifyIyzicoSandboxNotification(settings,sign(p),JSON.stringify(p),e);
  e.conversationId='attempt-b';e.token='token-b';settings.IYZICO_SANDBOX_SECRET_KEY='another-secret';
  const r=await pending;
  assert.equal(r.ok,true);assert.equal(r.value.conversationId,'attempt-a');assert.equal(r.value.token,'token-a');
});

test('IYZ-01A repeated deliveries remain identical hints, not deduplication or durable acceptance', async () => {
  const results=await Promise.all([verify(),verify(),verify()]);
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
  assert.equal(networkCalls,0);
});
