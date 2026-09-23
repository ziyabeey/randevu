import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from './api';
import { useWorkspace } from './workspace-context';

type ExpenseEvent = {
  eventId: string; businessId: string; eventType: 'expense'|'reversal';
  sourceExpenseEventId: string|null; category: string; description: string|null;
  amountMinor: number; effectMinor: number; currency: string; paymentMethod: 'cash'|'card';
  occurredAt: string; reason: string|null; actorMembershipId: string; createdAt: string;
};
type PageInfo={limit:number;hasMore:boolean;nextCursor:string|null};
type ExpenseList={events:ExpenseEvent[];page:PageInfo};

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
function ambiguous(error:unknown){
  return error instanceof ApiRequestError && (error.status===0||error.status===408||error.status===503);
}

export default function ExpensesPage(){
  const {activeBusinessId,scopeEpoch}=useWorkspace();
  const [events,setEvents]=useState<ExpenseEvent[]>([]);
  const [page,setPage]=useState<PageInfo|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState('');
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

  useEffect(()=>{keys.current.clear();setEvents([]);setPage(null);setNotice('');void load();},[activeBusinessId,scopeEpoch,load]);

  async function mutate(action:string,path:string,body:Record<string,unknown>){
    setBusy(true);setNotice('');
    const key=keys.current.get(action)??crypto.randomUUID(); keys.current.set(action,key);
    try{
      await api(path,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(body)});
      keys.current.delete(action); await load(); return true;
    }catch(error){
      if(!ambiguous(error))keys.current.delete(action);
      setNotice(ambiguous(error)?'İşlemin sonucu doğrulanamadı. Aynı formu tekrar gönderirseniz aynı işlem anahtarı kullanılacak.':error instanceof Error?error.message:'Masraf işlemi tamamlanamadı.');
      return false;
    }finally{setBusy(false);}
  }

  async function createExpense(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const form=event.currentTarget; const data=new FormData(form);
    const amountMinor=parseMoneyMinor(data.get('amount')); const occurredAt=localWallClock(data.get('occurredAt'));
    if(amountMinor===null||!occurredAt)return setNotice('Tutar ve tarih/saat geçerli olmalı.');
    const body={category:String(data.get('category')??'').trim(),description:String(data.get('description')??'').trim()||null,amountMinor,currency:'TRY',paymentMethod:data.get('paymentMethod'),occurredAt};
    if(await mutate(`create:${JSON.stringify(body)}`,'/api/expenses',body)){form.reset();setNotice('Masraf kaydedildi.');}
  }

  async function reverse(eventId:string){
    const reason=window.prompt('İptal/düzeltme gerekçesi'); if(!reason?.trim())return;
    if(await mutate(`reverse:${eventId}:${reason.trim()}`,`/api/expenses/${eventId}/reverse`,{reason:reason.trim(),occurredAt:new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(new Date()).replace(' ','T')})) setNotice('Masraf reversal hareketi kaydedildi.');
  }

  return <main className="expenses-shell">
    <header className="expenses-hero"><div><p className="expenses-eyebrow">MASRAFLAR</p><h1>Gider kayıtları</h1><p>Geçmiş mali kayıtlar silinmez; düzeltmeler yeni hareket olarak eklenir.</p></div></header>
    {notice&&<div className="expenses-notice" role="status">{notice}</div>}
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
          <div><strong className={e.effectMinor<0?'negative':'positive'}>{e.effectMinor<0?'-':''}{money(Math.abs(e.effectMinor),e.currency)}</strong>{e.eventType==='expense'&&<button disabled={busy} onClick={()=>void reverse(e.eventId)}>İptal / reversal</button>}</div>
        </li>)}</ol>}
        {page?.hasMore&&<button className="expenses-more" disabled={busy} onClick={()=>void load(page.nextCursor,true)}>Daha fazla</button>}
      </article>
    </section>
  </main>;
}
