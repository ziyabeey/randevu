import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { ApiRequestError, api } from './api';
import './catalog-settings.css';

type Role = 'owner' | 'manager' | 'staff';
type PriceType = 'fixed' | 'range';
export type ManagedService = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  category: string;
  sort_order: number;
  price_minor: number;
  price_type: PriceType;
  price_min_minor: number;
  price_max_minor: number;
  price_policy_version: number;
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
  reload: () => Promise<boolean>;
};

function parseMoney(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100);
}

function readPriceForm(data: FormData) {
  const priceType = data.get('priceType');
  if (priceType !== 'fixed' && priceType !== 'range') return null;
  const priceMinMinor = parseMoney(data.get('priceMin'));
  const enteredMax = parseMoney(data.get('priceMax'));
  const priceMaxMinor = priceType === 'fixed' ? priceMinMinor : enteredMax;
  const currency = String(data.get('currency') ?? '').trim().toUpperCase();
  if (priceMinMinor === null || priceMaxMinor === null
      || priceMinMinor > priceMaxMinor
      || !/^[A-Z]{3}$/.test(currency)) return null;
  return { priceType, priceMinMinor, priceMaxMinor, currency };
}

function formatMoney(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function formatServicePrice(service: ManagedService) {
  if (service.price_type === 'range') {
    return `${formatMoney(service.price_min_minor, service.currency)} – ${formatMoney(service.price_max_minor, service.currency)}`;
  }
  return formatMoney(service.price_min_minor, service.currency);
}

export default function CatalogSettingsPanel({ catalog, busy, setBusy, setNotice, reload }: Props) {
  const canManage = catalog.membership.role === 'owner' || catalog.membership.role === 'manager';
  const activeServices = catalog.services.filter((item) => item.active);
  const activeStaff = catalog.staff.filter((item) => item.active);
  const nextSortOrder = Math.min(
    1_000_000,
    catalog.services.reduce((max, service) => Math.max(max, service.sort_order), -10) + 10,
  );

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && error.code === 'STALE_WRITE') {
        const refreshed = await reload();
        if (refreshed) {
          setNotice('Bu kayıt başka bir oturumda değişti. Güncel bilgiler yeniden yüklendi; yaptığınız değişiklik uygulanmadı.');
        }
      } else {
        setNotice(error instanceof Error ? error.message : 'Değişiklik kaydedilemedi.');
      }
      setBusy(false);
      return false;
    }

    const refreshed = await reload();
    if (refreshed) setNotice(success);
    setBusy(false);
    return true;
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = readPriceForm(data);
    if (!price) {
      setNotice('Fiyat aralığı, para birimi veya tutar geçerli değil. Alt tutar üst tutardan büyük olamaz.');
      return;
    }
    const saved = await mutate(() => api('/api/services', {
      method: 'POST',
      body: JSON.stringify({
        name: data.get('name'),
        durationMinutes: Number(data.get('duration')),
        bufferBeforeMinutes: Number(data.get('bufferBefore')),
        bufferAfterMinutes: Number(data.get('bufferAfter')),
        category: data.get('category'),
        sortOrder: Number(data.get('sortOrder')),
        ...price,
      }),
    }), 'Hizmet eklendi.');
    if (saved) form.reset();
  }

  async function updateService(event: FormEvent<HTMLFormElement>, service: ManagedService) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const price = readPriceForm(data);
    if (!price) {
      setNotice('Fiyat aralığı, para birimi veya tutar geçerli değil. Alt tutar üst tutardan büyük olamaz.');
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
        category: data.get('category'),
        sortOrder: Number(data.get('sortOrder')),
        ...price,
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
          <div><h2>Hizmetler</h2><small>Kategori, sıralama, fiyat, süre ve tampon süreleri</small></div>
          <span>{activeServices.length} aktif</span>
        </div>
        <div className="catalog-stack">
          {catalog.services.map((service) => (
            <article className={`catalog-editor ${service.active ? '' : 'archived'}`} key={`${service.id}:${service.updated_at}`}>
              <div className="catalog-editor-head">
                <div>
                  <strong>{service.name}</strong>
                  <span>{service.category} · sıra {service.sort_order} · {service.duration_minutes} dk · {formatServicePrice(service)}</span>
                  <small>{service.price_type === 'range' ? 'Fiyat aralığı' : 'Sabit fiyat'} · politika v{service.price_policy_version}</small>
                </div>
                <span className="status-pill">{service.active ? 'Aktif' : 'Arşivde'}</span>
              </div>
              {canManage && (
                <form className="catalog-edit-form" onSubmit={(event) => void updateService(event, service)}>
                  <label>Hizmet adı<input name="name" defaultValue={service.name} minLength={2} maxLength={120} required /></label>
                  <label>Kategori<input name="category" defaultValue={service.category} minLength={1} maxLength={80} required /></label>
                  <label>Sıra<input name="sortOrder" type="number" min={0} max={1000000} defaultValue={service.sort_order} required /></label>
                  <label>Süre (dk)<input name="duration" type="number" min={5} max={720} defaultValue={service.duration_minutes} required /></label>
                  <label>Ön tampon (dk)<input name="bufferBefore" type="number" min={0} max={240} defaultValue={service.buffer_before_minutes} required /></label>
                  <label>Son tampon (dk)<input name="bufferAfter" type="number" min={0} max={240} defaultValue={service.buffer_after_minutes} required /></label>
                  <label>Fiyat tipi
                    <select name="priceType" defaultValue={service.price_type}>
                      <option value="fixed">Sabit</option>
                      <option value="range">Aralık</option>
                    </select>
                  </label>
                  <label>Alt / sabit fiyat<input name="priceMin" inputMode="decimal" defaultValue={(service.price_min_minor / 100).toFixed(2)} required /></label>
                  <label>Üst fiyat<input name="priceMax" inputMode="decimal" defaultValue={(service.price_max_minor / 100).toFixed(2)} required /></label>
                  <label>Para birimi<input name="currency" defaultValue={service.currency} minLength={3} maxLength={3} pattern="[A-Za-z]{3}" required /></label>
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
            <input name="category" placeholder="Kategori" defaultValue="Genel" minLength={1} maxLength={80} required />
            <input name="sortOrder" type="number" min={0} max={1000000} defaultValue={nextSortOrder} aria-label="Sıra" required />
            <input name="duration" type="number" min={5} max={720} defaultValue={30} aria-label="Süre dakika" required />
            <input name="bufferBefore" type="number" min={0} max={240} defaultValue={0} aria-label="Ön tampon dakika" required />
            <input name="bufferAfter" type="number" min={0} max={240} defaultValue={0} aria-label="Son tampon dakika" required />
            <select name="priceType" defaultValue="fixed" aria-label="Fiyat tipi">
              <option value="fixed">Sabit fiyat</option>
              <option value="range">Fiyat aralığı</option>
            </select>
            <input name="priceMin" inputMode="decimal" defaultValue="0.00" aria-label="Alt veya sabit fiyat" required />
            <input name="priceMax" inputMode="decimal" defaultValue="0.00" aria-label="Üst fiyat" required />
            <input name="currency" defaultValue="TRY" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" aria-label="Para birimi" required />
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
            <article className={`catalog-editor ${person.active ? '' : 'archived'}`} key={`${person.id}:${person.updated_at}`}>
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
