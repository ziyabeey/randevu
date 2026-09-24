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

const user={id:'f1600000-0000-4000-8000-000000000001',email:'f1601@example.test'};
const businessId='f1610000-0000-4000-8000-000000000001';
const membershipId='f1620000-0000-4000-8000-000000000001';
const serviceId='f1630000-0000-4000-8000-000000000001';

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function token(){
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({
    sub:user.id,session_id:'f1640000-0000-4000-8000-000000000001',
    amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}],
    exp:Math.floor(Date.now()/1000)+3600,
  })).toString('base64url');
  return `${h}.${p}.sig`;
}
function cookie(){return `yzt_access=${token()}; yzt_refresh=f1601-refresh; yzt_business=${businessId}`;}
function baseFetch(rpc){
  return async(input,init={})=>{
    const url=new URL(String(input));
    if(url.pathname==='/auth/v1/user')return json(user);
    if(url.pathname==='/rest/v1/memberships')return json([{id:membershipId,business_id:businessId,role:'owner',active:true}]);
    return rpc(url,init);
  };
}
const headers=()=>({Cookie:cookie(),Origin:'http://localhost','X-YZT-CSRF':'series-csrf', 'Content-Type':'application/json'});
const mutationCookie=()=>`${cookie()}; yzt_csrf=series-csrf`;

await test('F16-01 preview derives tenant and forwards only bounded recurrence inputs',async()=>{
  const real=globalThis.fetch;
  let rpcBody;
  globalThis.fetch=baseFetch(async(url,init)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/preview_appointment_series');
    rpcBody=JSON.parse(init.body);
    return json({
      frequency:'weekly',occurrenceCount:3,timezone:'Europe/Istanbul',allAvailable:true,
      occurrences:[{ordinal:1,startsAt:'2026-10-01T07:00:00Z',available:true}],
    });
  });
  try{
    const r=await app.request('http://localhost/api/bookings/series/preview',{
      method:'POST',
      headers:{...headers(),Cookie:mutationCookie()},
      body:JSON.stringify({
        businessId:'attacker',startsAt:'2026-10-01T07:00:00Z',frequency:'weekly',count:3,
        lines:[{serviceId}],
      }),
    },env);
    assert.equal(r.status,200);
    assert.equal(rpcBody.p_business_id,businessId);
    assert.equal(rpcBody.p_frequency,'weekly');
    assert.equal(rpcBody.p_count,3);
    assert.equal(JSON.stringify(rpcBody).includes('attacker'),false);
    assert.equal((await r.json()).preview.allAvailable,true);
  }finally{globalThis.fetch=real;}
});

await test('F16-01 atomic create binds the external idempotency key and tenant',async()=>{
  const real=globalThis.fetch;
  let rpcBody;
  globalThis.fetch=baseFetch(async(url,init)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/create_appointment_series');
    rpcBody=JSON.parse(init.body);
    return json({
      seriesId:'f1650000-0000-4000-8000-000000000001',
      frequency:'daily',occurrenceCount:2,version:1,occurrences:[],
    });
  });
  try{
    const r=await app.request('http://localhost/api/bookings/series',{
      method:'POST',
      headers:{...headers(),Cookie:mutationCookie(),'Idempotency-Key':'f1601-create-key-0001'},
      body:JSON.stringify({
        businessId:'attacker',customerName:'Seri Müşteri',startsAt:'2026-10-01T07:00:00Z',
        frequency:'daily',count:2,lines:[{serviceId}],notes:'seri',
      }),
    },env);
    assert.equal(r.status,201);
    assert.equal(rpcBody.p_business_id,businessId);
    assert.equal(rpcBody.p_idempotency_key,'f1601-create-key-0001');
    assert.equal(rpcBody.p_count,2);
    assert.equal(JSON.stringify(rpcBody).includes('attacker'),false);
  }finally{globalThis.fetch=real;}
});

await test('F16-01 Worker enforces the K03 max-12 series budget before RPC',async()=>{
  const real=globalThis.fetch;
  let rpcCalls=0;
  globalThis.fetch=baseFetch(async()=>{rpcCalls+=1;throw new Error('unexpected series RPC');});
  try{
    const r=await app.request('http://localhost/api/bookings/series/preview',{
      method:'POST',
      headers:{...headers(),Cookie:mutationCookie()},
      body:JSON.stringify({
        startsAt:'2026-10-01T07:00:00Z',frequency:'weekly',count:13,lines:[{serviceId}],
      }),
    },env);
    assert.equal(r.status,400);
    assert.equal((await r.json()).error?.code,'INVALID_SERIES_PREVIEW');
    assert.equal(rpcCalls,0);
  }finally{globalThis.fetch=real;}
});

await test('F16-01 occurrence conflicts and transient create uncertainty stay explicit',async()=>{
  for(const [upstreamStatus,message,status,code] of [
    [400,'SERIES_OCCURRENCE_UNAVAILABLE:3:2026-10-15',409,'SERIES_OCCURRENCE_UNAVAILABLE'],
    [503,'upstream unavailable',503,'APPOINTMENT_SERIES_UNAVAILABLE'],
  ]){
    const real=globalThis.fetch;
    globalThis.fetch=baseFetch(async(url)=>{
      assert.equal(url.pathname,'/rest/v1/rpc/create_appointment_series');
      return json({message},upstreamStatus);
    });
    try{
      const r=await app.request('http://localhost/api/bookings/series',{
        method:'POST',
        headers:{...headers(),Cookie:mutationCookie(),'Idempotency-Key':'f1601-create-key-0002'},
        body:JSON.stringify({
          customerName:'Seri Müşteri',startsAt:'2026-10-01T07:00:00Z',
          frequency:'weekly',count:4,lines:[{serviceId}],
        }),
      },env);
      assert.equal(r.status,status,message);
      assert.equal((await r.json()).error?.code,code,message);
    }finally{globalThis.fetch=real;}
  }
});

await test('F16-01 series read derives tenant from the active membership',async()=>{
  const real=globalThis.fetch;
  let rpcBody;
  const seriesId='f1650000-0000-4000-8000-000000000001';
  globalThis.fetch=baseFetch(async(url,init)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/get_appointment_series');
    rpcBody=JSON.parse(init.body);
    return json({seriesId,businessId,frequency:'weekly',occurrenceCount:3,occurrences:[]});
  });
  try{
    const r=await app.request(`http://localhost/api/bookings/series/${seriesId}`,{headers:{Cookie:cookie()}},env);
    assert.equal(r.status,200);
    assert.deepEqual(rpcBody,{p_business_id:businessId,p_series_id:seriesId});
  }finally{globalThis.fetch=real;}
});
