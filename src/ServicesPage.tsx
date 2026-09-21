import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';
import { useWorkspace } from './workspace-context';

type Service = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_minor: number;
  currency: string;
  active: boolean;
};
type Staff = { id: string; membership_id: string | null; name: string; phone: string | null; active: boolean };
type Assignment = { staff_id: string; service_id: string; active: boolean };
type Catalog = {
  membership: { id: string; business_id: string; role: 'owner' | 'manager' | 'staff'; active: boolean };
  services: Service[];
  staff: Staff[];
  assignments: Assignment[];
};

function money(minor: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(minor / 100);
}

function roleLabel(role: Catalog['membership']['role']) {
  if (role === 'owner') return 'İşletme sahibi';
  if (role === 'manager') return 'Yönetici';
  return 'Çalışan';
}

export default function ServicesPage() {
  const { activeBusinessId, scopeEpoch } = useWorkspace();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api<Catalog>('/api/catalog');
      if (next.membership.business_id !== activeBusinessId) {
        throw new Error('İşletme bağlamı değişti. Hizmetler güncel işletmeyle yeniden açılıyor.');
      }
      setCatalog(next);
      setNotice('');
    } catch (error) {
      setCatalog(null);
      setNotice(error instanceof Error ? error.message : 'Hizmetler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => { void load(); }, [load, scopeEpoch]);

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = Number(String(data.get('price')).replace(',', '.'));
    setBusy(true);
    setNotice('');
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
      setNotice('Hizmet eklendi.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Hizmet eklenemedi.');
    } finally { setBusy(false); }
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setNotice('');
    try {
      await api('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), phone: data.get('phone') }),
      });
      form.reset();
      setNotice('Personel eklendi.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Personel eklenemedi.');
    } finally { setBusy(false); }
  }

  async function toggleAssignment(staffId: string, serviceId: string, active: boolean) {
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/staff/${staffId}/services/${serviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Yetkinlik güncellenemedi.');
    } finally { setBusy(false); }
  }

  if (loading && !catalog) {
    return <main className="workspace-page"><section className="panel"><p>Hizmetler hazırlanıyor…</p></section></main>;
  }
  if (!catalog) {
    return <main className="workspace-page"><section className="panel"><h1>Hizmetler açılamadı</h1><p>{notice}</p><button className="primary-button" type="button" onClick={() => void load()}>Tekrar dene</button></section></main>;
  }

  const canManage = catalog.membership.role !== 'staff';

  return (
    <main className="workspace-page">
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="dashboard-grid">
        <section className="panel span-two">
          <div className="section-head">
            <div><p className="eyebrow">HİZMETLER</p><h1>Hizmet ve ekip yetkinlikleri</h1></div>
            <span className="role-badge">{roleLabel(catalog.membership.role)}</span>
          </div>
          <p className="muted">Müşterilerin seçebileceği hizmetleri ve bu hizmetleri verebilen ekip üyelerini yönetin.</p>
        </section>

        <section className="panel">
          <div className="section-head"><h2>Hizmetler</h2><span>{catalog.services.filter((item) => item.active).length}</span></div>
          {catalog.services.length === 0 ? <p className="empty">Henüz hizmet yok.</p> : <ul className="data-list">{catalog.services.map((service) => (
            <li key={service.id}><div><strong>{service.name}</strong><span>{service.duration_minutes} dk · {money(service.price_minor)}</span></div><span className={service.active ? 'dot active' : 'dot'} /></li>
          ))}</ul>}
          {canManage && <form className="inline-form" onSubmit={addService}>
            <input name="name" placeholder="Hizmet adı" required minLength={2} />
            <input name="duration" type="number" min={5} max={720} defaultValue={30} required aria-label="Süre dakika" />
            <input name="price" inputMode="decimal" defaultValue="0" required aria-label="Fiyat TL" />
            <button className="primary-button" disabled={busy}>Ekle</button>
          </form>}
        </section>

        <section className="panel">
          <div className="section-head"><h2>Ekip</h2><span>{catalog.staff.filter((item) => item.active).length}</span></div>
          {catalog.staff.length === 0 ? <p className="empty">Henüz personel yok.</p> : <ul className="data-list">{catalog.staff.map((person) => (
            <li key={person.id}><div><strong>{person.name}</strong><span>{person.phone || 'Telefon eklenmedi'}</span></div><span className={person.active ? 'dot active' : 'dot'} /></li>
          ))}</ul>}
          {canManage && <form className="inline-form" onSubmit={addStaff}>
            <input name="name" placeholder="Personel adı" required minLength={2} />
            <input name="phone" placeholder="Telefon (isteğe bağlı)" />
            <button className="primary-button" disabled={busy}>Ekle</button>
          </form>}
        </section>

        <section className="panel span-two">
          <div className="section-head"><h2>Hizmet yetkinlikleri</h2><span>Ekip eşleştirmesi</span></div>
          {catalog.staff.length === 0 || catalog.services.length === 0 ? <p className="empty">Eşleştirme için en az bir hizmet ve bir personel ekleyin.</p> : (
            <div className="matrix">
              {catalog.staff.map((person) => <div className="matrix-row" key={person.id}>
                <strong>{person.name}</strong>
                <div className="chips">{catalog.services.filter((service) => service.active).map((service) => {
                  const assigned = catalog.assignments.some((item) => item.staff_id === person.id && item.service_id === service.id && item.active);
                  return <label className={`chip ${assigned ? 'selected' : ''}`} key={service.id}>
                    <input type="checkbox" checked={assigned} disabled={busy || !canManage} onChange={(event) => void toggleAssignment(person.id, service.id, event.target.checked)} />
                    {service.name}
                  </label>;
                })}</div>
              </div>)}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
