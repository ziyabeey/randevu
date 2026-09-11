import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

type Role = 'owner' | 'manager' | 'staff';
type Session = {
  user: null | { id: string; email: string | null; fullName: string | null };
  memberships: Array<{ id: string; business_id: string; role: Role; active: boolean }>;
  activeBusinessId: string | null;
};
type Service = { id: string; name: string; active: boolean };
type Staff = { id: string; name: string; active: boolean };
type Catalog = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  services: Service[];
  staff: Staff[];
};
type HourRow = { id: string; weekday: number; starts_local: string; ends_local: string; active: boolean };
type StaffHourRow = HourRow & { staff_id: string };
type Block = {
  id: string;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  active: boolean;
};
type Setup = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  timezone: string;
  businessHours: HourRow[];
  staffHours: StaffHourRow[];
  blocks: Block[];
};
type Slot = { staff_id: string; staff_name: string; starts_at: string; ends_at: string; timezone: string };
type ApiError = { error?: { message?: string } };

const weekdays = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? 'İşlem tamamlanamadı.');
  return body;
}

function dateToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shortTime(value: string) {
  return value.slice(0, 5);
}

function formatSlot(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
  }).format(new Date(value));
}

export default function AvailabilityPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextSession = await api<Session>('/api/session');
      setSession(nextSession);
      if (!nextSession.user || !nextSession.activeBusinessId) {
        setCatalog(null);
        setSetup(null);
        return;
      }
      const [nextCatalog, nextSetup] = await Promise.all([
        api<Catalog>('/api/catalog'),
        api<Setup>('/api/availability/setup'),
      ]);
      setCatalog(nextCatalog);
      setSetup(nextSetup);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Müsaitlik bilgileri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canManage = setup?.membership.role === 'owner' || setup?.membership.role === 'manager';
  const activeServices = useMemo(() => catalog?.services.filter((item) => item.active) ?? [], [catalog]);
  const activeStaff = useMemo(() => catalog?.staff.filter((item) => item.active) ?? [], [catalog]);

  async function replaceBusinessDay(weekday: number, intervals: Array<{ start: string; end: string }>) {
    await api(`/api/availability/business-hours/${weekday}`, {
      method: 'PUT', body: JSON.stringify({ intervals }),
    });
  }

  async function addBusinessHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice('');
    const form = event.currentTarget; const data = new FormData(form);
    const weekday = Number(data.get('weekday')); const start = String(data.get('start')); const end = String(data.get('end'));
    const existing = (setup?.businessHours ?? []).filter((item) => item.weekday === weekday).map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
    try {
      await replaceBusinessDay(weekday, [...existing, { start, end }]);
      setNotice('İşletme çalışma aralığı kaydedildi.'); form.reset(); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Saatler kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function removeBusinessHours(row: HourRow) {
    setBusy(true); setNotice('');
    const intervals = (setup?.businessHours ?? []).filter((item) => item.weekday === row.weekday && item.id !== row.id).map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
    try { await replaceBusinessDay(row.weekday, intervals); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Aralık kaldırılamadı.'); }
    finally { setBusy(false); }
  }

  async function replaceStaffDay(staffId: string, weekday: number, intervals: Array<{ start: string; end: string }>) {
    await api(`/api/availability/staff/${staffId}/hours/${weekday}`, {
      method: 'PUT', body: JSON.stringify({ intervals }),
    });
  }

  async function addStaffHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice('');
    const form = event.currentTarget; const data = new FormData(form);
    const staffId = String(data.get('staffId')); const weekday = Number(data.get('weekday'));
    const start = String(data.get('start')); const end = String(data.get('end'));
    const existing = (setup?.staffHours ?? []).filter((item) => item.staff_id === staffId && item.weekday === weekday).map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
    try {
      await replaceStaffDay(staffId, weekday, [...existing, { start, end }]);
      setNotice('Personel çalışma aralığı kaydedildi.'); form.reset(); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Personel saatleri kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function removeStaffHours(row: StaffHourRow) {
    setBusy(true); setNotice('');
    const intervals = (setup?.staffHours ?? []).filter((item) => item.staff_id === row.staff_id && item.weekday === row.weekday && item.id !== row.id).map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
    try { await replaceStaffDay(row.staff_id, row.weekday, intervals); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Aralık kaldırılamadı.'); }
    finally { setBusy(false); }
  }

  async function addBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice('');
    const form = event.currentTarget; const data = new FormData(form);
    try {
      await api('/api/availability/blocks', {
        method: 'POST',
        body: JSON.stringify({
          date: data.get('date'), start: data.get('start'), end: data.get('end'),
          staffId: data.get('staffId') || null, reason: data.get('reason'),
        }),
      });
      setNotice('İzin/kapanış eklendi. 00:00 → 00:00 tüm günü kapatır.'); form.reset(); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Kapanış kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function deleteBlock(id: string) {
    setBusy(true); setNotice('');
    try { await api(`/api/availability/blocks/${id}`, { method: 'DELETE' }); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Kayıt silinemedi.'); }
    finally { setBusy(false); }
  }

  async function previewSlots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice(''); setSlots([]);
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams({
      date: String(data.get('date')),
      serviceId: String(data.get('serviceId')),
      staffId: String(data.get('staffId') || 'any'),
      step: String(data.get('step') || '15'),
    });
    try {
      const result = await api<{ slots: Slot[] }>(`/api/availability/slots?${params}`);
      setSlots(result.slots);
      setNotice(result.slots.length ? `${result.slots.length} uygun slot hesaplandı.` : 'Bu seçim için uygun slot yok.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Slotlar hesaplanamadı.'); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="availability-page"><section className="availability-card"><p>Takvim motoru hazırlanıyor…</p></section></main>;

  if (!session?.user || !session.activeBusinessId || !catalog || !setup) {
    return <main className="availability-page"><section className="availability-card"><p className="eyebrow">MÜSAİTLİK</p><h1>Önce çalışma alanını seçin.</h1><p className="muted">Giriş ve işletme seçimi ana çalışma alanında yapılır.</p><a className="primary-link" href="/">Çalışma alanına dön</a></section></main>;
  }

  return (
    <div className="availability-page">
      <header className="availability-hero">
        <div><p className="eyebrow">FAZ 4 · MÜSAİTLİK MOTORU</p><h1>Çalışma saatleri ve gerçek slotlar</h1><p className="muted">Saat dilimi: <strong>{setup.timezone}</strong>. Molalar, haftalık saatleri iki aralığa bölerek tanımlanır.</p></div>
        <span className="role-badge">{setup.membership.role}</span>
      </header>

      {notice && <div className="notice" role="status">{notice}</div>}

      <div className="availability-grid">
        <section className="availability-card">
          <div className="section-head"><h2>İşletme saatleri</h2><span>{setup.businessHours.length} aralık</span></div>
          <div className="schedule-list">
            {setup.businessHours.map((row) => <div className="schedule-row" key={row.id}><span>{weekdays[row.weekday]}</span><strong>{shortTime(row.starts_local)}–{shortTime(row.ends_local)}</strong>{canManage && <button disabled={busy} onClick={() => void removeBusinessHours(row)}>Sil</button>}</div>)}
            {!setup.businessHours.length && <p className="empty">Henüz işletme çalışma saati yok.</p>}
          </div>
          {canManage && <form className="availability-form" onSubmit={addBusinessHours}>
            <select name="weekday" defaultValue="1" aria-label="Gün">{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
            <input name="start" type="time" defaultValue="09:00" required aria-label="Başlangıç" />
            <input name="end" type="time" defaultValue="18:00" required aria-label="Bitiş" />
            <button className="primary-button" disabled={busy}>Aralık ekle</button>
          </form>}
        </section>

        <section className="availability-card">
          <div className="section-head"><h2>Personel saatleri</h2><span>{setup.staffHours.length} aralık</span></div>
          <div className="schedule-list">
            {setup.staffHours.map((row) => <div className="schedule-row" key={row.id}><span>{activeStaff.find((item) => item.id === row.staff_id)?.name ?? 'Personel'} · {weekdays[row.weekday]}</span><strong>{shortTime(row.starts_local)}–{shortTime(row.ends_local)}</strong>{canManage && <button disabled={busy} onClick={() => void removeStaffHours(row)}>Sil</button>}</div>)}
            {!setup.staffHours.length && <p className="empty">Henüz personel saati yok.</p>}
          </div>
          {canManage && activeStaff.length > 0 && <form className="availability-form" onSubmit={addStaffHours}>
            <select name="staffId" required aria-label="Personel">{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <select name="weekday" defaultValue="1" aria-label="Gün">{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
            <input name="start" type="time" defaultValue="09:00" required aria-label="Başlangıç" />
            <input name="end" type="time" defaultValue="18:00" required aria-label="Bitiş" />
            <button className="primary-button" disabled={busy}>Aralık ekle</button>
          </form>}
        </section>

        <section className="availability-card">
          <div className="section-head"><h2>İzin / kapanış</h2><span>{setup.blocks.length}</span></div>
          <div className="schedule-list">
            {setup.blocks.map((block) => <div className="block-row" key={block.id}><div><strong>{block.staff_id ? activeStaff.find((item) => item.id === block.staff_id)?.name ?? 'Personel' : 'Tüm işletme'}</strong><span>{new Date(block.starts_at).toLocaleString('tr-TR')} → {new Date(block.ends_at).toLocaleString('tr-TR')}</span><small>{block.reason || 'Neden belirtilmedi'}</small></div>{canManage && <button disabled={busy} onClick={() => void deleteBlock(block.id)}>Sil</button>}</div>)}
            {!setup.blocks.length && <p className="empty">Planlanmış izin veya kapanış yok.</p>}
          </div>
          {canManage && <form className="availability-form block-form" onSubmit={addBlock}>
            <input name="date" type="date" defaultValue={dateToday()} required aria-label="Tarih" />
            <input name="start" type="time" defaultValue="12:00" required aria-label="Başlangıç" />
            <input name="end" type="time" defaultValue="13:00" required aria-label="Bitiş" />
            <select name="staffId" aria-label="Kapsam"><option value="">Tüm işletme</option>{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <input name="reason" maxLength={240} placeholder="Neden (isteğe bağlı)" />
            <button className="primary-button" disabled={busy}>Kapat</button>
          </form>}
        </section>

        <section className="availability-card slot-card">
          <div className="section-head"><h2>Slot önizleme</h2><span>Booking yazmaz</span></div>
          <form className="availability-form slot-form" onSubmit={previewSlots}>
            <input name="date" type="date" defaultValue={dateToday()} required aria-label="Tarih" />
            <select name="serviceId" required aria-label="Hizmet">{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
            <select name="staffId" aria-label="Personel"><option value="any">Fark etmez</option>{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <select name="step" defaultValue="15" aria-label="Slot adımı"><option value="10">10 dk</option><option value="15">15 dk</option><option value="20">20 dk</option><option value="30">30 dk</option><option value="60">60 dk</option></select>
            <button className="primary-button" disabled={busy || activeServices.length === 0}>Hesapla</button>
          </form>
          <div className="slot-list">
            {slots.map((slot) => <div className="slot-pill" key={`${slot.staff_id}-${slot.starts_at}`}><strong>{formatSlot(slot.starts_at, slot.timezone)}</strong><span>{slot.staff_name}</span></div>)}
          </div>
          {!slots.length && <p className="empty">Önizleme için hizmet, personel ve çalışma saatleri tanımlı olmalı.</p>}
        </section>
      </div>
    </div>
  );
}
