import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, MouseEvent, ReactNode } from 'react';
import { api, ApiRequestError } from './api';
import AccountMenu from './AccountMenu';
import { t } from './i18n';
import { kolayAppTabFromWorkspacePage, navigateApp, workspaceHref, type WorkspacePage } from './workspace-route';
import {
  WorkspaceProvider,
  type WorkspaceContextValue,
  type WorkspaceSession,
} from './workspace-context';

const CalendarPage = lazy(() => import('./CalendarPage'));
const BookingPage = lazy(() => import('./BookingPage'));
const CustomersPage = lazy(() => import('./CustomersPage'));
const ServicesPage = lazy(() => import('./ServicesPage'));
const FeedbackPage = lazy(() => import('./FeedbackPage'));
const ProductsPage = lazy(() => import('./ProductsPage'));
const ExpensesPage = lazy(() => import('./ExpensesPage'));
const FinancialReportsPage = lazy(() => import('./FinancialReportsPage'));
const AvailabilityPage = lazy(() => import('./AvailabilityPage'));
const OnboardingPage = lazy(() => import('./OnboardingPage'));
const TeamPage = lazy(() => import('./TeamPage'));
const PublicBookingSettingsPage = lazy(() => import('./PublicBookingSettingsPage'));
const KolayAppSurface = lazy(() => import('./kolayapp/KolayAppSurface'));

type AuthMode = 'login' | 'signup' | 'recovery';

const NAV_ITEMS: Array<{ page: Exclude<WorkspacePage, 'not-found'>; label: string }> = [
  { page: 'calendar', label: 'Takvim' },
  { page: 'bookings', label: 'Randevular' },
  { page: 'customers', label: 'Müşteriler' },
  { page: 'services', label: 'Hizmetler' },
  { page: 'products', label: 'Ürün ve stok' },
  { page: 'expenses', label: 'Masraflar' },
  { page: 'reports', label: 'Kasa ve raporlar' },
  { page: 'team', label: 'Ekip' },
  { page: 'availability', label: 'Müsaitlik' },
  { page: 'setup', label: 'Kurulum' },
  { page: 'public-booking', label: 'Online Randevu' },
  { page: 'feedback', label: 'Yorumlar' },
];

function isRetryableApiError(error: unknown) {
  return error instanceof ApiRequestError
    && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}

function WorkspaceLink({ href, active, children }: { href: string; active?: boolean; children: ReactNode }) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateApp(href);
  }
  return <a href={href} aria-current={active ? 'page' : undefined} onClick={click}>{children}</a>;
}

function WorkspaceOutlet({ page }: { page: WorkspacePage }) {
  if (page === 'calendar') return <CalendarPage />;
  if (page === 'bookings') return <BookingPage />;
  if (page === 'customers') return <CustomersPage />;
  if (page === 'services') return <ServicesPage />;
  if (page === 'products') return <ProductsPage />;
  if (page === 'expenses') return <ExpensesPage />;
  if (page === 'reports') return <FinancialReportsPage />;
  if (page === 'availability') return <AvailabilityPage />;
  if (page === 'setup') return <OnboardingPage />;
  if (page === 'team') return <TeamPage />;
  if (page === 'public-booking') return <PublicBookingSettingsPage />;
  if (page === 'feedback') return <FeedbackPage />;
  return (
    <main className="workspace-page">
      <section className="panel workspace-not-found">
        <p className="eyebrow">SAYFA BULUNAMADI</p>
        <h1>Bu çalışma alanı yolu bulunamadı</h1>
        <p className="muted">Takvime dönüp işletme çalışmalarınıza devam edebilirsiniz.</p>
        <WorkspaceLink href="/app/calendar">Takvime dön</WorkspaceLink>
      </section>
    </main>
  );
}

export default function WorkspaceShell({ page }: { page: WorkspacePage }) {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [scopeChanging, setScopeChanging] = useState(false);

  const refreshSession = useCallback(async () => {
    const next = await api<WorkspaceSession>('/api/session');
    setSession(next);
    setSessionUnavailable(false);
    return next;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshSession();
    } catch (error) {
      if (isRetryableApiError(error)) {
        setSessionUnavailable(true);
      } else {
        setSession(null);
        setSessionUnavailable(false);
      }
      setNotice(error instanceof Error ? error.message : 'Bağlantı kurulamadı.');
    } finally {
      setLoading(false);
    }
  }, [refreshSession]);

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
      await refreshSession();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Hesap işlemi tamamlanamadı.');
    } finally { setBusy(false); }
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
      await refreshSession();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Parola güncellenemedi.');
    } finally { setBusy(false); }
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
      setNotice('İşletme oluşturuldu. Devam etmek için işletmenizi seçin.');
      setScopeEpoch((value) => value + 1);
      await refreshSession();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'İşletme oluşturulamadı.');
    } finally { setBusy(false); }
  }

  const selectBusiness = useCallback(async (businessId: string, options: { to?: string } = {}) => {
    if (businessId === session?.activeBusinessId) return;
    setBusy(true);
    setScopeChanging(true);
    setNotice('');
    setScopeEpoch((value) => value + 1);
    try {
      await api('/api/businesses/select', {
        method: 'POST',
        body: JSON.stringify({ businessId }),
      });
      const verified = await refreshSession();
      if (verified.activeBusinessId !== businessId) {
        throw new ApiRequestError('İşletme seçimi sunucuda doğrulanamadı.', 409, 'WORKSPACE_CONTEXT_CHANGED');
      }
      setScopeEpoch((value) => value + 1);
      navigateApp(options.to ?? '/app/calendar', { replace: true });
    } catch (error) {
      try { await refreshSession(); } catch { /* preserve the actionable selection error */ }
      setNotice(error instanceof Error ? error.message : 'İşletme seçilemedi.');
      throw error;
    } finally {
      setScopeChanging(false);
      setBusy(false);
    }
  }, [refreshSession, session?.activeBusinessId]);

  async function logout() {
    setBusy(true);
    setShowPasswordChange(false);
    setSession(null);
    setSessionUnavailable(false);
    setNotice('');
    setScopeEpoch((value) => value + 1);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      await refreshSession();
      navigateApp('/app', { replace: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Çıkış işlemi sunucuda doğrulanamadı. Yeniden giriş yapmadan önce tekrar deneyin.');
    } finally { setBusy(false); }
  }

  const kolayTab = kolayAppTabFromWorkspacePage(page);
  const passwordRequired = Boolean(session?.user && session.passwordRecovery);
  const showPasswordPanel = Boolean(session?.user && (passwordRequired || showPasswordChange));
  const activeMembership = session?.memberships.find((membership) => membership.business_id === session.activeBusinessId) ?? null;
  const ready = Boolean(session?.user && activeMembership && !session?.passwordRecovery);
  const contextValue = useMemo<WorkspaceContextValue | null>(() => {
    if (!session || !activeMembership || !ready) return null;
    return {
      session,
      activeMembership,
      activeBusiness: activeMembership.businesses,
      activeBusinessId: activeMembership.business_id,
      scopeEpoch,
      refreshSession,
      selectBusiness,
      account: {
        openPasswordChange: () => setShowPasswordChange(true),
        logout,
      },
    };
  // logout reads only setters and api; it is stable enough for the context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMembership, ready, refreshSession, scopeEpoch, selectBusiness, session]);

  if (loading && !session) return <main className="center-card"><p>Çalışma alanı hazırlanıyor…</p></main>;

  if (ready && contextValue && kolayTab && !showPasswordChange) {
    return (
      <WorkspaceProvider value={contextValue}>
        <Suspense fallback={<main className="route-loading" aria-busy="true">KolayApp hazırlanıyor…</main>}>
          <KolayAppSurface
            key={`${session?.activeBusinessId ?? 'none'}:${scopeEpoch}:${kolayTab}`}
            activeTab={kolayTab}
            notice={notice}
            scopeChanging={scopeChanging}
          />
        </Suspense>
      </WorkspaceProvider>
    );
  }

  return (
    <div className="app-shell workspace-app-shell">
      <header className="app-header workspace-header">
        <a className="brand" href="/app" aria-label="Randevu çalışma alanı">
          <span className="wordmark">yzt<span>.</span></span><span className="product-name">randevu</span>
        </a>
        {ready && session && activeMembership && (
          <div className="workspace-business">
            <label>
              <span>İşletme</span>
              <select
                aria-label="Aktif işletme"
                value={session.activeBusinessId ?? ''}
                disabled={busy || scopeChanging}
                onChange={(event) => void selectBusiness(event.target.value).catch(() => undefined)}
              >
                {session.memberships.map((membership) => (
                  <option value={membership.business_id} key={membership.id}>
                    {membership.businesses?.name ?? 'İşletme'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {session?.user && (ready && session.activeBusinessId ? (
          <AccountMenu
            businessId={session.activeBusinessId}
            email={session.user.email}
            onChangePassword={() => setShowPasswordChange(true)}
            onLogout={() => void logout()}
            busy={busy}
          />
        ) : (
          <div className="header-actions">
            {!passwordRequired && <button className="ghost-button" type="button" onClick={() => setShowPasswordChange(true)} disabled={busy}>{t('Parolayı değiştir')}</button>}
            <button className="ghost-button" type="button" onClick={() => void logout()} disabled={busy}>{t('Çıkış yap')}</button>
          </div>
        ))}
      </header>

      {ready && (
        <>
          <nav className="workspace-panel-nav" aria-label="İşletme menüsü">
            {NAV_ITEMS.map((item) => (
              <WorkspaceLink href={workspaceHref(item.page)} active={page === item.page} key={item.page}>{item.label}</WorkspaceLink>
            ))}
          </nav>
          <details className="workspace-mobile-nav">
            <summary>İşletme menüsü</summary>
            <nav aria-label="Mobil işletme menüsü">
              {NAV_ITEMS.map((item) => (
                <WorkspaceLink href={workspaceHref(item.page)} active={page === item.page} key={item.page}>{item.label}</WorkspaceLink>
              ))}
            </nav>
          </details>
        </>
      )}

      <div className="workspace-shell-body">
        {notice && <div className="notice workspace-shell-notice" role="status">{notice}</div>}

        {sessionUnavailable && !session?.user ? (
          <section className="panel setup-panel workspace-gate">
            <p className="eyebrow">OTURUM DOĞRULANIYOR</p>
            <h1>Oturum durumu şu anda doğrulanamıyor</h1>
            <p className="muted">Geçici bağlantı hatası girişinizi sonlandırmaz. Oturum servisine yeniden ulaştığımızda çalışma alanınız kaldığı yerden devam eder.</p>
            <button className="primary-button" type="button" onClick={() => void load()} disabled={busy}>Tekrar dene</button>
          </section>
        ) : !session?.user ? (
          <section className="panel auth-panel workspace-gate">
            <p className="eyebrow">GÜVENLİ HESAP ERİŞİMİ</p>
            <h1>{authMode === 'login' ? 'Çalışma alanına girin' : authMode === 'signup' ? 'İşletme hesabınızı oluşturun' : 'Parolanızı yenileyin'}</h1>
            <form className="form-stack" onSubmit={submitAuth}>
              {authMode === 'signup' && <label>Ad soyad<input name="fullName" autoComplete="name" maxLength={120} /></label>}
              <label>E-posta<input name="email" type="email" autoComplete="email" required /></label>
              {authMode !== 'recovery' && <label>Parola<input name="password" type="password" minLength={10} maxLength={128} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required /></label>}
              <button className="primary-button" disabled={busy}>{authMode === 'login' ? 'Giriş yap' : authMode === 'signup' ? 'Hesap oluştur' : 'Kurtarma bağlantısı gönder'}</button>
            </form>
            <div className="auth-actions">
              {authMode === 'login' ? <>
                <button className="text-button" type="button" onClick={() => setAuthMode('recovery')}>Parolamı unuttum</button>
                <button className="text-button" type="button" onClick={() => setAuthMode('signup')}>Yeni işletme hesabı oluştur</button>
              </> : <button className="text-button" type="button" onClick={() => setAuthMode('login')}>Giriş ekranına dön</button>}
            </div>
          </section>
        ) : showPasswordPanel ? (
          <section className="panel auth-panel workspace-gate">
            <p className="eyebrow">{passwordRequired ? 'PAROLA KURTARMA' : 'HESAP GÜVENLİĞİ'}</p>
            <h1>Yeni parolanızı belirleyin</h1>
            <p className="muted">En az 10 karakter kullanın. Değişiklikten sonra bütün açık oturumlar kapatılır.</p>
            <form className="form-stack" onSubmit={changePassword}>
              <label>Yeni parola<input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
              <label>Yeni parola tekrar<input name="passwordConfirmation" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
              <button className="primary-button" disabled={busy}>Parolayı güncelle</button>
            </form>
            {!passwordRequired && <button className="text-button" type="button" onClick={() => setShowPasswordChange(false)}>Vazgeç</button>}
          </section>
        ) : session.memberships.length === 0 ? (
          <section className="panel setup-panel workspace-gate">
            <p className="eyebrow">İLK KURULUM</p><h1>İşletmenizi oluşturun</h1>
            <p className="muted">Hizmetleriniz, ekibiniz ve randevularınız bu işletme altında güvenle ayrılır.</p>
            <form className="form-stack" onSubmit={createBusiness}>
              <label>İşletme adı<input name="name" minLength={2} maxLength={120} required placeholder="Örn. YZT Studio" /></label>
              <button className="primary-button" disabled={busy}>İşletmeyi oluştur</button>
            </form>
          </section>
        ) : !activeMembership ? (
          <section className="panel setup-panel workspace-gate">
            <p className="eyebrow">İŞLETME SEÇİMİ</p><h1>Hangi işletmede çalışacağız?</h1>
            <div className="choice-list">
              {session.memberships.map((membership) => (
                <button key={membership.id} className="choice-button" disabled={busy} onClick={() => void selectBusiness(membership.business_id).catch(() => undefined)}>
                  <strong>{membership.businesses?.name ?? 'İşletme'}</strong><span>{membership.role === 'owner' ? 'İşletme sahibi' : membership.role === 'manager' ? 'Yönetici' : 'Çalışan'}</span>
                </button>
              ))}
            </div>
          </section>
        ) : scopeChanging || !contextValue ? (
          <section className="panel workspace-gate"><p>İşletme bağlamı güncelleniyor…</p></section>
        ) : (
          <WorkspaceProvider value={contextValue}>
            <div className="workspace-outlet" key={`${session.activeBusinessId}:${scopeEpoch}`}>
              <Suspense fallback={<main className="route-loading" aria-busy="true">Sayfa hazırlanıyor…</main>}>
                <WorkspaceOutlet page={page} />
              </Suspense>
            </div>
          </WorkspaceProvider>
        )}
      </div>

      <footer className="app-footer">YZT Digital · Randevu çalışma alanı</footer>
    </div>
  );
}
