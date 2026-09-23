import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from './api';
import { useWorkspace } from './workspace-context';

type ExpenseEvent = {
  eventId: string; businessId: string; eventType: 'expense'|'reversal';
  sourceExpenseEventId: string|null; category: string; description: string|null;
  amountMinor: number; effectMinor: number; currency: string; paymentMethod: 'cash'|'card';
  occurredAt: string; businessDate: string; timezone: string; reason: string|null; actorMembershipId: string; createdAt: string;
};
type PageInfo={limit:number;hasMore:boolean;nextCursor:string|null};
type ExpenseList={events:ExpenseEvent[];page:PageInfo};
type PendingExpenseWrite={
  businessId:string;action:string;idempotencyKey:string;path:string;method:string;body:string|null;
};
const PENDING_EXPENSE_KEY='randevu:expenses:pending-write:v1';
function samePending(left:PendingExpenseWrite|null,right:PendingExpenseWrite){
  return Boolean(left&&left.businessId===right.businessId&&left.action===right.action
    &&left.idempotencyKey===right.idempotencyKey&&left.path===right.path
    &&left.method===right.method&&left.body===right.body);
}
function readPendingExpense():PendingExpenseWrite|null{
  if(typeof window==='undefined')return null;
  try{
    const raw=window.sessionStorage.getItem(PENDING_EXPENSE_KEY);if(!raw)return null;
    const v=JSON.parse(raw) as Partial<PendingExpenseWrite>;
    if(typeof v.businessId!=='string'||typeof v.action!=='string'||typeof v.idempotencyKey!=='string'
      ||typeof v.path!=='string'||typeof v.method!=='string'||(v.body!==null&&typeof v.body!=='string')
      ||!v.businessId||!v.action||v.idempotencyKey.length<8||v.idempotencyKey.length>128
      ||!v.path.startsWith('/api/expenses')||v.method!=='POST'){
      window.sessionStorage.removeItem(PENDING_EXPENSE_KEY);return null;
    }
    return v as PendingExpenseWrite;
  }catch{return null;}
}
function writePendingExpense(v:PendingExpenseWrite){try{window.sessionStorage.setItem(PENDING_EXPENSE_KEY,JSON.stringify(v));}catch{}}
function clearPendingExpense(v:PendingExpenseWrite){try{const c=readPendingExpense();if(!c||samePending(c,v))window.sessionStorage.removeItem(PENDING_EXPENSE_KEY);}catch{}}

function money(minor:number,currency:string){return new Intl.NumberFormat('tr-TR',{style:'currency',currency}).format(minor/100);}
function parseMoneyMinor(value:FormDataEntryValue|null){
  const raw=String(value??'').trim().replace(',','.');
  const m=raw.match(/^(\d{1,9})(?:\.(\d{1,2}))?$/); if(!m) return null;
  const n=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));
  return Number.isSafeInteger(n)&&n>0&&n<=100000000?n:null;
}
function localWallClock(value:FormDataEntryValue|null){
  const raw=String(value??'').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)?raw:null;
}
function localWallFromInstant(instant:string,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
  const part=(type:string)=>parts.find((item)=>item.type===type)?.value??'';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
function nowLocalInZone(timeZone:string){
  return localWallFromInstant(new Date().toISOString(),timeZone);
}

function ambiguous(error:unknown){
  return error instanceof ApiRequestError && (error.status===0||error.status===408||error.status===503);
}

export default function ExpensesPage(){
  const {activeBusinessId,activeBusiness,scopeEpoch}=useWorkspace();
  const [events,setEvents]=useState<ExpenseEvent[]>([]);
  const [page,setPage]=useState<PageInfo|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState('');
  const [pendingWrite,setPendingWrite]=useState<PendingExpenseWrite|null>(()=>readPendingExpense());
  const keys=useRef(new Map<string,string>());
  const generation=useRef(0);

  const load=useCallback(async(cursor:string|null=null,append=false)=>{
    const g=++generation.current; if(!append)setLoading(true);
    try{
      const params=new URLSearchParams({limit:'25'}); if(cursor)params.set('cursor',cursor);
      const result=await api<ExpenseList>(`/api/expenses?${params}`);
      if(g!==generation.current)return;
      if(result.events.some(e=>e.businessId!==activeBusinessId)) throw new Error('Masraf kayıtları güncel işletmeyle eşleşmiyor.');
      setEvents(current=>append?[...current,...result.events]:result.events); setPage(result.page);
    }catch(error){
      if(g!==generation.current)return;
      setNotice(error instanceof Error?error.message:'Masraflar yüklenemedi.');
      if(!append){setEvents([]);setPage(null);}
    }finally{if(g===generation.current)setLoading(false);}
  },[activeBusinessId]);

  useEffect(()=>{keys.current.clear();setPendingWrite(readPendingExpense());setEvents([]);setPage(null);setNotice('');void load();},[activeBusinessId,scopeEpoch,load]);

  async function mutate(action:string,path:string,payload:Record<string,unknown>){
    const method='POST';
    const body=JSON.stringify(payload);
    const matches=Boolean(pendingWrite&&pendingWrite.businessId===activeBusinessId&&pendingWrite.action===action
      &&pendingWrite.path===path&&pendingWrite.method===method&&pendingWrite.body===body);
    if(pendingWrite&&!matches){
      setNotice(pendingWrite.businessId===activeBusinessId
        ?'Önce sonucu belirsiz masraf işlemini doğrulayın. Yeni mali işlem başlatılmadı.'
        :'Başka işletmede sonucu belirsiz masraf işlemi var. Önce o işletmede doğrulayın.');
      return false;
    }

    setBusy(true);setNotice('');
    const key=matches?pendingWrite!.idempotencyKey:(keys.current.get(action)??crypto.randomUUID());
    keys.current.set(action,key);
    const identity:PendingExpenseWrite={businessId:activeBusinessId,action,idempotencyKey:key,path,method,body};
    try{
      await api(path,{method,headers:{'Idempotency-Key':key},body});
      keys.current.delete(action);
      clearPendingExpense(identity);
      setPendingWrite(current=>samePending(current,identity)?null:current);
      await load(); return true;
    }catch(error){
      if(ambiguous(error)){
        writePendingExpense(identity);setPendingWrite(identity);
        setNotice('Masraf işleminin sonucu belirsiz. Kayıtlı istek doğrulanana kadar başka mali işlem başlatılmayacak.');
      }else{
        keys.current.delete(action);clearPendingExpense(identity);
        setPendingWrite(current=>samePending(current,identity)?null:current);
        setNotice(error instanceof Error?error.message:'Masraf işlemi tamamlanamadı.');
      }
      return false;
    }finally{setBusy(false);}
  }

  async function retryPending(){
    if(!pendingWrite)return;
    if(pendingWrite.businessId!==activeBusinessId){setNotice('Belirsiz işlemi doğrulamak için önce işlemin başladığı işletmeye dönün.');return;}
    let payload:Record<string,unknown>;
    try{payload=pendingWrite.body?JSON.parse(pendingWrite.body):{};}catch{setNotice('Kayıtlı masraf isteği bozuk; yeni işlem başlatılmadı.');return;}
    if(await mutate(pendingWrite.action,pendingWrite.path,payload))setNotice('Belirsiz masraf işlemi sunucuda doğrulandı.');
  }

  async function createExpense(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const form=event.currentTarget; const data=new FormData(form);
    const amountMinor=parseMoneyMinor(data.get('amount')); const occurredAt=localWallClock(data.get('occurredAt'));
    if(amountMinor===null||!occurredAt)return setNotice('Tutar ve tarih/saat geçerli olmalı.');
    const body={category:String(data.get('category')??'').trim(),description:String(data.get('description')??'').trim()||null,amountMinor,currency:'TRY',paymentMethod:data.get('paymentMethod'),occurredAt};
    if(await mutate(`create:${JSON.stringify(body)}`,'/api/expenses',body)){form.reset();setNotice('Masraf kaydedildi.');}
  }

  async function reverse(eventId:string){
    const reason=window.prompt('İptal gerekçesi'); if(!reason?.trim())return;
    const timeZone=activeBusiness?.timezone??'Europe/Istanbul';
    if(await mutate(`reverse:${eventId}:${reason.trim()}`,`/api/expenses/${eventId}/reverse`,{reason:reason.trim(),occurredAt:nowLocalInZone(timeZone)})) setNotice('Masraf reversal hareketi kaydedildi.');
  }

  async function correct(expense:ExpenseEvent){
    const amount=window.prompt('Yeni tutar (TL)',String(expense.amountMinor/100).replace('.',','));
    if(amount===null)return;
    const amountMinor=parseMoneyMinor(amount);
    const reason=window.prompt('Düzeltme gerekçesi');
    if(amountMinor===null||!reason?.trim())return setNotice('Yeni tutar ve düzeltme gerekçesi gerekli.');
    const timeZone=expense.timezone||activeBusiness?.timezone||'Europe/Istanbul';
    const body={
      reason:reason.trim(),
      category:expense.category,
      description:expense.description,
      amountMinor,
      currency:expense.currency,
      paymentMethod:expense.paymentMethod,
      occurredAt:localWallFromInstant(expense.occurredAt,timeZone),
      correctionOccurredAt:nowLocalInZone(timeZone),
    };
    if(await mutate(`correct:${expense.eventId}:${JSON.stringify(body)}`,`/api/expenses/${expense.eventId}/correct`,body)) setNotice('Masraf düzeltmesi reversal + yeni kayıt olarak kaydedildi.');
  }

  return <main className="expenses-shell">
    <header className="expenses-hero"><div><p className="expenses-eyebrow">MASRAFLAR</p><h1>Gider kayıtları</h1><p>Geçmiş mali kayıtlar silinmez; düzeltmeler yeni hareket olarak eklenir.</p></div></header>
    {notice&&<div className="expenses-notice" role="status">{notice}</div>}
    {pendingWrite&&<div className="expenses-notice" role="alert"><strong>Sonucu belirsiz masraf işlemi korunuyor.</strong>{' '}
      {pendingWrite.businessId===activeBusinessId
        ?<button disabled={busy} onClick={()=>void retryPending()}>Kayıtlı isteği doğrula</button>
        :<span>İşlemin başladığı işletmeye dönün.</span>}
    </div>}
    <section className="expenses-grid">
      <article className="expenses-card">
        <h2>Yeni masraf</h2>
        <form className="expenses-form" onSubmit={createExpense}>
          <label>Kategori<input name="category" required maxLength={80} placeholder="Örn. Malzeme" /></label>
          <label>Açıklama<input name="description" maxLength={240} /></label>
          <label>Tutar<input name="amount" required inputMode="decimal" placeholder="150,00" /></label>
          <label>Ödeme yöntemi<select name="paymentMethod" defaultValue="cash"><option value="cash">Nakit</option><option value="card">Kart</option></select></label>
          <label>Tarih ve saat<input name="occurredAt" type="datetime-local" required /></label>
          <button disabled={busy}>Masrafı kaydet</button>
        </form>
      </article>
      <article className="expenses-card">
        <h2>Hareketler</h2>
        {loading?<p>Masraflar yükleniyor…</p>:events.length===0?<p>Henüz masraf hareketi yok.</p>:<ol className="expenses-list">{events.map(e=><li key={e.eventId}>
          <div><strong>{e.eventType==='expense'?e.category:'Reversal'}</strong><span>{new Date(e.occurredAt).toLocaleString('tr-TR')} · {e.paymentMethod==='cash'?'Nakit':'Kart'}</span>{e.description&&<small>{e.description}</small>}{e.reason&&<small>{e.reason}</small>}</div>
          <div><strong className={e.effectMinor<0?'negative':'positive'}>{e.effectMinor<0?'-':''}{money(Math.abs(e.effectMinor),e.currency)}</strong>{e.eventType==='expense'&&<><button disabled={busy} onClick={()=>void correct(e)}>Düzelt</button><button disabled={busy} onClick={()=>void reverse(e.eventId)}>İptal / reversal</button></>}</div>
        </li>)}</ol>}
        {page?.hasMore&&<button className="expenses-more" disabled={busy} onClick={()=>void load(page.nextCursor,true)}>Daha fazla</button>}
      </article>
    </section>
  </main>;
}
