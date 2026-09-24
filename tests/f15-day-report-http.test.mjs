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

const user={id:'f1b00000-0000-4000-8000-000000000001',email:'f1504@example.test'};
const businessId='f1b10000-0000-4000-8000-000000000001';
const membershipId='f1b20000-0000-4000-8000-000000000001';

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function token(){
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub:user.id,session_id:'f1b30000-0000-4000-8000-000000000001',amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `${h}.${p}.sig`;
}
function cookie(){return `yzt_access=${token()}; yzt_refresh=f1504-report; yzt_business=${businessId}`;}
function baseFetch(rpc){
  return async(input,init={})=>{
    const url=new URL(String(input));
    if(url.pathname==='/auth/v1/user')return json(user);
    if(url.pathname==='/rest/v1/memberships')return json([{id:membershipId,business_id:businessId,role:'owner',active:true}]);
    return rpc(url,init);
  };
}

await test('F15-04 report derives tenant and sends a bounded date range to the RPC',async()=>{
  const real=globalThis.fetch;
  let body;
  globalThis.fetch=baseFetch(async(url,init)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/get_financial_day_report');
    body=JSON.parse(init.body);
    return json({
      businessId,
      startDate:'2026-09-23',
      endDate:'2026-09-23',
      timezone:'Europe/Istanbul',
      currency:'TRY',
      collectedMinor:100000,
      expenseMinor:15000,
      netMovementMinor:75000,
    });
  });
  try{
    const r=await app.request('http://localhost/api/reports/financial?startDate=2026-09-23&endDate=2026-09-23&businessId=attacker',{headers:{Cookie:cookie()}},env);
    assert.equal(r.status,200);
    assert.equal(body.p_business_id,businessId);
    assert.equal(body.p_start_date,'2026-09-23');
    assert.equal(body.p_end_date,'2026-09-23');
    assert.equal(JSON.stringify(body).includes('attacker'),false);
    assert.equal((await r.json()).report.netMovementMinor,75000);
  }finally{globalThis.fetch=real;}
});

await test('F15-04 report rejects malformed dates before the report RPC',async()=>{
  const real=globalThis.fetch;
  let rpcCalls=0;
  globalThis.fetch=baseFetch(async()=>{rpcCalls+=1;throw new Error('unexpected report RPC');});
  try{
    const r=await app.request('http://localhost/api/reports/financial?startDate=2026-02-31&endDate=2026-03-01',{headers:{Cookie:cookie()}},env);
    assert.equal(r.status,400);
    assert.equal((await r.json()).error?.code,'INVALID_REPORT_RANGE');
    assert.equal(rpcCalls,0);
  }finally{globalThis.fetch=real;}
});

await test('F15-04 report maps permission and mixed-currency failures explicitly',async()=>{
  for(const [message,status,code] of [
    ['FINANCIAL_REPORTS_PERMISSION_REQUIRED',403,'FINANCIAL_REPORTS_PERMISSION_REQUIRED'],
    ['REPORT_CURRENCY_MIXED',409,'REPORT_CURRENCY_MIXED'],
    ['INVALID_REPORT_RANGE',400,'INVALID_REPORT_RANGE'],
  ]){
    const real=globalThis.fetch;
    globalThis.fetch=baseFetch(async(url)=>{
      assert.equal(url.pathname,'/rest/v1/rpc/get_financial_day_report');
      return json({message},400);
    });
    try{
      const r=await app.request('http://localhost/api/reports/financial?startDate=2026-09-23&endDate=2026-09-23',{headers:{Cookie:cookie()}},env);
      assert.equal(r.status,status,message);
      assert.equal((await r.json()).error?.code,code);
    }finally{globalThis.fetch=real;}
  }
});

await test('F15-04 report preserves transient upstream failure as retryable 503',async()=>{
  const real=globalThis.fetch;
  globalThis.fetch=baseFetch(async(url)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/get_financial_day_report');
    return json({message:'upstream unavailable'},503);
  });
  try{
    const r=await app.request('http://localhost/api/reports/financial?startDate=2026-09-23&endDate=2026-09-23',{headers:{Cookie:cookie()}},env);
    assert.equal(r.status,503);
    assert.equal((await r.json()).error?.code,'REPORT_READ_UNAVAILABLE');
  }finally{globalThis.fetch=real;}
});
