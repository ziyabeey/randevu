import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from './api';

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
  passwordRecovery: boolean;
  csrfToken: string;
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
type AuthMode = 'login' | 'signup' | 'recovery';

function money(minor: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(minor / 100);
}

function roleLabel(role: Membership['role']) {
  if (role === 'owner') return 'İşletme sahibi';
  if (role === 'manager') return 'Yönetici';
  return 'Çalışan';
}

function isRetryableApiError(error: unknown) {
  return error instanceof ApiRequestError
    && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextSession = await api<Session>('/api/session');
      setSession(nextSession);
      setSessionUnavailable(false);
      if (nextSession.user && nextSession.activeBusinessId && !nextSession.passwordRecovery) {
        try {
          setCatalog(await api<Catalog>('/api/catalog'));
        } catch {
          setCatalog(null);
        }
      } else {
        setCatalog(null);
      }
    } catch (error) {
      if (isRetryableApiError(error)) {
        setSessionUnavailable(true);
      } else {
        setSession(null);
        setCatalog(null);
        setSessionUnavailable(false);
      }
      setNotice(error instanceof Error ? error.message : 'Bağlantı kurulamadı.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get('auth');
    if (!authResult) return;
    if (authResult === 'confirmed') {
      setNotice('E-posta adresiniz doğrulandı. Hesabınız hazır.');
    } else if (authResult === 'recovery') {
      setNotice('Kurtarma bağlantısı doğrulandı. Şimdi yeni parolanızı belirleyin.');
      setShowPasswordChange(true);
    } else if (authResult === 'unavailable') {
      setNotice('Hesap servisine şu anda ulaşılamıyor. Bağlantıyı kısa süre sonra yeniden açın.');
    } else {
      setNotice('Doğrulama bağlantısı geçersiz veya süresi dolmuş. Yeni bir bağlantı isteyin.');
    }
    params.delete('auth');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    const data = new FormData(event.currentTarget);
    try {
      if (authMode === 'recovery') {
        const result = await api<{ ok: boolean; message: string }>('/api/auth/recovery', {
          method: 'POST',
          body: JSON.stringify({ email: data.get('email') }),
        });
        setNotice(result.message);
        setAuthMode('login');
        return;
      }

      if (authMode === 'signup') {
        const result = await api<{ ok: boolean; requiresEmailConfirmation: boolean }>('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: data.get('email'),
            password: data.get('password'),
            fullName: data.get('fullName'),
          }),
        });
        if (result.requiresEmailConfirmation) {
          setNotice('Hesap oluşturuldu. E-postanızdaki doğrulama bağlantısını açtıktan sonra çalışma alanına girebilirsiniz.');
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
      setNotice(error instanceof Error ? error.message : 'Hesap işlemi tamamlanamadı.');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirmation = String(data.get('passwordConfirmation') ?? '');
    if (password !== confirmation) {
      setNotice('Parola tekrarı eşleşmiyor.');
      return;
    }

    setBusy(true);
    setNotice('');
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
      setShowPasswordChange(false);
      setNotice('Parolanız güncellendi. Güvenliğiniz için yeniden giriş yapın.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Parola güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/businesses', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), timezone: 'Europe/Istanbul' }),
      });
      setNotice('İşletme oluşturuldu. Şimdi ilk hizmetinizi ve ekibinizi ekleyebilirsiniz.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'İşletme oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  }

  async function selectBusiness(businessId: string) {
    setBusy(true);
    setNotice('');
    try {
      await api('/api/businesses/select', { method: 'POST', body: JSON.stringify({ businessId }) });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'İşletme seçilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Hizmet eklenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ name: data.get('name'), phone: data.get('phone') }),
      });
      form.reset();
      setNotice('Personel eklendi.');
      setCatalog(await api<Catalog>('/api/catalog'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Personel eklenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleAssignment(staffId: string, serviceId: string, active: boolean) {
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/staff/${staffId}/services/${serviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      });
      setCatalog(await api<Catalog>('/api/catalog'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Yetkinlik güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setShowPasswordChange(false);
      setSession(null);
      setCatalog(null);
      setSessionUnavailable(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="center-card"><p>Çalışma alanı hazırlanıyor…</p></main>;

  const passwordRequired = Boolean(session?.user && session.passwordRecovery);
  const showPasswordPanel = Boolean(session?.user && (passwordRequired || showPasswordChange));

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="YZT Randevu ana sayfa">
          <span className="wordmark">yzt<span>.</span></span><span className="product-name">randevu</span>
        </a>
        {session?.user && (
          <div className="header-actions">
            {!passwordRequired && (
              <button className="ghost-button" type="button" onClick={() => setShowPasswordChange(true)} disabled={busy}>
                Parolayı değiştir
              </button>
            )}
            <button className="ghost-button" type="button" onClick={() => void logout()} disabled={busy}>Çıkış yap</button>
          </div>
        )}
      </header>

      <main className="workspace">
        {notice && <div className="notice" role="status">{notice}</div>}

        {sessionUnavailable && !session?.user ? (
          <section className="panel setup-panel">
            <p className="eyebrow">OTURUM DOĞRULANIYOR</p>
            <h1>Oturum durumu şu anda doğrulanamıyor</h1>
            <p className="muted">Geçici bağlantı hatası girişinizi sonlandırmaz. Oturum servisine yeniden ulaştığımızda çalışma alanınız kaldığı yerden devam eder.</p>
            <button className="primary-button" type="button" onClick={() => void load()} disabled={busy}>Tekrar dene</button>
          </section>
        ) : !session?.user ? (
          <section className="panel auth-panel">
            <p className="eyebrow">GÜVENLİ HESAP ERİŞİMİ</p>
            <h1>
              {authMode === 'login'
                ? 'Çalışma alanına girin'
                : authMode === 'signup'
                  ? 'İşletme hesabınızı oluşturun'
                  : 'Parolanızı yenileyin'}
            </h1>
            <form className="form-stack" onSubmit={submitAuth}>
              {authMode === 'signup' && <label>Ad soyad<input name="fullName" autoComplete="name" maxLength={120} /></label>}
              <label>E-posta<input name="email" type="email" autoComplete="email" required /></label>
              {authMode !== 'recovery' && (
                <label>
                  Parola
                  <input
                    name="password"
                    type="password"
                    minLength={10}
                    maxLength={128}
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    required
                  />
                </label>
              )}
              <button className="primary-button" disabled={busy}>
                {authMode === 'login' ? 'Giriş yap' : authMode === 'signup' ? 'Hesap oluştur' : 'Kurtarma bağlantısı gönder'}
              </button>
            </form>
            <div className="auth-actions">
              {authMode === 'login' && (
                <>
                  <button className="text-button" type="button" onClick={() => setAuthMode('recovery')}>Parolamı unuttum</button>
                  <button className="text-button" type="button" onClick={() => setAuthMode('signup')}>Yeni işletme hesabı oluştur</button>
                </>
              )}
              {authMode !== 'login' && (
                <button className="text-button" type="button" onClick={() => setAuthMode('login')}>Giriş ekranına dön</button>
              )}
            </div>
          </section>
        ) : showPasswordPanel ? (
          <section className="panel auth-panel">
            <p className="eyebrow">{passwordRequired ? 'PAROLA KURTARMA' : 'HESAP GÜVENLİĞİ'}</p>
            <h1>Yeni parolanızı belirleyin</h1>
            <p className="muted">En az 10 karakter kullanın. Değişiklikten sonra bütün açık oturumlar kapatılır.</p>
            <form className="form-stack" onSubmit={changePassword}>
              <label>Yeni parola<input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
              <label>Yeni parola tekrar<input name="passwordConfirmation" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
              <button className="primary-button" disabled={busy}>Parolayı güncelle</button>
            </form>
            {!passwordRequired && (
              <button className="text-button" type="button" onClick={() => setShowPasswordChange(false)}>Vazgeç</button>
            )}
          </section>
        ) : session.memberships.length === 0 ? (
          <section className="panel setup-panel">
            <p className="eyebrow">İLK KURULUM</p><h1>İşletmenizi oluşturun</h1>
            <p className="muted">Hizmetleriniz, ekibiniz ve randevularınız bu işletme altında güvenle ayrılır.</p>
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
                  <strong>{membership.businesses?.name ?? 'İşletme'}</strong><span>{roleLabel(membership.role)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="dashboard-grid">
            <section className="panel span-two">
              <div className="section-head">
                <div><p className="eyebrow">İŞLETME AYARLARI</p><h1>Hizmet ve ekip</h1></div>
                <span className="role-badge">{roleLabel(catalog.membership.role)}</span>
              </div>
              <p className="muted">Müşterilerin seçebileceği hizmetleri, ekibi ve hizmet yetkinliklerini yönetin.</p>
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
              <div className="section-head"><h2>Hizmet yetkinlikleri</h2><span>Ekip eşleştirmesi</span></div>
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
      <footer className="app-footer">YZT Digital · Randevu çalışma alanı</footer>
    </div>
  );
}
