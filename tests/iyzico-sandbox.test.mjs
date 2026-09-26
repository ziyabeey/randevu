import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createIyzicoSandboxClient } from '../worker/iyzico-sandbox.ts';

// Explicit fake credentials only. No process.env access and no real network fallback.
const env = { IYZICO_SANDBOX_API_KEY: 'sandbox-fake-key', IYZICO_SANDBOX_SECRET_KEY: 'sandbox-fake-secret' };
const callbackUrl = 'https://merchant.example.test/iyzico/callback';
const originalFetch = globalThis.fetch;
let globalFetchCalls = 0;
globalThis.fetch = async () => { globalFetchCalls++; throw new Error('NETWORK_DISABLED_IN_TEST'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(globalFetchCalls, 0); });
const expected = () => ({ conversationId: 'attempt-a', basketId: 'ticket-a', amountMinor: 12345, token: 'token-a' });
const input = () => ({
  conversationId: 'attempt-a', basketId: 'ticket-a', amountMinor: 12345,
  buyer: { id: 'buyer-test', name: 'Synthetic', surname: 'Fixture', email: 'buyer@example.test',
    identityNumber: '00000000000', registrationAddress: 'Test address', city: 'Test city',
    country: 'Turkey', ip: '192.0.2.1', gsmNumber: '+905550000000' },
  billingAddress: { contactName: 'Synthetic Fixture', address: 'Test address', city: 'Test city', country: 'Turkey' },
  items: [{ id: 'service-a', name: 'Saç kesimi', category: 'Kuaför', amountMinor: 12000 },
    { id: 'service-b', name: 'Ek hizmet', category: 'Kuaför', amountMinor: 345 }],
});
const mac = (fields) => createHmac('sha256', env.IYZICO_SANDBOX_SECRET_KEY).update(fields.join(':')).digest('hex');
function session(overrides = {}) {
  const r = { status: 'success', conversationId: 'attempt-a', token: 'token-a', tokenExpireTime: 1800,
    paymentPageUrl: 'https://sandbox-cpp.iyzipay.com/?token=token-a&lang=tr', ...overrides };
  r.signature = mac([r.conversationId, r.token]);
  return r;
}
function payment(overrides = {}) {
  const r = { status: 'success', paymentStatus: 'SUCCESS', fraudStatus: 1, conversationId: 'attempt-a',
    basketId: 'ticket-a', token: 'token-a', paymentId: 'payment-a', currency: 'TRY',
    price: 123.45, paidPrice: 123.45, installment: 1, ...overrides };
  r.signature = mac([r.paymentStatus, r.paymentId, r.currency, r.basketId, r.conversationId, String(Number(r.paidPrice)), String(Number(r.price)), r.token]);
  return r;
}
const json = (r) => new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
function fixture(responseFactory = () => session(), timeoutMs = 8000) {
  const requests = [];
  const client = createIyzicoSandboxClient(env, async (url, init) => {
    requests.push({ url, init });
    return responseFactory(url, init);
  }, { callbackUrl, timeoutMs });
  return { client, requests };
}

test('IYZ-01A importing/constructing the adapter performs no I/O', () => {
  const f = fixture();
  assert.deepEqual(f.requests, []);
  assert.equal(globalFetchCalls, 0);
});

test('IYZ-01A initialize signs the exact UTF-8 body with independent Node HMAC', async () => {
  const f = fixture(() => json(session()));
  const r = await f.client.initialize(input());
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { token: 'token-a', paymentPageUrl: 'https://sandbox-cpp.iyzipay.com/?token=token-a&lang=tr', expiresInSeconds: 1800 });
  assert.equal(f.requests.length, 1);
  const { url, init } = f.requests[0];
  assert.equal(url, 'https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/initialize/auth/ecom');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
  assert.ok(init.signal instanceof AbortSignal);
  assert.match(init.headers['x-iyzi-rnd'], /^[0-9a-f]{32}$/);
  const body = JSON.parse(init.body);
  assert.equal(body.price, '123.45');
  assert.equal(body.paidPrice, '123.45');
  assert.equal(body.currency, 'TRY');
  assert.deepEqual(body.enabledInstallments, [1]);
  assert.equal(body.callbackUrl, callbackUrl);
  assert.equal(body.basketItems[0].name, 'Saç kesimi');
  assert.deepEqual(body.basketItems.map(i => [i.price, i.itemType]), [['120.00','VIRTUAL'],['3.45','VIRTUAL']]);
  assert.equal(body.shippingAddress, undefined);
  const independent = createHmac('sha256', env.IYZICO_SANDBOX_SECRET_KEY)
    .update(init.headers['x-iyzi-rnd'] + new URL(url).pathname + init.body).digest('hex');
  assert.equal(Buffer.from(init.headers.Authorization.slice(8), 'base64').toString(),
    `apiKey:${env.IYZICO_SANDBOX_API_KEY}&randomKey:${init.headers['x-iyzi-rnd']}&signature:${independent}`);
});

test('IYZ-01A each request receives a fresh nonce without automatic retries', async () => {
  const f = fixture(() => json(session()));
  await f.client.initialize(input()); await f.client.initialize(input());
  assert.equal(f.requests.length, 2);
  assert.notEqual(f.requests[0].init.headers['x-iyzi-rnd'], f.requests[1].init.headers['x-iyzi-rnd']);
});

test('IYZ-01A invalid configuration fails without transport or secret reflection', () => {
  const invalid = [
    [{}, {callbackUrl}], [env, {callbackUrl: 'http://merchant.example.test/callback'}],
    [env, {callbackUrl: 'https://user:pass@merchant.example.test/callback'}],
    [env, {callbackUrl: callbackUrl + '?secret=not-allowed'}], [env, {callbackUrl: callbackUrl + '#fragment'}],
    [env, {callbackUrl, timeoutMs: 0}], [env, {callbackUrl, timeoutMs: 30001}],
    [{...env, IYZICO_SANDBOX_API_KEY:'key&injection'}, {callbackUrl}],
  ];
  for (const [e, o] of invalid) assert.throws(() => createIyzicoSandboxClient(e, async () => { throw Error('called'); }, o),
    {message:'IYZICO_SANDBOX_CONFIGURATION_INVALID'});
  assert.throws(() => createIyzicoSandboxClient(env, undefined, {callbackUrl}), {message:'IYZICO_SANDBOX_CONFIGURATION_INVALID'});
});

test('IYZ-01A invalid checkout never reaches the transport', async (t) => {
  const cases = [
    ['zero amount', v => v.amountMinor=0], ['fractional cents', v => v.amountMinor=12.34],
    ['amount limit', v => v.amountMinor=100000001], ['mismatched sum', v => v.amountMinor++],
    ['empty basket', v => v.items=[]], ['duplicate item', v => v.items.push({...v.items[0]})],
    ['extra currency', v => v.currency='USD'], ['raw card forbidden', v => v.cardNumber='fake'],
    ['client callback override forbidden', v => v.callbackUrl='https://other.example.test'],
    ['missing buyer identity', v => delete v.buyer.identityNumber],
    ['unknown buyer data', v => v.buyer.apiKey='not-allowed'],
    ['negative line amount', v => v.items[0].amountMinor=-1],
    ['missing billing', v => v.billingAddress=null], ['signature separator id', v => v.conversationId='one:two'],
    ['too many items', v => v.items=Array.from({length:51},(_,i)=>({id:`item-${i}`,name:'Test',category:'Test',amountMinor:1}))],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const v = input(); mutate(v); const f = fixture();
    assert.deepEqual(await f.client.initialize(v), {ok:false,code:'INVALID_INPUT'});
    assert.equal(f.requests.length,0);
  });
});

test('IYZ-01A invalid initialize response cannot expose an unsafe checkout', async (t) => {
  const cases = [
    ['missing signature', r => delete r.signature], ['wrong signature', r => r.signature='a'.repeat(64)],
    ['other conversation', r => {r.conversationId='other'; r.signature=mac([r.conversationId,r.token]);}],
    ['live checkout host', r => r.paymentPageUrl='https://cpp.iyzipay.com/?token=token-a'],
    ['lookalike host', r => r.paymentPageUrl='https://sandbox-cpp.iyzipay.com.evil.test/?token=token-a'],
    ['other token URL', r => r.paymentPageUrl='https://sandbox-cpp.iyzipay.com/?token=token-b'],
    ['two token params', r => r.paymentPageUrl='https://sandbox-cpp.iyzipay.com/?token=token-a&token=token-a'],
    ['URL credentials', r => r.paymentPageUrl='https://u:p@sandbox-cpp.iyzipay.com/?token=token-a'],
    ['checkout HTTP', r => r.paymentPageUrl='http://sandbox-cpp.iyzipay.com/?token=token-a'],
    ['arbitrary path', r => r.paymentPageUrl='https://sandbox-cpp.iyzipay.com/other?token=token-a'],
    ['missing expiry', r => delete r.tokenExpireTime], ['negative expiry', r => r.tokenExpireTime=-1],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const r=session(); mutate(r); const f=fixture(()=>json(r));
    assert.deepEqual(await f.client.initialize(input()), {ok:false,code:'INVALID_RESPONSE'});
  });
});

test('IYZ-01A retrieve returns verified sandbox evidence, not a ledger mutation', async () => {
  const f=fixture(()=>json(payment()));
  assert.deepEqual(await f.client.retrieve(expected()), {ok:true,value:{kind:'verified_sandbox_payment',
    paymentId:'payment-a',conversationId:'attempt-a',basketId:'ticket-a',amountMinor:12345,currency:'TRY'}});
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].url,'https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/auth/ecom/detail');
  assert.deepEqual(JSON.parse(f.requests[0].init.body), {locale:'tr',conversationId:'attempt-a',token:'token-a'});
});

test('IYZ-01A valid signatures cannot substitute another attempt, amount or currency', async (t) => {
  const changes = [
    ['conversation',{conversationId:'attempt-b'}], ['basket',{basketId:'ticket-b'}], ['token',{token:'token-b'}],
    ['currency',{currency:'USD'}], ['basket amount',{price:123.44}], ['paid amount',{paidPrice:123.46}],
    ['fractional cent',{paidPrice:'123.45000001'}], ['installment',{installment:2}],
    ['missing payment id',{paymentId:undefined}], ['non-canonical decimal',{price:'0123.45'}],
    ['negative price',{price:-123.45}], ['exponent string',{price:'1.2345e2'}],
  ];
  for (const [name, change] of changes) await t.test(name, async () => {
    const f=fixture(()=>json(payment(change)));
    assert.deepEqual(await f.client.retrieve(expected()), {ok:false,code:'INVALID_RESPONSE'});
  });
});

test('IYZ-01A decimal strings follow the provider trailing-zero signature rule and exact cents', async () => {
  const f=fixture(()=>json(payment({price:'123.45000000',paidPrice:'123.45'})));
  assert.equal((await f.client.retrieve(expected())).ok,true);
});

test('IYZ-01A one cent and integer whole-lira responses compare without rounding', async () => {
  for (const amount of [1,100,100000000]) {
    const f=fixture(()=>json(payment({price:amount/100,paidPrice:amount/100})));
    const r=await f.client.retrieve({...expected(),amountMinor:amount});
    assert.equal(r.ok,true); assert.equal(r.value.amountMinor,amount);
  }
});

test('IYZ-01A HMAC tampering or missing signature never verifies', async () => {
  for (const signature of [undefined,'a'.repeat(64),'g'.repeat(64),'abcd']) {
    const f=fixture(()=>json({...payment(),signature}));
    assert.deepEqual(await f.client.retrieve(expected()),{ok:false,code:'INVALID_RESPONSE'});
  }
});

test('IYZ-01A API success does not imply payment success or fraud approval', async () => {
  for (const change of [{paymentStatus:'FAILURE'}, {fraudStatus:-1}, {fraudStatus:undefined}, {fraudStatus:'1'}]) {
    const f=fixture(()=>json(payment(change)));
    assert.deepEqual(await f.client.retrieve(expected()),{ok:false,code:'UNCONFIRMED'});
  }
  const pending=fixture(()=>json(payment({fraudStatus:0})));
  assert.deepEqual(await pending.client.retrieve(expected()),{ok:false,code:'PENDING_REVIEW'});
});

test('IYZ-01A caller mutation during await cannot rewrite persisted expectations', async () => {
  const e=expected();
  const f=fixture(()=> {e.basketId='ticket-b';e.amountMinor=1;return json(payment());});
  const r=await f.client.retrieve(e);
  assert.equal(r.ok,true);assert.equal(r.value.basketId,'ticket-a');assert.equal(r.value.amountMinor,12345);
});

test('IYZ-01A simultaneous calls keep response bindings separate', async () => {
  const f=fixture(async (_url,init)=>{
    const b=JSON.parse(init.body); await new Promise(r=>setTimeout(r,b.conversationId==='attempt-a'?10:1));
    return json(payment({conversationId:b.conversationId,token:b.token,basketId:b.conversationId==='attempt-a'?'ticket-a':'ticket-b'}));
  });
  const [a,b]=await Promise.all([f.client.retrieve(expected()),f.client.retrieve({...expected(),conversationId:'attempt-b',basketId:'ticket-b',token:'token-b'})]);
  assert.equal(a.value.basketId,'ticket-a');assert.equal(b.value.basketId,'ticket-b');
});

test('IYZ-01A invalid retrieve input makes zero requests', async () => {
  for (const e of [null,{}, {...expected(),token:''}, {...expected(),amountMinor:NaN}, {...expected(),baseUrl:'https://api.iyzipay.com'}]) {
    const f=fixture();assert.deepEqual(await f.client.retrieve(e),{ok:false,code:'INVALID_INPUT'});assert.equal(f.requests.length,0);
  }
});

test('IYZ-01A HTTP failure/provider rejection/transport exception stay unconfirmed and redacted', async () => {
  const sensitive='fake-secret-and-customer-data';
  const cases=[()=>new Response(sensitive,{status:500}),()=>new Response(sensitive,{status:302}),
    ()=>json({status:'failure',errorMessage:sensitive}),()=>{throw Error(sensitive);}];
  for (const response of cases) {
    const f=fixture(response);const result=await f.client.initialize(input());
    assert.deepEqual(result,{ok:false,code:'UNCONFIRMED'});assert.equal(f.requests.length,1);
    assert.equal(JSON.stringify(result).includes(sensitive),false);
  }
});

test('IYZ-01A malformed, oversized and non-object bodies never verify', async () => {
  for (const content of ['not json','null','[]','"text"',' '.repeat(256*1024+1)]) {
    const f=fixture(()=>new Response(content));const result=await f.client.retrieve(expected());
    assert.equal(result.ok,false);assert.equal(f.requests.length,1);
  }
});

test('IYZ-01A timeout returns unknown once even if transport never resolves', async () => {
  const f=fixture(()=>new Promise(()=>{}),20);
  const result=await f.client.initialize(input());
  assert.deepEqual(result,{ok:false,code:'UNCONFIRMED'});
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].init.signal.aborted,true);
});

test('IYZ-01A stalled response body is bounded by the same deadline and cancelled', async () => {
  let cancelled=false;
  const f=fixture(()=>new Response(new ReadableStream({cancel(){cancelled=true;}})),20);
  assert.deepEqual(await f.client.retrieve(expected()),{ok:false,code:'UNCONFIRMED'});
  assert.equal(cancelled,true);assert.equal(f.requests.length,1);
});

test('IYZ-01A source isolation: no existing application import, env read, logging or live endpoint', async () => {
  const source=await readFile(new URL('../worker/iyzico-sandbox.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/^import\s/m);
  assert.doesNotMatch(source,/process\.env|console\.|https:\/\/api\.iyzipay\.com|https:\/\/cpp\.iyzipay\.com/);
  assert.doesNotMatch(source,/\bfetch\s*\(/);
});

// Explicit provider-canonical pairs; expected values do not use the implementation helper.
test('IYZ-01A provider-canonical response price signatures', async (t) => {
  for (const [wire, canonical, cents] of [
    ['50.00','50',5000], ['10.0','10',1000], ['10.50','10.5',1050],
    ['10.51000000','10.51',1051], ['0.01000000','0.01',1],
    ['1000000.00','1000000',100000000],
  ]) await t.test(wire, async () => {
    const r = payment({price:wire, paidPrice:wire});
    r.signature = mac(['SUCCESS','payment-a','TRY','ticket-a','attempt-a',canonical,canonical,'token-a']);
    const f = fixture(() => json(r));
    const result = await f.client.retrieve({...expected(), amountMinor:cents});
    assert.equal(result.ok,true); assert.equal(result.value.amountMinor,cents);
  });
});

test('IYZ-01A raw unnormalized price signatures are not a second protocol', async () => {
  const r = payment({price:'123.4500',paidPrice:'123.4500'});
  r.signature = mac(['SUCCESS','payment-a','TRY','ticket-a','attempt-a','123.4500','123.4500','token-a']);
  assert.deepEqual(await fixture(() => json(r)).client.retrieve(expected()),{ok:false,code:'INVALID_RESPONSE'});
});
