import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiRequestError, api } from './api';
import CatalogSettingsPanel, { type ManagedCatalog, type ManagedStaff } from './CatalogSettingsPanel';
import type { Role, Session } from '../shared/types.ts';
import { formatDateTime, roleLabel } from './format.ts';
import { getErrorMessage } from './errors.ts';

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
type Interval = { start: string; end: string };
type LoadState = 'loading' | 'ready' | 'no-workspace' | 'error';

const weekdays = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

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
  const [catalog, setCatalog] = useState<ManagedCatalog | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const requestController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);

  const replaceReadRequest = useCallback(() => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const generation = ++requestGeneration.current;
    return { controller, generation };
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    const { controller, generation } = replaceReadRequest();
    setLoadState('loading');
    setLoadError('');
    try {
      const nextSession = await api<Session>('/api/session', { signal: controller.signal });
      if (controller.signal.aborted || generation !== requestGeneration.current) return false;
      setSession(nextSession);

      if (nextSession.passwordRecovery) {
        setCatalog(null);
        setSetup(null);
        setSlots([]);
        setLoadError('Parolanızı güncelledikten sonra işletme ayarlarını yeniden açın.');
        setLoadState('error');
        return false;
      }

      if (!nextSession.user || !nextSession.activeBusinessId) {
        setCatalog(null);
        setSetup(null);
        setSlots([]);
        setLoadState('no-workspace');
        return false;
      }

      const [nextCatalog, nextSetup] = await Promise.all([
        api<ManagedCatalog>('/api/catalog', { signal: controller.signal }),
        api<Setup>('/api/availability/setup', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted || generation !== requestGeneration.current) return false;
      if (nextCatalog.membership.business_id !== nextSession.activeBusinessId
          || nextSetup.membership.business_id !== nextSession.activeBusinessId) {
        throw new Error('Seçili işletmenin güncel ayarları doğrulanamadı. Tekrar yükleyin.');
      }
      setCatalog(nextCatalog);
      setSetup(nextSetup);
      setSlots([]);
      setLoadState('ready');
      return true;
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGeneration.current) return false;
      setCatalog(null);
      setSetup(null);
      setSlots([]);
      setLoadError(getErrorMessage(error, 'İşletme ayarları yüklenemedi.'));
      setLoadState('error');
      return false;
    }
  }, [replaceReadRequest]);

  useEffect(() => {
    void load();
    return () => requestController.current?.abort();
  }, [load]);

  const canManage = setup?.membership.role === 'owner' || setup?.membership.role === 'manager';
  const activeServices = useMemo(() => catalog?.services.filter((item) => item.active) ?? [], [catalog]);
  const activeStaff = useMemo<ManagedStaff[]>(() => catalog?.staff.filter((item) => item.active) ?? [], [catalog]);

  function businessIntervals(weekday: number): Interval[] {
    return (setup?.businessHours ?? [])
      .filter((item) => item.weekday === weekday)
      .map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
  }

  function staffIntervals(staffId: string, weekday: number): Interval[] {
    return (setup?.staffHours ?? [])
      .filter((item) => item.staff_id === staffId && item.weekday === weekday)
      .map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
  }

  async function refreshAfterMutation(success: string) {
    const refreshed = await load();
    if (refreshed) setNotice(success);
    return refreshed;
  }

  async function handleMutationFailure(error: unknown, fallback: string) {
    if (error instanceof ApiRequestError && error.status === 409 && error.code === 'STALE_WRITE') {
      const refreshed = await load();
      if (refreshed) {
        setNotice('Bu kayıt başka bir oturumda değişti. Güncel bilgiler yeniden yüklendi; yaptığınız değişiklik uygulanmadı.');
      }
      return;
    }
    setNotice(getErrorMessage(error, fallback));
  }

  async function replaceBusinessDay(weekday: number, intervals: Interval[], expectedIntervals: Interval[]) {
    await api(`/api/availability/business-hours/${weekday}`, {
      method: 'PUT', body: JSON.stringify({ intervals, expectedIntervals }),
    });
  }

  async function addBusinessHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice('');
    const form = event.currentTarget; const data = new FormData(form);
    const weekday = Number(data.get('weekday')); const start = String(data.get('start')); const end = String(data.get('end'));
    const existing = businessIntervals(weekday);
    try {
      await replaceBusinessDay(weekday, [...existing, { start, end }], existing);
      if (await refreshAfterMutation('İşletme çalışma aralığı kaydedildi. Değişiklik mevcut randevuları taşımaz; yeni uygunlukları etkiler.')) form.reset();
    } catch (error) { await handleMutationFailure(error, 'Saatler kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function removeBusinessHours(row: HourRow) {
    setBusy(true); setNotice('');
    const expected = businessIntervals(row.weekday);
    const intervals = (setup?.businessHours ?? [])
      .filter((item) => item.weekday === row.weekday && item.id !== row.id)
      .map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
    try {
      await replaceBusinessDay(row.weekday, intervals, expected);
      await refreshAfterMutation('Çalışma aralığı kaldırıldı. Mevcut randevular değişmedi.');
    } catch (error) { await handleMutationFailure(error, 'Aralık kaldırılamadı.'); }
    finally { setBusy(false); }
  }

  async function replaceStaffDay(staffId: string, weekday: number, intervals: Interval[], expectedIntervals: Interval[]) {
    await api(`/api/availability/staff/${staffId}/hours/${weekday}`, {
      method: 'PUT', body: JSON.stringify({ intervals, expectedIntervals }),
    });
  }

  async function addStaffHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice('');
    const form = event.currentTarget; const data = new FormData(form);
    const staffId = String(data.get('staffId')); const weekday = Number(data.get('weekday'));
    const start = String(data.get('start')); const end = String(data.get('end'));
    const existing = staffIntervals(staffId, weekday);
    try {
      await replaceStaffDay(staffId, weekday, [...existing, { start, end }], existing);
      if (await refreshAfterMutation('Personel çalışma aralığı kaydedildi. Mevcut randevular değişmedi.')) form.reset();
    } catch (error) { await handleMutationFailure(error, 'Personel saatleri kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function removeStaffHours(row: StaffHourRow) {
    setBusy(true); setNotice('');
    const expected = staffIntervals(row.staff_id, row.weekday);
    const intervals = (setup?.staffHours ?? [])
      .filter((item) => item.staff_id === row.staff_id && item.weekday === row.weekday && item.id !== row.id)
      .map((item) => ({ start: shortTime(item.starts_local), end: shortTime(item.ends_local) }));
    try {
      await replaceStaffDay(row.staff_id, row.weekday, intervals, expected);
      await refreshAfterMutation('Personel çalışma aralığı kaldırıldı. Mevcut randevular değişmedi.');
    } catch (error) { await handleMutationFailure(error, 'Aralık kaldırılamadı.'); }
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
      if (await refreshAfterMutation('İzin/kapanış eklendi. Mevcut randevular otomatik iptal edilmez veya taşınmaz.')) form.reset();
    } catch (error) { await handleMutationFailure(error, 'Kapanış kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  async function deleteBlock(id: string) {
    setBusy(true); setNotice('');
    try {
      await api(`/api/availability/blocks/${id}`, { method: 'DELETE' });
      await refreshAfterMutation('İzin/kapanış kaldırıldı.');
    } catch (error) { await handleMutationFailure(error, 'Kayıt silinemedi.'); }
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
      setNotice(result.slots.length ? `${result.slots.length} uygun saat bulundu.` : 'Bu seçim için uygun saat yok.');
    } catch (error) { setNotice(getErrorMessage(error, 'Uygun saatler hesaplanamadı.')); }
    finally { setBusy(false); }
  }

  if (loadState === 'loading') {
    return <main className="availability-page"><section className="availability-card" aria-live="polite"><p>İşletme ayarları hazırlanıyor…</p></section></main>;
  }

  if (loadState === 'error') {
    return (
      <main className="availability-page">
        <section className="availability-card availability-error" role="alert">
          <p className="eyebrow">İŞLETME AYARLARI</p>
          <h1>Ayarlar yüklenemedi.</h1>
          <p className="muted">{loadError || 'Güncel işletme bilgileri doğrulanamadı.'}</p>
          <button className="primary-button" type="button" onClick={() => void load()}>Tekrar yükle</button>
          <a className="primary-link secondary-link" href="/">Çalışma alanına dön</a>
        </section>
      </main>
    );
  }

  if (loadState === 'no-workspace') {
    return <main className="availability-page"><section className="availability-card"><p className="eyebrow">İŞLETME AYARLARI</p><h1>Önce çalışma alanını seçin.</h1><p className="muted">Giriş ve işletme seçimi ana çalışma alanında yapılır.</p><a className="primary-link" href="/">Çalışma alanına dön</a></section></main>;
  }

  if (!session?.user || !session.activeBusinessId || !catalog || !setup) {
    return <main className="availability-page"><section className="availability-card availability-error" role="alert"><h1>Ayarlar doğrulanamadı.</h1><button className="primary-button" type="button" onClick={() => void load()}>Tekrar yükle</button></section></main>;
  }

  return (
    <div className="availability-page">
      <header className="availability-hero">
        <div>
          <p className="eyebrow">İŞLETME AYARLARI</p>
          <h1>Hizmet, ekip ve çalışma düzeni</h1>
          <p className="muted">Saat dilimi: <strong>{setup.timezone}</strong>. Arşivleme geçmiş randevuları değiştirmez; mesai ve kapanış değişiklikleri yeni uygunlukları etkiler.</p>
        </div>
        <span className="role-badge">{roleLabel(setup.membership.role)}</span>
      </header>

      {notice && <div className="notice" role="status">{notice}</div>}

      <div className="availability-grid">
        <CatalogSettingsPanel catalog={catalog} busy={busy} setBusy={setBusy} setNotice={setNotice} reload={load} />

        <section className="availability-card">
          <div className="section-head"><h2>İşletme saatleri</h2><span>{setup.businessHours.length} aralık</span></div>
          <p className="muted">Molalar için aynı günü birden fazla aralığa bölebilirsiniz.</p>
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
            {!setup.staffHours.length && <p className="empty">Henüz personel çalışma saati yok.</p>}
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
            {setup.blocks.map((block) => <div className="block-row" key={block.id}><div><strong>{block.staff_id ? activeStaff.find((item) => item.id === block.staff_id)?.name ?? 'Personel' : 'Tüm işletme'}</strong><span>{formatDateTime(block.starts_at, setup.timezone)} → {formatDateTime(block.ends_at, setup.timezone)}</span><small>{block.reason || 'Neden belirtilmedi'}</small></div>{canManage && <button disabled={busy} onClick={() => void deleteBlock(block.id)}>Sil</button>}</div>)}
            {!setup.blocks.length && <p className="empty">Planlanmış izin veya kapanış yok.</p>}
          </div>
          {canManage && <form className="availability-form block-form" onSubmit={addBlock}>
            <input name="date" type="date" defaultValue={dateToday()} required aria-label="Tarih" />
            <input name="start" type="time" defaultValue="12:00" required aria-label="Başlangıç" />
            <input name="end" type="time" defaultValue="13:00" required aria-label="Bitiş" />
            <select name="staffId" aria-label="Kapsam"><option value="">Tüm işletme</option>{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <input name="reason" maxLength={240} placeholder="Neden (isteğe bağlı)" />
            <button className="primary-button" disabled={busy}>Kapanış ekle</button>
          </form>}
        </section>

        <section className="availability-card slot-card">
          <div className="section-head"><h2>Uygunluk önizlemesi</h2><span>Randevu oluşturmaz</span></div>
          <form className="availability-form slot-form" onSubmit={previewSlots}>
            <input name="date" type="date" defaultValue={dateToday()} required aria-label="Tarih" />
            <select name="serviceId" required aria-label="Hizmet"><option value="">Hizmet seçin</option>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
            <select name="staffId" aria-label="Personel"><option value="any">Uygun herhangi biri</option>{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <select name="step" defaultValue="15" aria-label="Slot adımı"><option value="10">10 dk</option><option value="15">15 dk</option><option value="30">30 dk</option></select>
            <button className="primary-button" disabled={busy || !activeServices.length}>Hesapla</button>
          </form>
          <div className="slot-results">
            {slots.map((slot) => <div className="slot-item" key={`${slot.staff_id}-${slot.starts_at}`}><strong>{formatSlot(slot.starts_at, slot.timezone)}</strong><span>{slot.staff_name}</span></div>)}
          </div>
        </section>
      </div>
    </div>
  );
}
