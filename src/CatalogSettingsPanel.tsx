import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { api } from './api';
import './catalog-settings.css';

type Role = 'owner' | 'manager' | 'staff';
export type ManagedService = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_minor: number;
  currency: string;
  active: boolean;
  updated_at: string;
};
export type ManagedStaff = {
  id: string;
  membership_id: string | null;
  name: string;
  phone: string | null;
  active: boolean;
  updated_at: string;
};
export type ManagedAssignment = {
  staff_id: string;
  service_id: string;
  active: boolean;
  updated_at: string;
};
export type ManagedCatalog = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  services: ManagedService[];
  staff: ManagedStaff[];
  assignments: ManagedAssignment[];
};

type Props = {
  catalog: ManagedCatalog;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string>>;
  reload: () => Promise<void>;
};

function parseTry(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100);
}

function formatTry(minor: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(minor / 100);
}

export default function CatalogSettingsPanel({ catalog, busy, setBusy, setNotice, reload }: Props) {
  const canManage = catalog.membership.role === 'owner' || catalog.membership.role === 'manager';
  const activeServices = catalog.services.filter((item) => item.active);
  const activeStaff = catalog.staff.filter((item) => item.active);

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Değişiklik kaydedilemedi.');
      setBusy(false);
      return false;
    }

    setNotice(success);
    try {
      await reload();
    } catch {
      setNotice(`${success} Güncel görünüm yüklenemedi; sayfayı yenileyerek kontrol edin.`);
    } finally {
      setBusy(false);
    }
    return true;
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const priceMinor = parseTry(data.get('price'));
    if (priceMinor === null) {
      setNotice('Fiyat 0 ile 1.000.000 TL arasında ve en fazla iki ondalık basamaklı olmalı.');
      return;
    }
    const saved = await mutate(() => api('/api/services', {
      method: 'POST',
      body: JSON.stringify({
        name: data.get('name'),
        durationMinutes: Number(data.get('duration')),
        bufferBeforeMinutes: Number(data.get('bufferBefore')),
        bufferAfterMinutes: Number(data.get('bufferAfter')),
        priceMinor,
      }),
    }), 'Hizmet eklendi.');
    if (saved) form.reset();
  }

  async function updateService(event: FormEvent<HTMLFormElement>, service: ManagedService) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const priceMinor = parseTry(data.get('price'));
    if (priceMinor === null) {
      setNotice('Fiyat 0 ile 1.000.000 TL arasında ve en fazla iki ondalık basamaklı olmalı.');
      return;
    }
    await mutate(() => api(`/api/services/${service.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedUpdatedAt: service.updated_at,
        name: data.get('name'),
        durationMinutes: Number(data.get('duration')),
        bufferBeforeMinutes: Number(data.get('bufferBefore')),
        bufferAfterMinutes: Number(data.get('bufferAfter')),
        priceMinor,
      }),
    }), 'Hizmet güncellendi.');
  }

  async function setServiceActive(service: ManagedService, active: boolean) {
    await mutate(() => api(`/api/services/${service.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedUpdatedAt: service.updated_at, active }),
    }), active ? 'Hizmet yeniden etkinleştirildi.' : 'Hizmet arşivlendi. Geçmiş randevular değişmedi.');
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await mutate(() => api('/api/staff', {
      method: 'POST',
      body: JSON.stringify({ name: data.get('name'), phone: data.get('phone') }),
    }), 'Personel eklendi.');
    if (saved) form.reset();
  }

  async function updateStaff(event: FormEvent<HTMLFormElement>, person: ManagedStaff) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(() => api(`/api/staff/${person.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedUpdatedAt: person.updated_at,
        name: data.get('name'),
        phone: data.get('phone'),
      }),
    }), 'Personel güncellendi.');
  }

  async function setStaffActive(person: ManagedStaff, active: boolean) {
    await mutate(() => api(`/api/staff/${person.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedUpdatedAt: person.updated_at, active }),
    }), active ? 'Personel yeniden etkinleştirildi.' : 'Personel arşivlendi. Geçmiş randevular değişmedi.');
  }

  async function toggleAssignment(person: ManagedStaff, service: ManagedService, active: boolean) {
    const existing = catalog.assignments.find((item) => item.staff_id === person.id && item.service_id === service.id);
    await mutate(() => api(`/api/staff/${person.id}/services/${service.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        active,
        expectedUpdatedAt: existing?.updated_at ?? null,
      }),
    }), 'Hizmet yetkinliği güncellendi.');
  }

  return (
    <>
      <section className="availability-card catalog-settings-card">
        <div className="section-head">
          <div><h2>Hizmetler</h2><small>Fiyat, süre ve tampon süreleri</small></div>
          <span>{activeServices.length} aktif</span>
        </div>
        <div className="catalog-stack">
          {catalog.services.map((service) => (
            <article className={`catalog-editor ${service.active ? '' : 'archived'}`} key={service.id}>
              <div className="catalog-editor-head">
                <div><strong>{service.name}</strong><span>{service.duration_minutes} dk · {formatTry(service.price_minor)}</span></div>
                <span className="status-pill">{service.active ? 'Aktif' : 'Arşivde'}</span>
              </div>
              {canManage && (
                <form className="catalog-edit-form" onSubmit={(event) => void updateService(event, service)}>
                  <label>Hizmet adı<input name="name" defaultValue={service.name} minLength={2} maxLength={120} required /></label>
                  <label>Süre (dk)<input name="duration" type="number" min={5} max={720} defaultValue={service.duration_minutes} required /></label>
                  <label>Ön tampon (dk)<input name="bufferBefore" type="number" min={0} max={240} defaultValue={service.buffer_before_minutes} required /></label>
                  <label>Son tampon (dk)<input name="bufferAfter" type="number" min={0} max={240} defaultValue={service.buffer_after_minutes} required /></label>
                  <label>Fiyat (TL)<input name="price" inputMode="decimal" defaultValue={(service.price_minor / 100).toFixed(2)} required /></label>
                  <div className="catalog-actions">
                    <button className="primary-button" disabled={busy}>Kaydet</button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void setServiceActive(service, !service.active)}>
                      {service.active ? 'Arşivle' : 'Etkinleştir'}
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
          {!catalog.services.length && <p className="empty">Henüz hizmet yok.</p>}
        </div>
        {canManage && (
          <form className="catalog-create-form" onSubmit={createService}>
            <h3>Yeni hizmet</h3>
            <input name="name" placeholder="Hizmet adı" minLength={2} maxLength={120} required />
            <input name="duration" type="number" min={5} max={720} defaultValue={30} aria-label="Süre dakika" required />
            <input name="bufferBefore" type="number" min={0} max={240} defaultValue={0} aria-label="Ön tampon dakika" required />
            <input name="bufferAfter" type="number" min={0} max={240} defaultValue={0} aria-label="Son tampon dakika" required />
            <input name="price" inputMode="decimal" defaultValue="0.00" aria-label="Fiyat TL" required />
            <button className="primary-button" disabled={busy}>Hizmet ekle</button>
          </form>
        )}
      </section>

      <section className="availability-card catalog-settings-card">
        <div className="section-head">
          <div><h2>Personel</h2><small>Operasyon kaydı ve aktiflik</small></div>
          <span>{activeStaff.length} aktif</span>
        </div>
        <div className="catalog-stack">
          {catalog.staff.map((person) => (
            <article className={`catalog-editor ${person.active ? '' : 'archived'}`} key={person.id}>
              <div className="catalog-editor-head">
                <div><strong>{person.name}</strong><span>{person.phone || 'Telefon eklenmedi'}{person.membership_id ? ' · hesaba bağlı' : ''}</span></div>
                <span className="status-pill">{person.active ? 'Aktif' : 'Arşivde'}</span>
              </div>
              {canManage && (
                <form className="catalog-edit-form staff-edit" onSubmit={(event) => void updateStaff(event, person)}>
                  <label>Ad<input name="name" defaultValue={person.name} minLength={2} maxLength={120} required /></label>
                  <label>Telefon<input name="phone" defaultValue={person.phone ?? ''} maxLength={40} /></label>
                  <div className="catalog-actions">
                    <button className="primary-button" disabled={busy}>Kaydet</button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void setStaffActive(person, !person.active)}>
                      {person.active ? 'Arşivle' : 'Etkinleştir'}
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
          {!catalog.staff.length && <p className="empty">Henüz personel yok.</p>}
        </div>
        {canManage && (
          <form className="catalog-create-form compact-create" onSubmit={createStaff}>
            <h3>Yeni personel</h3>
            <input name="name" placeholder="Personel adı" minLength={2} maxLength={120} required />
            <input name="phone" placeholder="Telefon (isteğe bağlı)" maxLength={40} />
            <button className="primary-button" disabled={busy}>Personel ekle</button>
          </form>
        )}
      </section>

      <section className="availability-card catalog-settings-card span-settings">
        <div className="section-head"><div><h2>Hizmet yetkinlikleri</h2><small>Aktif personelin hangi aktif hizmetleri verebildiği</small></div></div>
        {!activeStaff.length || !activeServices.length ? (
          <p className="empty">Eşleştirme için en az bir aktif hizmet ve aktif personel gerekli.</p>
        ) : (
          <div className="settings-matrix">
            {activeStaff.map((person) => (
              <div className="settings-matrix-row" key={person.id}>
                <strong>{person.name}</strong>
                <div className="chips">
                  {activeServices.map((service) => {
                    const assignment = catalog.assignments.find((item) => item.staff_id === person.id && item.service_id === service.id);
                    const assigned = Boolean(assignment?.active);
                    return (
                      <label className={`chip ${assigned ? 'selected' : ''}`} key={service.id}>
                        <input
                          type="checkbox"
                          checked={assigned}
                          disabled={busy || !canManage}
                          onChange={(event) => void toggleAssignment(person, service, event.target.checked)}
                        />
                        {service.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}