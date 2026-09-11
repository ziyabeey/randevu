import { FormEvent, useCallback, useEffect, useState } from 'react';

type Business = { id: string; name: string; slug: string; timezone: string };
type Membership = {
  id: string;
  business_id: string;
  role: 'owner' | 'manager' | 'staff';
  active: boolean;
  businesses: Business | null;
};
type Session = {
  user: null | { id: string; email: string | null; fullName: string | null };
  memberships: Membership[];
  activeBusinessId: string | null;
};
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

type ApiError = { error?: { message?: string } };

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

function money(minor: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(minor / 100);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextSession = await api<Session>('/api/session');
      setSession(nextSession);
      if (nextSession.user && nextSession.activeBusinessId) {
        try {
          setCatalog(await api<Catalog>('/api/catalog'));
        } catch {
          setCatalog(null);
        }
      } else {
        setCatalog(null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Bağlantı kurulamadı.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice('');
    const data = new FormData(event.currentTarget);
    try {
      if (authMode === 'signup') {
        const result = await api<{ ok: boolean; requiresEmailConfirmation: boolean }>('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email: data.get('email'), password: data.get('password'), fullName: data.get('fullName') }),
        });
        if (result.requiresEmailConfirmation) {
          setNotice('Hesap oluşturuldu. E-posta doğrulamasından sonra giriş yapabilirsiniz.');
          setAuthMode('login');
          return;
        }
      } else {
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
        });
      }
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kimlik işlemi başarısız.');
    } finally { setBusy(false); }
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice('');
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/businesses', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), timezone: 'Europe/Istanbul' }),
      });
      setNotice('İşletme oluşturuldu. Şimdi ilk hizmetinizi ve ekibinizi ekleyebilirsiniz.');
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'İşletme oluşturulamadı.'); }
    finally { setBusy(false); }
  }

  async function selectBusiness(businessId: string) {
    setBusy(true); setNotice('');
    try {
      await api('/api/businesses/select', { method: 'POST', body: JSON.stringify({ businessId }) });
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'İşletme seçilemedi.'); }
    finally { setBusy(false); }
  }

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = Number(String(data.get('price')).replace(',', '.'));
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
      setCatalog(await api<Catalog>('/api/catalog'));
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Hizmet eklenemedi.'); }
    finally { setBusy(false); }
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api('/api/staff', { method: 'POST', body: JSON.stringify({ name: data.get('name'), phone: data.get('phone') }) });
      form.reset();
      setNotice('Personel eklendi.');
      setCatalog(await api<Catalog>('/api/catalog'));
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Personel eklenemedi.'); }
    finally { setBusy(false); }
  }

  async function toggleAssignment(staffId: string, serviceId: string, active: boolean) {
    setBusy(true); setNotice('');
    try {
      await api(`/api/staff/${staffId}/services/${serviceId}`, { method: 'PUT', body: JSON.stringify({ active }) });
      setCatalog(await api<Catalog>('/api/catalog'));
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Yetkinlik güncellenemedi.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try { await api('/api/auth/logout', { method: 'POST' }); await load(); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="center-card"><p>Çalışma alanı hazırlanıyor…</p></main>;

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="YZT Randevu ana sayfa"><span className="wordmark">yzt<span>.</span></span><span className="product-name">randevu</span></a>
        {session?.user && <button className="ghost-button" type="button" onClick={() => void logout()} disabled={busy}>Çıkış yap</button>}
      </header>

      <main className="workspace">
        {notice && <div className="notice" role="status">{notice}</div>}

        {!session?.user ? (
          <section className="panel auth-panel">
            <p className="eyebrow">FAZ 3 · HİZMET + EKİP</p>
            <h1>{authMode === 'login' ? 'Çalışma alanına girin' : 'İşletme hesabınızı oluşturun'}</h1>
            <form className="form-stack" onSubmit={submitAuth}>
              {authMode === 'signup' && <label>Ad soyad<input name="fullName" autoComplete="name" /></label>}
              <label>E-posta<input name="email" type="email" autoComplete="email" required /></label>
              <label>Parola<input name="password" type="password" minLength={8} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required /></label>
              <button className="primary-button" disabled={busy}>{authMode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}</button>
            </form>
            <button className="text-button" type="button" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
              {authMode === 'login' ? 'Yeni işletme hesabı oluştur' : 'Zaten hesabım var'}
            </button>
          </section>
        ) : session.memberships.length === 0 ? (
          <section className="panel setup-panel">
            <p className="eyebrow">İLK KURULUM</p><h1>İşletmenizi oluşturun</h1>
            <p className="muted">Bu kayıt sizin tenant sınırınız olacak. Sonraki tüm hizmet ve ekip verileri bu işletmeye ait kalır.</p>
            <form className="form-stack" onSubmit={createBusiness}>
              <label>İşletme adı<input name="name" minLength={2} maxLength={120} required placeholder="Örn. YZT Studio" /></label>
              <button className="primary-button" disabled={busy}>İşletmeyi oluştur</button>
            </form>
          </section>
        ) : !catalog ? (
          <section className="panel setup-panel">
            <p className="eyebrow">İŞLETME SEÇİMİ</p><h1>Hangi işletmede çalışacağız?</h1>
            <div className="choice-list">
              {session.memberships.map((membership) => (
                <button key={membership.id} className="choice-button" disabled={busy} onClick={() => void selectBusiness(membership.business_id)}>
                  <strong>{membership.businesses?.name ?? 'İşletme'}</strong><span>{membership.role}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="dashboard-grid">
            <section className="panel span-two">
              <div className="section-head"><div><p className="eyebrow">KURULUM</p><h1>Hizmet ve ekip</h1></div><span className="role-badge">{catalog.membership.role}</span></div>
              <p className="muted">İlk booking altyapısının kataloğunu kuruyoruz. Müsaitlik ve randevu yazımı sonraki fazlarda gelecek.</p>
            </section>

            <section className="panel">
              <div className="section-head"><h2>Hizmetler</h2><span>{catalog.services.filter((item) => item.active).length}</span></div>
              {catalog.services.length === 0 ? <p className="empty">Henüz hizmet yok.</p> : <ul className="data-list">{catalog.services.map((service) => (
                <li key={service.id}><div><strong>{service.name}</strong><span>{service.duration_minutes} dk · {money(service.price_minor)}</span></div><span className={service.active ? 'dot active' : 'dot'} /></li>
              ))}</ul>}
              {catalog.membership.role !== 'staff' && <form className="inline-form" onSubmit={addService}>
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
              {catalog.membership.role !== 'staff' && <form className="inline-form" onSubmit={addStaff}>
                <input name="name" placeholder="Personel adı" required minLength={2} />
                <input name="phone" placeholder="Telefon (isteğe bağlı)" />
                <button className="primary-button" disabled={busy}>Ekle</button>
              </form>}
            </section>

            <section className="panel span-two">
              <div className="section-head"><h2>Hizmet yetkinlikleri</h2><span>StaffService</span></div>
              {catalog.staff.length === 0 || catalog.services.length === 0 ? <p className="empty">Eşleştirme için en az bir hizmet ve bir personel ekleyin.</p> : (
                <div className="matrix">
                  {catalog.staff.map((person) => <div className="matrix-row" key={person.id}>
                    <strong>{person.name}</strong>
                    <div className="chips">{catalog.services.filter((service) => service.active).map((service) => {
                      const assigned = catalog.assignments.some((item) => item.staff_id === person.id && item.service_id === service.id && item.active);
                      return <label className={`chip ${assigned ? 'selected' : ''}`} key={service.id}>
                        <input type="checkbox" checked={assigned} disabled={busy || catalog.membership.role === 'staff'} onChange={(event) => void toggleAssignment(person.id, service.id, event.target.checked)} />
                        {service.name}
                      </label>;
                    })}</div>
                  </div>)}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      <footer className="app-footer">YZT Digital · tenant-safe foundation</footer>
    </div>
  );
}
