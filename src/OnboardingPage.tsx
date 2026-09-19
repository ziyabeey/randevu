import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from './api';
import { formatLocalDate, formatTry, onboardingCopy as copy } from './onboardingLocale';
import type { Business, Role, Session } from '../shared/types.ts';
import { getErrorMessage } from './errors.ts';

type Service = {
  id: string;
  name: string;
  duration_minutes: number;
  price_minor: number;
  currency: string;
  active: boolean;
};
type Staff = {
  id: string;
  membership_id: string | null;
  name: string;
  phone: string | null;
  active: boolean;
};
type Assignment = { staff_id: string; service_id: string; active: boolean };
type Hours = { id: string; weekday: number; starts_local: string; ends_local: string; active: boolean };
type StaffHours = Hours & { staff_id: string };
type Readiness = {
  business_id: string;
  has_active_service: boolean;
  has_active_staff: boolean;
  has_active_assignment: boolean;
  has_business_hours: boolean;
  has_staff_hours: boolean;
  has_overlapping_hours: boolean;
  publishable: boolean;
  missing_reasons: string[];
};
type Settings = {
  business_id: string;
  enabled: boolean;
  step_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
};
type Snapshot = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  business: Business;
  services: Service[];
  staff: Staff[];
  assignments: Assignment[];
  businessHours: Hours[];
  staffHours: StaffHours[];
  settings: Settings;
  readiness: Readiness;
};
type Slot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};

type StepState = { label: string; done: boolean };

const weekdayLabels = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function OnboardingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [previewedDate, setPreviewedDate] = useState('');
  const requestController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);

  const replaceReadRequest = useCallback(() => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const generation = ++requestGeneration.current;
    return { controller, generation };
  }, []);

  const loadSnapshot = useCallback(async (businessId?: string | null) => {
    const { controller, generation } = replaceReadRequest();
    try {
      const next = await api<Snapshot>('/api/onboarding', { signal: controller.signal });
      if (generation !== requestGeneration.current) return;
      if (businessId && next.membership.business_id !== businessId) return;
      setSnapshot(next);
      setSlots([]);
      setPreviewedDate('');
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      setSnapshot(null);
      setNotice(getErrorMessage(error, copy.reloadFailed));
    }
  }, [replaceReadRequest]);

  const loadPage = useCallback(async () => {
    const { controller, generation } = replaceReadRequest();
    setLoading(true);
    try {
      const nextSession = await api<Session>('/api/session', { signal: controller.signal });
      if (generation !== requestGeneration.current) return;
      setSession(nextSession);
      if (nextSession.user && nextSession.activeBusinessId && !nextSession.passwordRecovery) {
        const next = await api<Snapshot>('/api/onboarding', { signal: controller.signal });
        if (generation !== requestGeneration.current) return;
        if (next.membership.business_id !== nextSession.activeBusinessId) return;
        setSnapshot(next);
      } else {
        setSnapshot(null);
      }
    } catch (error) {
      if (!controller.signal.aborted && generation === requestGeneration.current) {
        setNotice(getErrorMessage(error, copy.reloadFailed));
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [replaceReadRequest]);

  useEffect(() => {
    void loadPage();
    return () => requestController.current?.abort();
  }, [loadPage]);

  const activeServices = useMemo(() => snapshot?.services.filter((service) => service.active) ?? [], [snapshot]);
  const activeStaff = useMemo(() => snapshot?.staff.filter((person) => person.active) ?? [], [snapshot]);
  const canManage = snapshot?.membership.role === 'owner' || snapshot?.membership.role === 'manager';

  const steps = useMemo<StepState[]>(() => {
    if (!snapshot) return [];
    const r = snapshot.readiness;
    return [
      { label: copy.business, done: true },
      { label: copy.service, done: r.has_active_service },
      { label: copy.staff, done: r.has_active_staff && r.has_active_assignment },
      { label: copy.hours, done: r.has_business_hours && r.has_staff_hours && r.has_overlapping_hours },
      { label: copy.preview, done: r.publishable },
      { label: copy.publish, done: snapshot.settings.enabled && r.publishable },
    ];
  }, [snapshot]);

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    requestController.current?.abort();
    ++requestGeneration.current;
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/businesses', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), timezone: 'Europe/Istanbul' }),
      });
      window.location.assign('/setup');
    } catch (error) {
      setNotice(getErrorMessage(error, 'İşletme oluşturulamadı.'));
      setBusy(false);
    }
  }

  async function switchBusiness(businessId: string) {
    if (businessId === session?.activeBusinessId) return;
    setBusy(true);
    setNotice('');
    requestController.current?.abort();
    ++requestGeneration.current;
    setSnapshot(null);
    setSlots([]);
    try {
      await api('/api/businesses/select', {
        method: 'POST',
        body: JSON.stringify({ businessId }),
      });
      window.location.assign('/setup');
    } catch (error) {
      setNotice(getErrorMessage(error, 'İşletme değiştirilemedi.'));
      setBusy(false);
      await loadPage();
    }
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setBusy(true);
    setNotice('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = Number(String(data.get('price') ?? '').replace(',', '.'));
    try {
      await api('/api/services', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          durationMinutes: Number(data.get('duration')),
          priceMinor: Math.round(price * 100),
        }),
      });
      form.reset();
      setNotice(copy.serviceCreated);
      await loadSnapshot(snapshot.business.id);
    } catch (error) {
      setNotice(getErrorMessage(error, 'Hizmet eklenemedi.'));
    } finally {
      setBusy(false);
    }
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setBusy(true);
    setNotice('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const ownerAsStaff = data.get('ownerAsStaff') === 'on';
    const serviceId = String(data.get('serviceId') ?? '');
    let partialNotice = '';
    try {
      const result = await api<{ staff: Staff }>('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), phone: data.get('phone') }),
      });
      if (!result.staff?.id) throw new Error('Personel kaydı doğrulanamadı.');

      if (serviceId) {
        await api(`/api/staff/${result.staff.id}/services/${serviceId}`, {
          method: 'PUT',
          body: JSON.stringify({ active: true }),
        });
      }

      if (ownerAsStaff && snapshot.membership.role === 'owner') {
        try {
          await api(`/api/team/staff/${result.staff.id}/membership`, {
            method: 'PUT',
            body: JSON.stringify({ membershipId: snapshot.membership.id }),
          });
        } catch {
          partialNotice = 'Personel eklendi; hesap bağlantısı tamamlanamadı. Kurulumdan devam edebilir veya aşağıdan yeniden bağlayabilirsiniz.';
        }
      }

      form.reset();
      setNotice(partialNotice || copy.staffCreated);
      await loadSnapshot(snapshot.business.id);
    } catch (error) {
      setNotice(getErrorMessage(error, 'Personel eklenemedi.'));
      await loadSnapshot(snapshot.business.id);
    } finally {
      setBusy(false);
    }
  }

  async function linkOwner(staffId: string) {
    if (!snapshot || snapshot.membership.role !== 'owner') return;
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/team/staff/${staffId}/membership`, {
        method: 'PUT',
        body: JSON.stringify({ membershipId: snapshot.membership.id }),
      });
      setNotice('Personel kaydı hesabınıza bağlandı.');
      await loadSnapshot(snapshot.business.id);
    } catch (error) {
      setNotice(getErrorMessage(error, 'Personel-hesap bağlantısı tamamlanamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    setBusy(true);
    setNotice('');
    const data = new FormData(event.currentTarget);
    const weekday = Number(data.get('weekday'));
    const staffId = String(data.get('staffId') ?? '');
    const businessStart = String(data.get('businessStart') ?? '');
    const businessEnd = String(data.get('businessEnd') ?? '');
    const staffStart = String(data.get('staffStart') ?? '');
    const staffEnd = String(data.get('staffEnd') ?? '');
    try {
      await api(`/api/availability/business-hours/${weekday}`, {
        method: 'PUT',
        body: JSON.stringify({ intervals: [{ start: businessStart, end: businessEnd }] }),
      });
      await api(`/api/availability/staff/${staffId}/hours/${weekday}`, {
        method: 'PUT',
        body: JSON.stringify({ intervals: [{ start: staffStart, end: staffEnd }] }),
      });
      setNotice(copy.hoursSaved);
      await loadSnapshot(snapshot.business.id);
    } catch (error) {
      setNotice(getErrorMessage(error, 'Çalışma saatleri tamamen kaydedilemedi. Kaydedilen adımlar korunur; değerleri kontrol edip yeniden deneyin.'));
      await loadSnapshot(snapshot.business.id);
    } finally {
      setBusy(false);
    }
  }

  async function previewSlots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    const data = new FormData(event.currentTarget);
    const serviceId = String(data.get('serviceId') ?? '');
    const staffId = String(data.get('staffId') ?? 'any');
    const date = String(data.get('date') ?? '');
    try {
      const query = new URLSearchParams({ serviceId, staffId, date, step: '15' });
      const result = await api<{ slots: Slot[] }>(`/api/availability/slots?${query}`);
      setSlots(result.slots ?? []);
      setPreviewedDate(date);
    } catch (error) {
      setSlots([]);
      setPreviewedDate(date);
      setNotice(getErrorMessage(error, 'Saat önizlemesi alınamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function setPublished(enabled: boolean) {
    if (!snapshot) return;
    setBusy(true);
    setNotice('');
    try {
      await api('/api/public/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          stepMinutes: snapshot.settings.step_minutes,
          minNoticeMinutes: snapshot.settings.min_notice_minutes,
          horizonDays: snapshot.settings.horizon_days,
        }),
      });
      setNotice(enabled ? copy.published : 'Rezervasyon sayfası yayından kaldırıldı.');
      await loadSnapshot(snapshot.business.id);
    } catch (error) {
      if (error instanceof ApiRequestError && !snapshot.readiness.publishable) {
        setNotice(copy.publicNotReady);
      } else {
        setNotice(getErrorMessage(error, 'Yayın durumu güncellenemedi.'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="setup-shell"><section className="setup-card"><p>Kurulum bilgileri hazırlanıyor…</p></section></main>;
  }

  if (!session?.user) {
    return <main className="setup-shell"><section className="setup-card"><h1>Önce giriş yapın</h1><p>İşletme kurulumuna devam etmek için çalışma alanına giriş yapmanız gerekir.</p><a className="setup-primary-link" href="/">Giriş ekranına dön</a></section></main>;
  }

  if (session.passwordRecovery) {
    return <main className="setup-shell"><section className="setup-card"><h1>Önce yeni parolanızı belirleyin</h1><p>Kurulum işlemleri parola kurtarma oturumunda kapalıdır.</p><a className="setup-primary-link" href="/account">Parolayı güncelle</a></section></main>;
  }

  const selectedMembership = session.memberships.find((membership) => membership.business_id === session.activeBusinessId) ?? null;

  return (
    <main className="setup-shell">
      <header className="setup-hero">
        <div>
          <p className="setup-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <a className="setup-secondary-link" href="/">Çalışma alanına dön</a>
      </header>

      {notice && <div className="setup-notice" role="status">{notice}</div>}

      <section className="setup-card setup-business-switcher">
        <div className="setup-section-head">
          <div><p className="setup-eyebrow">{copy.business}</p><h2>{selectedMembership?.businesses?.name ?? 'İşletmenizi seçin'}</h2></div>
          {selectedMembership && <span className="setup-role">{selectedMembership.role === 'owner' ? 'İşletme sahibi' : selectedMembership.role === 'manager' ? 'Yönetici' : 'Çalışan'}</span>}
        </div>
        <div className="setup-business-grid">
          {session.memberships.map((membership) => (
            <button
              type="button"
              className={membership.business_id === session.activeBusinessId ? 'setup-business active' : 'setup-business'}
              disabled={busy || membership.business_id === session.activeBusinessId}
              key={membership.id}
              onClick={() => void switchBusiness(membership.business_id)}
            >
              <strong>{membership.businesses?.name ?? 'İşletme'}</strong>
              <span>{membership.business_id === session.activeBusinessId ? 'Şu an seçili' : copy.selectBusiness}</span>
            </button>
          ))}
        </div>
        <details className="setup-create-business" open={session.memberships.length === 0}>
          <summary>{copy.createBusiness}</summary>
          <form className="setup-inline-form" onSubmit={createBusiness}>
            <label>İşletme adı<input name="name" minLength={2} maxLength={120} required placeholder="Örn. Lotus Studio" /></label>
            <button disabled={busy}>Oluştur</button>
          </form>
        </details>
      </section>

      {!snapshot ? (
        <section className="setup-card">
          <h2>{copy.switchBusiness}</h2>
          <p>{session.memberships.length ? 'Kuruluma devam etmek için yukarıdan yetkili olduğunuz bir işletmeyi seçin.' : copy.noBusiness}</p>
        </section>
      ) : (
        <>
          <ol className="setup-progress" aria-label="Kurulum adımları">
            {steps.map((step, index) => (
              <li className={step.done ? 'done' : ''} key={step.label}>
                <span>{step.done ? '✓' : index + 1}</span><strong>{step.label}</strong>
              </li>
            ))}
          </ol>

          {!canManage && (
            <section className="setup-card"><h2>Kurulumu görüntülüyorsunuz</h2><p>Hizmet, personel, çalışma saatleri ve yayın ayarlarını owner veya yönetici değiştirebilir.</p></section>
          )}

          <section className="setup-card" id="service-step">
            <div className="setup-section-head"><div><p className="setup-eyebrow">2 · {copy.service}</p><h2>Müşterinin seçebileceği ilk hizmet</h2></div><span>{activeServices.length} aktif</span></div>
            {activeServices.length > 0 && <ul className="setup-list">{activeServices.map((service) => <li key={service.id}><strong>{service.name}</strong><span>{service.duration_minutes} dk · {formatTry(service.price_minor)}</span></li>)}</ul>}
            {canManage && (
              <form className="setup-grid-form" onSubmit={createService}>
                <label>Hizmet adı<input name="name" required minLength={2} placeholder="Örn. Saç kesimi" /></label>
                <label>Süre (dk)<input name="duration" type="number" min={5} max={720} defaultValue={30} required /></label>
                <label>Fiyat (TL)<input name="price" inputMode="decimal" defaultValue="0" required /></label>
                <button disabled={busy}>{copy.createService}</button>
              </form>
            )}
          </section>

          <section className="setup-card" id="staff-step">
            <div className="setup-section-head"><div><p className="setup-eyebrow">3 · {copy.staff}</p><h2>Hizmeti verecek kişi</h2></div><span>{activeStaff.length} aktif</span></div>
            {activeStaff.length > 0 && <ul className="setup-list">{activeStaff.map((person) => {
              const assignedNames = activeServices.filter((service) => snapshot.assignments.some((item) => item.active && item.staff_id === person.id && item.service_id === service.id)).map((service) => service.name);
              return <li key={person.id}><div><strong>{person.name}</strong><span>{assignedNames.length ? assignedNames.join(', ') : 'Henüz hizmet eşleşmesi yok'}</span></div>{snapshot.membership.role === 'owner' && !person.membership_id && <button className="setup-small-button" type="button" disabled={busy} onClick={() => void linkOwner(person.id)}>{copy.linkOwner}</button>}</li>;
            })}</ul>}
            {canManage && activeServices.length > 0 && (
              <form className="setup-grid-form" onSubmit={createStaff}>
                <label>Personel adı<input name="name" required minLength={2} defaultValue={snapshot.membership.role === 'owner' ? session.user.fullName ?? '' : ''} /></label>
                <label>Telefon<input name="phone" placeholder="İsteğe bağlı" /></label>
                <label>Hizmet<select name="serviceId" required defaultValue={activeServices[0]?.id}>{activeServices.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
                {snapshot.membership.role === 'owner' && <label className="setup-check"><input type="checkbox" name="ownerAsStaff" />{copy.ownerAsStaff}</label>}
                <button disabled={busy}>{copy.createStaff}</button>
              </form>
            )}
            {canManage && activeServices.length === 0 && <p className="setup-muted">Personel eklemeden önce en az bir hizmet oluşturun.</p>}
          </section>

          <section className="setup-card" id="hours-step">
            <div className="setup-section-head"><div><p className="setup-eyebrow">4 · {copy.hours}</p><h2>İlk ortak çalışma aralığını oluşturun</h2></div><span>{snapshot.readiness.has_overlapping_hours ? 'Ortak saat var' : 'Ortak saat gerekli'}</span></div>
            {snapshot.businessHours.length > 0 && <p className="setup-muted">İşletme: {snapshot.businessHours.map((row) => `${weekdayLabels[row.weekday]} ${row.starts_local.slice(0, 5)}–${row.ends_local.slice(0, 5)}`).join(' · ')}</p>}
            {canManage && activeStaff.length > 0 && (
              <form className="setup-grid-form" onSubmit={saveHours}>
                <label>Gün<select name="weekday" defaultValue="1">{weekdayLabels.map((label, value) => <option value={value} key={label}>{label}</option>)}</select></label>
                <label>Personel<select name="staffId" required defaultValue={activeStaff[0]?.id}>{activeStaff.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                <label>İşletme açılış<input type="time" name="businessStart" defaultValue="09:00" required /></label>
                <label>İşletme kapanış<input type="time" name="businessEnd" defaultValue="18:00" required /></label>
                <label>Personel başlangıç<input type="time" name="staffStart" defaultValue="09:00" required /></label>
                <label>Personel bitiş<input type="time" name="staffEnd" defaultValue="18:00" required /></label>
                <button disabled={busy}>{copy.saveHours}</button>
              </form>
            )}
          </section>

          <section className="setup-card" id="preview-step">
            <div className="setup-section-head"><div><p className="setup-eyebrow">5 · {copy.preview}</p><h2>Müşteri akışını kontrol edin</h2></div><span>{snapshot.readiness.publishable ? copy.publicReady : copy.publicNotReady}</span></div>
            <div className="setup-preview-card">
              <strong>{snapshot.business.name}</strong>
              <span>/r/{snapshot.business.slug}</span>
              <p>{activeServices.length ? `${activeServices.length} hizmet · ${activeStaff.length} personel` : 'Hizmet bilgisi bekleniyor'}</p>
              {!snapshot.readiness.publishable && <ul>{snapshot.readiness.missing_reasons.map((reason) => <li key={reason}>{copy.missing[reason] ?? 'Bir kurulum adımını tamamlayın.'}</li>)}</ul>}
            </div>
            {snapshot.readiness.publishable && activeServices.length > 0 && (
              <form className="setup-grid-form" onSubmit={previewSlots}>
                <label>Hizmet<select name="serviceId" required defaultValue={activeServices[0]?.id}>{activeServices.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
                <label>Personel<select name="staffId" defaultValue="any"><option value="any">Uygun herhangi biri</option>{activeStaff.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                <label>Tarih<input type="date" name="date" defaultValue={todayInputValue()} required /></label>
                <button disabled={busy}>Saatleri önizle</button>
              </form>
            )}
            {previewedDate && <div className="setup-slots"><h3>{formatLocalDate(previewedDate)}</h3>{slots.length ? slots.slice(0, 8).map((slot) => <span key={`${slot.staff_id}-${slot.starts_at}`}>{new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: slot.timezone }).format(new Date(slot.starts_at))} · {slot.staff_name}</span>) : <p>{copy.previewEmpty}</p>}</div>}
          </section>

          <section className="setup-card" id="publish-step">
            <div className="setup-section-head"><div><p className="setup-eyebrow">6 · {copy.publish}</p><h2>Rezervasyon sayfasını açın</h2></div><span className={snapshot.settings.enabled && snapshot.readiness.publishable ? 'setup-live' : 'setup-offline'}>{snapshot.settings.enabled && snapshot.readiness.publishable ? 'Yayında' : 'Kapalı'}</span></div>
            <p>{snapshot.settings.enabled ? copy.published : copy.unpublished}</p>
            {canManage && !snapshot.settings.enabled && <button className="setup-primary" type="button" disabled={busy || !snapshot.readiness.publishable} onClick={() => void setPublished(true)}>{copy.publishNow}</button>}
            {canManage && snapshot.settings.enabled && <button className="setup-danger" type="button" disabled={busy} onClick={() => void setPublished(false)}>{copy.unpublish}</button>}
            {snapshot.settings.enabled && snapshot.readiness.publishable && <a className="setup-secondary-link" href={`/r/${encodeURIComponent(snapshot.business.slug)}`}>Yayınlanan sayfayı aç</a>}
          </section>
        </>
      )}
    </main>
  );
}
