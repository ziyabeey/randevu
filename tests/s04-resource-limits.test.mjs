import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import publicBooking from '../worker/public-booking.ts';
import customerManage from '../worker/customer-manage.ts';
import { boundedRpc } from '../worker/public-rpc.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test', SUPABASE_ANON_KEY: 'anon-test',
  PUBLIC_BOOKING_GATE_SECRET: 'g'.repeat(43), COOKIE_SECURE: 'false',
};
const token = 't'.repeat(43);
const staffId = '7b000000-0000-4000-8000-000000000204';
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});
const request = (route, body, testEnv=env, cookie) => customerManage.request(`http://localhost/${route}`, {
  method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':'s04-http-command',
    'CF-Connecting-IP':'203.0.113.12', ...(cookie?{Cookie:cookie}:{})}, body:JSON.stringify(body),
}, testEnv);

test('S04 all capability operations require gate and surface quota without raw RPC fallback', async t => {
  const realFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=realFetch;});
  const routes = [
    ['view','manage_view',{token}], ['slots','manage_slots',{token,date:'2026-09-20'}],
    ['reschedule','manage_reschedule',{token,staffId,startsAt:'2026-09-20T09:00:00Z'}],
    ['cancel','manage_cancel',{token}],
  ];
  for (const [route,action,body] of routes) {
    let calls=0;
    globalThis.fetch=async (url,init)=>{
      calls++;
      assert.equal(new URL(url).pathname,'/rest/v1/rpc/execute_public_operation');
      assert.ok(!String(url).includes(token));
      const wire=JSON.parse(init.body);
      assert.equal(wire.p_action,action); assert.equal(wire.p_args.p_token,token);
      assert.equal(wire.p_gate_secret,env.PUBLIC_BOOKING_GATE_SECRET);
      assert.match(wire.p_actor_hash,/^[a-f0-9]{64}$/); assert.match(wire.p_network_hash,/^[a-f0-9]{64}$/);
      assert.ok(!init.body.includes('203.0.113.12'));
      return json({ok:false,error:{message:'PUBLIC_BOOKING_RATE_LIMITED:23'}});
    };
    const unavailable=await request(route,body,{...env,PUBLIC_BOOKING_GATE_SECRET:undefined});
    assert.equal(unavailable.status,503); assert.equal(calls,0);
    const limited=await request(route,body);
    assert.equal(limited.status,429,route); assert.equal(limited.headers.get('Retry-After'),'23');
    assert.equal((await limited.json()).error.retryAfterSeconds,23); assert.equal(calls,1);
  }
});

test('S04 public and manage share one signed /api cookie; old narrow cookie cannot shadow it', async t=>{
  const realFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=realFetch;});
  const proofs=[];
  globalThis.fetch=async (_,init)=>{
    const body=JSON.parse(init.body); proofs.push(body);
    return json({ok:true,data: body.p_action==='business'?[{slug:'salon',name:'Salon'}]:body.p_action==='manage_view'?[{appointment_id:'id'}]:[]});
  };
  const first=await publicBooking.request('http://localhost/business/salon',{headers:{'CF-Connecting-IP':'203.0.113.12'}},env);
  assert.equal(first.status,200);
  const set=first.headers.get('set-cookie'); assert.match(set,/Path=\/api(?:;|$)/); assert.match(set,/HttpOnly/);
  const pair=set.split(';')[0];
  const managed=await request('view',{token},env,`yzt_public_client=old-narrow-cookie; ${pair}`);
  assert.equal(managed.status,200);
  assert.equal(proofs[0].p_actor_hash,proofs.at(-1).p_actor_hash);
  assert.equal(proofs[0].p_network_hash,proofs.at(-1).p_network_hash);
});

test('S04 transport/invalid envelopes fail closed, HTTP 200 domain rejection stays rejection', async t=>{
  const realFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=realFetch;});
  for (const body of [[], {}, {ok:true,data:{}}, {ok:false}, {ok:'true',data:[]}]) {
    globalThis.fetch=async()=>json(body);
    const result=await boundedRpc(env,'execute_public_operation',{});
    assert.equal(result.ok,false);
    const response=await request('view',{token});
    assert.equal(response.status,503); // Not a misleading invalid-link 404.
  }
  globalThis.fetch=async()=>{throw new Error('network timeout');};
  assert.equal((await request('slots',{token,date:'2026-09-20'})).status,503);
  globalThis.fetch=async()=>json({ok:false,error:{message:'SLOT_UNAVAILABLE'}});
  assert.equal((await request('reschedule',{token,staffId,startsAt:'2026-09-20T09:00:00Z'})).status,409);
  globalThis.fetch=async()=>json({ok:true,data:[]});
  assert.equal((await request('view',{token})).status,404);
});

test('S04 business creation forwards real user JWT and preserves S02 guard before bounded RPC', async t=>{
  const realFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=realFetch;});
  // Auth/CSRF cannot be bypassed merely by choosing the new bounded route.
  let calls=0; globalThis.fetch=async()=>{calls++;return json({});};
  const denied=await app.request('http://localhost/api/businesses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Salon'})},env);
  assert.equal(denied.status,403); assert.equal(calls,0);
  globalThis.fetch=async (_,init)=>{
    assert.equal(init.headers.get('Authorization'),'Bearer user-jwt');
    const args=JSON.parse(init.body); assert.equal('p_user_id' in args,false);
    return json({ok:false,error:{message:'PUBLIC_BOOKING_RATE_LIMITED:120'}});
  };
  const result=await boundedRpc(env,'create_business_with_owner_guarded',{p_name:'Salon',p_slug:'salon',p_timezone:'UTC'},'user-jwt');
  assert.equal(result.ok,false); assert.equal(result.data.message,'PUBLIC_BOOKING_RATE_LIMITED:120');
});

test('S04 authenticated business HTTP route returns 429 and Retry-After, then creates normally', async t=>{
  const realFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=realFetch;});
  const user={id:'10000000-0000-4000-8000-000000000001',email:'owner@example.test'};
  const now=Math.floor(Date.now()/1000);
  const accessToken=[{alg:'RS256',typ:'JWT'}, {iss:`${env.SUPABASE_URL}/auth/v1`,aud:'authenticated',sub:user.id,
    exp:now+3600,iat:now,role:'authenticated',session_id:'40000000-0000-4000-8000-000000000001',amr:[{method:'password',timestamp:now}]}]
    .map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.test-signature';
  const csrf='c'.repeat(43);
  const init={method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost','Sec-Fetch-Site':'same-origin',
    'X-YZT-CSRF':csrf,Cookie:`yzt_access=${accessToken}; yzt_refresh=refresh; yzt_csrf=${csrf}`},body:JSON.stringify({name:'Salon',slug:'salon',timezone:'UTC'})};
  let limited=true;
  globalThis.fetch=async(url,fetchInit)=>{
    if(String(url).endsWith('/auth/v1/user'))return json(user);
    assert.ok(String(url).endsWith('/rpc/create_business_with_owner_guarded'));
    assert.equal(fetchInit.headers.get('Authorization'),`Bearer ${accessToken}`);
    return limited?json({ok:false,error:{message:'PUBLIC_BOOKING_RATE_LIMITED:59'}}):json({ok:true,data:[{id:staffId,name:'Salon',slug:'salon',timezone:'UTC',role:'owner'}]});
  };
  const rejected=await app.request('http://localhost/api/businesses',init,{...env,PUBLIC_APP_ORIGIN:'http://localhost'});
  assert.equal(rejected.status,429); assert.equal(rejected.headers.get('Retry-After'),'59');
  assert.equal((await rejected.json()).error.code,'BUSINESS_CREATE_RATE_LIMITED');
  assert.ok(!(rejected.headers.get('set-cookie')??'').includes('yzt_business='));
  limited=false;
  const created=await app.request('http://localhost/api/businesses',init,{...env,PUBLIC_APP_ORIGIN:'http://localhost'});
  assert.equal(created.status,201); assert.equal((await created.json()).business.slug,'salon');
  assert.match(created.headers.get('set-cookie'),/yzt_business=/);
});
