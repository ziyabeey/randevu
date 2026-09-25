import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import type { FormEvent } from 'react';
import { ApiRequestError, api } from './api';
import { clearPendingTeamInvite, readPendingTeamInvite } from './teamInvite';

type Session = {
  user: null | { id: string; email: string | null; fullName: string | null };
  passwordRecovery: boolean;
};

type AuthMode = 'login' | 'signup';

const TERMINAL_INVITE_CODES = new Set([
  'INVITATION_INVALID',
  'INVITATION_NOT_FOUND',
  'INVITATION_ALREADY_USED',
  'INVITATION_REVOKED',
  'INVITATION_EXPIRED',
]);

export default function InvitePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(t('Davet bağlantınız bu sekmede güvenle tutuluyor.'));
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const attemptRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await api<Session>('/api/session'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Hesap durumu doğrulanamadı.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const token = readPendingTeamInvite();
    if (!token || !session?.user || session.passwordRecovery || attemptRef.current === token) return;
    attemptRef.current = token;
    setBusy(true);
    setNotice(t('Davet hesabınızla eşleştiriliyor…'));
    void api('/api/team/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }).then(() => {
      clearPendingTeamInvite();
      setNotice(t('Davet kabul edildi. Ekip alanı açılıyor…'));
      window.location.replace('/app/team');
    }).catch((error: unknown) => {
      attemptRef.current = null;
      if (error instanceof ApiRequestError && error.code && TERMINAL_INVITE_CODES.has(error.code)) {
        clearPendingTeamInvite();
      }
      setNotice(error instanceof Error ? error.message : t('Davet kabul edilemedi.'));
    }).finally(() => setBusy(false));
  }, [session]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setNotice('');
    try {
      if (authMode === 'signup') {
        const result = await api<{ requiresEmailConfirmation: boolean }>('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: data.get('email'),
            password: data.get('password'),
            fullName: data.get('fullName'),
          }),
        });
        if (result.requiresEmailConfirmation) {
          setNotice(t('Hesap oluşturuldu. E-postanızdaki doğrulama bağlantısını açın; davet bu sekmede korunacak.'));
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
      setNotice(error instanceof Error ? error.message : t('Hesap işlemi tamamlanamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      attemptRef.current = null;
      setNotice(t('Başka bir hesapla giriş yapabilirsiniz. Davet bu sekmede korunuyor.'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="center-card"><p>{t('Davet hazırlanıyor…')}</p></main>;

  const token = readPendingTeamInvite();
  if (!token) {
    return (
      <main className="center-card">
        <h1>{t('Davet artık kullanılamıyor')}</h1>
        <p className="muted">{t('Bağlantı geçersiz, süresi dolmuş veya daha önce kullanılmış olabilir.')}</p>
        <a className="primary-link" href="/app">{t('Çalışma alanına dön')}</a>
      </main>
    );
  }

  if (session?.user && session.passwordRecovery) {
    return (
      <main className="center-card">
        <p className="eyebrow">{t('DAVET BEKLİYOR')}</p>
        <h1>{t('Önce parolanızı tamamlayın')}</h1>
        <p className="muted">{t('Kurtarma oturumu ekip yetkisi kazanamaz. Yeni parolanızı belirledikten sonra bu davet aynı sekmede devam eder.')}</p>
        <a className="primary-link" href="/app">{t('Parola ekranına dön')}</a>
      </main>
    );
  }

  if (session?.user) {
    return (
      <main className="center-card">
        <p className="eyebrow">{t('EKİP DAVETİ')}</p>
        <h1>{t('Davet doğrulanıyor')}</h1>
        {notice && <div className="notice" role="status">{notice}</div>}
        <p className="muted">{t('Giriş yapılan hesap: {value}', { value: session.user.email ?? t('E-posta bilgisi yok') })}</p>
        <button className="ghost-button" type="button" disabled={busy} onClick={() => void logout()}>{t('Başka hesapla giriş yap')}</button>
      </main>
    );
  }

  return (
    <main className="center-card invite-card">
      <p className="eyebrow">{t('EKİP DAVETİ')}</p>
      <h1>{authMode === 'login' ? t('Davetli hesabınızla giriş yapın') : t('Davetli hesabınızı oluşturun')}</h1>
      <p className="muted">{t('Davet bağlantısındaki gizli anahtar adres çubuğundan kaldırıldı. Girişten sonra yalnız sunucuya gönderilecek.')}</p>
      {notice && <div className="notice" role="status">{notice}</div>}
      <form className="form-stack" onSubmit={submitAuth}>
        {authMode === 'signup' && <label>{t('Ad soyad')}<input name="fullName" autoComplete="name" maxLength={120} /></label>}
        <label>{t('E-posta')}<input name="email" type="email" autoComplete="email" required /></label>
        <label>{t('Parola')}<input name="password" type="password" minLength={10} maxLength={128} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required /></label>
        <button className="primary-button" disabled={busy}>{authMode === 'login' ? t('Giriş yap ve daveti kabul et') : t('Hesap oluştur')}</button>
      </form>
      <button className="text-button" type="button" disabled={busy} onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
        {authMode === 'login' ? t('Hesabım yok') : t('Zaten hesabım var')}
      </button>
    </main>
  );
}
