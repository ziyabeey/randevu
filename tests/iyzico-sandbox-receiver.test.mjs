import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createIyzicoSandboxReceiver } from '../worker/iyzico-sandbox-receiver.ts';

// Explicit test doubles only. This file proves orchestration, not a real database or provider.
const env = { IYZICO_SANDBOX_API_KEY: 'fake-api-key', IYZICO_SANDBOX_SECRET_KEY: 'fake-secret-key' };
const options = { accountRef: 'test-account-a', callbackUrl: 'https://receiver.example.test/iyzico/callback',
  webhookUrl: 'https://receiver.example.test/iyzico/webhook', timeoutMs: 5000 };
const makeAttempt = () => ({ attemptId:'10000000-0000-4000-8000-000000000001',
  businessId:'20000000-0000-4000-8000-000000000001', ticketId:'30000000-0000-4000-8000-000000000001',
  accountRef: options.accountRef, environment:'sandbox', revision:0,
  conversationId:'test-conversation', basketId:'test-basket', token:'fake-form-token', amountMinor:5000, paymentId:null });
const mac = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
const price = v => String(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
function retrieved(a, overrides = {}, secret = env.IYZICO_SANDBOX_SECRET_KEY) {
  const r = { status:'success', paymentStatus:'SUCCESS', fraudStatus:1, paymentId:'10101',
    conversationId:a.conversationId, basketId:a.basketId, token:a.token,
    price:'50.00', paidPrice:'50.00', currency:'TRY', installment:1, ...overrides };
  r.signature = mac(secret, [r.paymentStatus,r.paymentId,r.currency,r.basketId,r.conversationId,
    price(r.paidPrice),price(r.price),r.token].join(':'));
  return r;
}
function event(a, overrides = {}, secret = env.IYZICO_SANDBOX_SECRET_KEY) {
  const e = { iyziEventType:'CHECKOUT_FORM_AUTH', iyziPaymentId:10101, token:a.token,
    paymentConversationId:a.conversationId, status:'SUCCESS', ...overrides };
  const signature = mac(secret, secret + e.iyziEventType + e.iyziPaymentId + e.token + e.paymentConversationId + e.status);
  return { e, signature };
}
const callback = (a = makeAttempt(), init = {}) => new Request(options.callbackUrl, { method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'}, body:`token=${a.token}`, ...init });
function webhook(a = makeAttempt(), overrides = {}, init = {}) {
  const { e, signature } = event(a, overrides);
  return new Request(options.webhookUrl, { method:'POST', headers:{'content-type':'application/json',
    'x-iyz-signature-v3':signature}, body:JSON.stringify(e), ...init });
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const delay = ms => new Promise(r => setTimeout(r, ms));
let globalFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { globalFetchCalls++; throw new Error('REAL_NETWORK_FORBIDDEN'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(globalFetchCalls, 0); });

function fixture(overrides = {}) {
  const a = makeAttempt(), calls = [];
  const port = {
    admit: async (_request, signal) => { calls.push('admit'); assert.equal(signal.aborted,false); return true; },
    findAttempt: async (account, token, _signal) => { calls.push('find'); assert.equal(account,a.accountRef); assert.equal(token,a.token); return a; },
    commitVerifiedPayment: async (binding,payment,_signal) => { calls.push('commit');
      assert.deepEqual(binding,a); assert.ok(Object.isFrozen(binding)); assert.ok(Object.isFrozen(payment));
      return {kind:'applied',attemptId:binding.attemptId,paymentId:payment.paymentId}; },
    ...overrides.ports,
  };
  const transport = overrides.transport ?? (async (url, init) => {
    calls.push('retrieve');
    assert.equal(url,'https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/auth/ecom/detail');
    assert.equal(init.redirect,'error');
    const decoded = Buffer.from(init.headers.Authorization.slice('IYZWSv2 '.length),'base64').toString('utf8');
    const nonce = init.headers['x-iyzi-rnd'];
    assert.equal(decoded, `apiKey:${env.IYZICO_SANDBOX_API_KEY}&randomKey:${nonce}&signature:${mac(env.IYZICO_SANDBOX_SECRET_KEY,nonce+new URL(url).pathname+init.body)}`);
    const body = JSON.parse(init.body);
    assert.deepEqual(body,{locale:'tr',conversationId:a.conversationId,token:a.token});
    return Response.json(retrieved(a));
  });
  const handler = createIyzicoSandboxReceiver(overrides.env ?? env,transport,port,{...options,...overrides.options});
  return {a,calls,port,handler};
}

await test('callback uses actual CF Retrieve and acknowledges only after the commit port finishes', async () => {
  const gate = deferred(); let started = false;
  const f = fixture({ ports:{commitVerifiedPayment:async(a,p) => { started=true; await gate.promise;
    return {kind:'applied',attemptId:a.attemptId,paymentId:p.paymentId}; }} });
  let answered = false;
  const pending = f.handler(callback()).then(r => { answered=true; return r; });
  for (let i=0; i<100 && !started; i++) await delay(1);
  assert.equal(started,true); assert.equal(answered,false);
  gate.resolve(); const r = await pending;
  assert.equal(r.status,200); assert.deepEqual(await r.json(),{status:'processed'});
  assert.equal(r.headers.get('cache-control'),'no-store'); assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.deepEqual(f.calls,['admit','find','retrieve']);
});
await test('HPP verifier and real adapter are both exercised before the commit', async () => {
  const f = fixture(); const r = await f.handler(webhook());
  assert.equal(r.status,200); assert.deepEqual(f.calls,['admit','find','retrieve','commit']);
});
await test('delayed FAILURE notification cannot cancel a later verified successful payment', async () => {
  const f = fixture(); assert.equal((await f.handler(webhook(f.a,{status:'FAILURE'}))).status,200);
  assert.deepEqual(f.calls,['admit','find','retrieve','commit']);
});
await test('wrong method, host, query, content type, encoding and V3 headers stop before admission', async t => {
  const cases = [
    ['method', () => new Request(options.callbackUrl),405],
    ['wrong host', () => new Request('https://elsewhere.example.test/iyzico/callback',{method:'POST',body:'token=fake-form-token'}),404],
    ['query token', () => new Request(options.callbackUrl+'?token=fake-form-token',{method:'POST'}),404],
    ['content type', () => callback(makeAttempt(),{headers:{'content-type':'application/json'}}),415],
    ['wrong charset', () => callback(makeAttempt(),{headers:{'content-type':'application/x-www-form-urlencoded; charset=latin1'}}),415],
    ['encoded body', () => callback(makeAttempt(),{headers:{'content-type':'application/x-www-form-urlencoded','content-encoding':'gzip'}}),415],
    ['oversize header', () => callback(makeAttempt(),{headers:{'content-type':'application/x-www-form-urlencoded','content-length':'999999'}}),413],
    ['bad length', () => callback(makeAttempt(),{headers:{'content-type':'application/x-www-form-urlencoded','content-length':'-1'}}),413],
    ['no v3', () => webhook(makeAttempt(),{},{headers:{'content-type':'application/json'}}),401],
    ['v2 only', () => webhook(makeAttempt(),{},{headers:{'content-type':'application/json','x-iyz-signature-v2':'a'.repeat(64)}}),401],
    ['bad v3 format', () => webhook(makeAttempt(),{},{headers:{'content-type':'application/json','x-iyz-signature-v3':'bad'}}),401],
  ];
  for (const [name,build,status] of cases) await t.test(name,async()=>{const f=fixture(); assert.equal((await f.handler(build())).status,status);assert.deepEqual(f.calls,[]);});
});
await test('duplicate fields, extra authority fields and malformed bodies never reach lookup', async t => {
  for (const body of ['token=fake-form-token&token=fake-form-token','token=fake-form-token&%74oken=fake-form-token',
    'token=fake-form-token&businessId=other','token=fake-form-token&status=SUCCESS','token=','token=%00','token=a+b','notToken=fake-form-token']) {
    await t.test(body, async()=>{ const f=fixture(); assert.equal((await f.handler(callback(f.a,{body}))).status,400); assert.deepEqual(f.calls,['admit']); });
  }
  for (const body of ['{','[]','null','{}','{"token":1}']) await t.test('json '+body, async()=>{
    const f=fixture(); assert.equal((await f.handler(webhook(f.a,{},{body}))).status,400); assert.deepEqual(f.calls,['admit']);
  });
});
await test('admission rejection and errors perform no token lookup or provider request', async t => {
  for (const [name,admit,status] of [['deny',async()=>false,429],['not boolean',async()=> 'true',429],
    ['throw',async()=>{throw new Error('private-credential-value');},503]]) await t.test(name,async()=>{
    const f=fixture({ports:{admit}}); const r=await f.handler(callback());assert.equal(r.status,status);assert.deepEqual(f.calls,[]);
    assert.doesNotMatch(await r.text(),/private-credential/);
  });
});
await test('chunked or multibyte body limit is enforced without Content-Length', async () => {
  let canceled = false;
  const body = new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('token='+'é'.repeat(9000)));},cancel(){canceled=true;}});
  const f=fixture(); assert.equal((await f.handler(callback(f.a,{body,duplex:'half'}))).status,413);
  assert.equal(canceled,true);assert.deepEqual(f.calls,['admit']);
});
await test('untrusted, missing, wrong-account or live attempts do not call the provider', async t => {
  const variants = [null,{}, {...makeAttempt(),environment:'live'}, {...makeAttempt(),accountRef:'test-account-b'},
    {...makeAttempt(),token:'another-token'}, {...makeAttempt(),amountMinor:0}, {...makeAttempt(),amountMinor:1.1},
    {...makeAttempt(),revision:-1}, {...makeAttempt(),businessId:'invalid'}, {...makeAttempt(),ticketId:'invalid'},
    {...makeAttempt(),paymentId:'bad'}, {...makeAttempt(),attemptId:'invalid'}];
  for (let i=0;i<variants.length;i++) await t.test(String(i),async()=>{
    const f=fixture({ports:{findAttempt:async()=>variants[i]}}); assert.equal((await f.handler(callback())).status,400);assert.deepEqual(f.calls,['admit']);
  });
});
await test('wrong event signature/binding is rejected without Retrieve or commit', async t => {
  for (const change of [{status:'UNKNOWN'},{paymentConversationId:'other'},{iyziPaymentId:0},
    {iyziEventType:'OTHER'},{iyziPaymentId:9007199254740992}]) await t.test(JSON.stringify(change),async()=>{
    const f=fixture(); assert.equal((await f.handler(webhook(f.a,change))).status,401); assert.deepEqual(f.calls,['admit','find']);
  });
  const f=fixture();const r=webhook(); r.headers.set('x-iyz-signature-v3','a'.repeat(64));
  assert.equal((await f.handler(r)).status,401);assert.deepEqual(f.calls,['admit','find']);
});
await test('untrusted HPP amount and merchant fields are not used as commit authority', async () => {
  const f=fixture(); assert.equal((await f.handler(webhook(f.a,{merchantId:'other',price:1,businessId:'other',ticketId:'other'}))).status,200);
  assert.deepEqual(f.calls,['admit','find','retrieve','commit']);
});
await test('provider failure, bad signature, wrong amount, pending fraud or mismatched IDs never commit', async t => {
  const variants = [ {status:'failure'}, {paymentStatus:'FAILURE'}, {fraudStatus:0}, {fraudStatus:-1},
    {price:1}, {paidPrice:51}, {currency:'USD'}, {basketId:'other'}, {token:'other'}, {installment:2}, {conversationId:'other'} ];
  for (const change of variants) await t.test(JSON.stringify(change),async()=>{
    const f=fixture({transport:async()=>Response.json(retrieved(makeAttempt(),change))});
    assert.equal((await f.handler(callback())).status,503); assert.deepEqual(f.calls,['admit','find']);
  });
  const f=fixture({transport:async()=>Response.json({...retrieved(makeAttempt()),signature:'a'.repeat(64)})});
  assert.equal((await f.handler(callback())).status,503); assert.deepEqual(f.calls,['admit','find']);
});
await test('signed webhook payment ID must match separately signed Retrieve result', async () => {
  const f=fixture(); assert.equal((await f.handler(webhook(f.a,{iyziPaymentId:20202}))).status,503);
  assert.deepEqual(f.calls,['admit','find','retrieve']);
});
await test('persisted provider payment ID is required to match callback and webhook results', async t => {
  await t.test('callback',async()=>{const f=fixture();f.a.paymentId='20202';assert.equal((await f.handler(callback())).status,503);assert.deepEqual(f.calls,['admit','find','retrieve']);});
  await t.test('webhook',async()=>{const f=fixture();f.a.paymentId='20202';assert.equal((await f.handler(webhook())).status,401);assert.deepEqual(f.calls,['admit','find']);});
});
await test('uncommitted, malformed or mismatched commit result is not acknowledged', async t => {
  for (const receipt of [undefined,null,{}, {kind:'conflict'}, {kind:'applied'},
    {kind:'applied',attemptId:'other',paymentId:'10101'}, {kind:'already_applied',attemptId:makeAttempt().attemptId,paymentId:'other'}]) {
    await t.test(JSON.stringify(receipt)??'undefined',async()=>{const f=fixture({ports:{commitVerifiedPayment:async()=>receipt}});
      const r=await f.handler(callback());assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'60');});
  }
});
await test('matching already-applied receipt gives the same non-sensitive acknowledgement', async () => {
  const f=fixture({ports:{commitVerifiedPayment:async(a,p)=>({kind:'already_applied',attemptId:a.attemptId,paymentId:p.paymentId})}});
  const r=await f.handler(callback());assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'processed'});
});
await test('parallel callback + HPP deliveries rely on one atomic port, not process-local deduplication', async () => {
  const applied = new Map();let applications=0, commits=0;
  // SYNTHETIC atomic test port: synchronous Map mutation is NOT a durable PostgreSQL proof.
  const f=fixture({ports:{commitVerifiedPayment:async(a,p)=>{
    commits++;const key=a.accountRef+':'+p.paymentId;const exists=applied.has(key);
    if(!exists){applied.set(key,a.attemptId);applications++;}
    return {kind:exists?'already_applied':'applied',attemptId:a.attemptId,paymentId:p.paymentId};
  }}});
  const replies=await Promise.all(Array.from({length:12},(_,i)=>f.handler(i%2?callback():webhook())));
  assert.ok(replies.every(r=>r.status===200));assert.equal(commits,12);assert.equal(applications,1);
});
await test('mutable store objects and configuration cannot replace the snapped binding after lookup', async () => {
  const entered=deferred(), release=deferred(); const a=makeAttempt();const config={...options};const credentials={...env};let saved;
  const ports={admit:async()=>true,findAttempt:async()=>a,commitVerifiedPayment:async(binding,p)=>{
    saved=binding;return {kind:'applied',attemptId:binding.attemptId,paymentId:p.paymentId};}};
  const original={...a}; const handler=createIyzicoSandboxReceiver(credentials,async()=>{entered.resolve();await release.promise;return Response.json(retrieved(original));},ports,config);
  const pending=handler(callback());await entered.promise;
  a.businessId='20000000-0000-4000-8000-000000000099';a.amountMinor=1;a.token='other';
  config.accountRef='other';credentials.IYZICO_SANDBOX_SECRET_KEY='changed';ports.commitVerifiedPayment=async()=>{throw new Error('replaced');};
  release.resolve();assert.equal((await pending).status,200);assert.deepEqual(saved,original);
});
await test('body stall, admission stall and lookup stall respect the total deadline', async t => {
  await t.test('body',async()=>{let canceled=false;const body=new ReadableStream({cancel(){canceled=true;}});
    const f=fixture({options:{timeoutMs:20}});assert.equal((await f.handler(callback(f.a,{body,duplex:'half'}))).status,503);
    assert.equal(canceled,true);assert.deepEqual(f.calls,['admit']);});
  for (const method of ['admit','findAttempt']) await t.test(method,async()=>{
    const gate=deferred();const f=fixture({options:{timeoutMs:20},ports:{[method]:()=>gate.promise}});
    assert.equal((await f.handler(callback())).status,503);gate.resolve(method==='admit'?true:makeAttempt());
    await delay(5);assert.ok(!f.calls.includes('retrieve'));assert.ok(!f.calls.includes('commit'));
  });
});
await test('client abort after lookup prevents later provider result from being committed', async () => {
  const entered=deferred(), release=deferred();let commits=0;
  const f=fixture({transport:async()=>{entered.resolve();await release.promise;return Response.json(retrieved(makeAttempt()));},
    ports:{commitVerifiedPayment:async()=>{commits++;return {kind:'conflict'};}}});
  const ac=new AbortController();const pending=f.handler(callback(f.a,{signal:ac.signal}));await entered.promise;ac.abort();
  assert.equal((await pending).status,503);release.resolve();await delay(10);assert.equal(commits,0);
});
await test('commit timeout is unresolved and a late completion is not called a rollback', async () => {
  const gate=deferred();let entered=false, late=0;
  const f=fixture({options:{timeoutMs:1000},ports:{commitVerifiedPayment:async(a,p)=>{
    entered=true;await gate.promise;late++;return {kind:'applied',attemptId:a.attemptId,paymentId:p.paymentId};}}});
  const r=await f.handler(callback());assert.equal(entered,true);assert.equal(r.status,503);
  gate.resolve();await delay(5);assert.equal(late,1);assert.deepEqual(await r.json(),{status:'unconfirmed'});
});
await test('store and transport error details never leave the HTTP response', async t => {
  for (const phase of ['findAttempt','commitVerifiedPayment','transport']) await t.test(phase,async()=>{
    const explode=async()=>{throw new Error(env.IYZICO_SANDBOX_SECRET_KEY+' '+makeAttempt().token+' private-person');};
    const f=fixture(phase==='transport'?{transport:explode}:{ports:{[phase]:explode}});
    const r=await f.handler(callback());assert.equal(r.status,503);
    assert.equal(await r.text(),'{"status":"unconfirmed"}');
  });
});
await test('construction refuses missing ports and unsafe configuration/URLs', async t => {
  for (const config of [{callbackUrl:'http://receiver.example.test/x'}, {webhookUrl:options.callbackUrl},
    {callbackUrl:options.callbackUrl+'?token=fake'}, {accountRef:''}, {timeoutMs:0}, {timeoutMs:30001}]) await t.test(JSON.stringify(config),()=>{
    assert.throws(()=>fixture({options:config}),/IYZICO_SANDBOX_RECEIVER_CONFIGURATION_INVALID/);
  });
  assert.throws(()=>createIyzicoSandboxReceiver(env,async()=>{}, {},options),/IYZICO_SANDBOX_RECEIVER_CONFIGURATION_INVALID/);
});

await test('invalid UTF-8 input is rejected, not acknowledged or forwarded', async () => {
  const f=fixture();const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));c.close();}});
  assert.equal((await f.handler(callback(f.a,{body,duplex:'half'}))).status,400);
  assert.deepEqual(f.calls,['admit']);
});
await test('admission refusal cancels unread request body', async () => {
  let canceled=false;const body=new ReadableStream({cancel(){canceled=true;}});
  const f=fixture({ports:{admit:async()=>false}});
  assert.equal((await f.handler(callback(f.a,{body,duplex:'half'}))).status,429);assert.equal(canceled,true);
});
await test('changed ticket revision observed by the commit port remains a conflict, never a 200', async () => {
  const a=makeAttempt();let currentRevision=a.revision;let ledgerWrites=0;
  const f=fixture({ports:{findAttempt:async()=>a,commitVerifiedPayment:async(binding,p)=>{
    if(binding.revision!==currentRevision)return {kind:'conflict'};
    ledgerWrites++;return {kind:'applied',attemptId:binding.attemptId,paymentId:p.paymentId};
  }},transport:async()=>{currentRevision++;return Response.json(retrieved(a));}});
  assert.equal((await f.handler(callback())).status,503);assert.equal(ledgerWrites,0);
});
