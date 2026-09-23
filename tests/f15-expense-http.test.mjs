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
const user={id:'f1700000-0000-4000-8000-000000000001',email:'f15-expense@example.test'};
const businessId='f1710000-0000-4000-8000-000000000001';
const otherBusinessId='f1710000-0000-4000-8000-000000000002';
const membershipId='f1720000-0000-4000-8000-000000000001';
const eventId='f1730000-0000-4000-8000-000000000001';
const csrf='C'.repeat(43);

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function token(){
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub:user.id,session_id:'f1740000-0000-4000-8000-000000000001',amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `${h}.${p}.sig`;
}
function cookie(){return `yzt_access=${token()}; yzt_refresh=f15-expense; yzt_business=${businessId}; yzt_csrf=${csrf}`;}
function headers(key='f1503-http-key-0001'){return {Origin:'http://localhost',Cookie:cookie(),'X-YZT-CSRF':csrf,'Content-Type':'application/json','Idempotency-Key':key};}
function member(role='owner'){return {id:membershipId,business_id:businessId,role,active:true};}
function baseFetch({role='owner',permission=true,rpc}){
  return async (input,init={})=>{
    const url=new URL(String(input));
    if(url.pathname==='/auth/v1/user') return json(user);
    if(url.pathname==='/rest/v1/memberships') return json([member(role)]);
    if(url.pathname==='/rest/v1/rpc/has_financial_permission'){
      const body=JSON.parse(init.body);
      assert.equal(body.p_business_id,businessId);
      assert.equal(body.p_permission,'expenses_write');
      return json(permission);
    }
    return rpc(url,init);
  };
}

await test('F15 expense create derives business and enforces expenses_write',async()=>{
  const real=globalThis.fetch;
  let calls=0;
  globalThis.fetch=baseFetch({role:'staff',permission:false,rpc:async()=>{calls+=1;throw new Error('unexpected');}});
  try{
    const r=await app.request('http://localhost/api/expenses',{method:'POST',headers:headers('f1503-denied'),body:JSON.stringify({businessId:otherBusinessId,category:'Malzeme',amountMinor:15000,currency:'TRY',paymentMethod:'cash',occurredAt:'2026-09-23T10:00'})},env);
    assert.equal(r.status,403); assert.equal((await r.json()).error?.code,'EXPENSES_PERMISSION_REQUIRED'); assert.equal(calls,0);
  }finally{globalThis.fetch=real;}

  let rpcBody;
  globalThis.fetch=baseFetch({permission:true,rpc:async(url,init)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/create_expense_guarded');
    rpcBody=JSON.parse(init.body);
    return json({eventId,businessId,eventType:'expense',amountMinor:15000,effectMinor:15000,paymentMethod:'cash'});
  }});
  try{
    const r=await app.request('http://localhost/api/expenses',{method:'POST',headers:headers('f1503-create'),body:JSON.stringify({businessId:otherBusinessId,category:' Malzeme ',description:' Eldiven ',amountMinor:15000,currency:'try',paymentMethod:'cash',occurredAt:'2026-09-23T10:00'})},env);
    assert.equal(r.status,201);
    assert.equal(rpcBody.p_business_id,businessId);
    assert.equal(rpcBody.p_category,'Malzeme');
    assert.equal(rpcBody.p_description,'Eldiven');
    assert.equal(rpcBody.p_currency,'TRY');
    assert.equal(rpcBody.p_occurred_local,'2026-09-23T10:00');
    assert.equal(JSON.stringify(rpcBody).includes(otherBusinessId),false);
  }finally{globalThis.fetch=real;}
});

await test('F15 expense reversal and correction bind source to selected tenant',async()=>{
  const real=globalThis.fetch;
  const seen=[];
  globalThis.fetch=baseFetch({permission:true,rpc:async(url,init)=>{
    const body=JSON.parse(init.body); seen.push({path:url.pathname,body});
    if(url.pathname.endsWith('reverse_expense_guarded')) return json({eventId:'f1730000-0000-4000-8000-000000000002',businessId,eventType:'reversal',sourceExpenseEventId:eventId,effectMinor:-15000});
    if(url.pathname.endsWith('correct_expense_guarded')) return json({reversal:{eventId:'f1730000-0000-4000-8000-000000000003'},replacement:{eventId:'f1730000-0000-4000-8000-000000000004'}});
    throw new Error('unexpected');
  }});
  try{
    let r=await app.request(`http://localhost/api/expenses/${eventId}/reverse`,{method:'POST',headers:headers('f1503-reverse'),body:JSON.stringify({businessId:otherBusinessId,reason:'Yanlış kayıt',occurredAt:'2026-09-23T11:00'})},env);
    assert.equal(r.status,201);
    r=await app.request(`http://localhost/api/expenses/${eventId}/correct`,{method:'POST',headers:headers('f1503-correct'),body:JSON.stringify({businessId:otherBusinessId,reason:'Tutar düzeltmesi',category:'Malzeme',description:'Eldiven',amountMinor:12000,currency:'TRY',paymentMethod:'card',occurredAt:'2026-09-23T10:00',correctionOccurredAt:'2026-09-23T11:05'})},env);
    assert.equal(r.status,201);
    assert.equal(seen.length,2);
    assert.ok(seen.every(x=>x.body.p_business_id===businessId));
    assert.ok(seen.every(x=>!JSON.stringify(x.body).includes(otherBusinessId)));
  }finally{globalThis.fetch=real;}
});

await test('F15 expense list is membership-scoped and paginated',async()=>{
  const real=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(String(input));
    if(url.pathname==='/auth/v1/user') return json(user);
    if(url.pathname==='/rest/v1/memberships') return json([member('staff')]);
    assert.equal(url.pathname,'/rest/v1/rpc/list_expense_events_page');
    const body=JSON.parse(init.body); assert.equal(body.p_business_id,businessId); assert.equal(body.p_limit,26);
    return json([{event:{eventId,businessId,eventType:'expense',amountMinor:15000,effectMinor:15000},sort_occurred_at:'2026-09-23T10:00',sort_id:eventId}]);
  };
  try{
    const r=await app.request('http://localhost/api/expenses',{headers:{Cookie:cookie()}},env);
    assert.equal(r.status,200);
    const p=await r.json(); assert.equal(p.events[0].eventId,eventId); assert.equal(p.page.hasMore,false);
  }finally{globalThis.fetch=real;}
});
