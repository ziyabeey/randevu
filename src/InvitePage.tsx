import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiRequestError, api } from './api';
import { clearPendingTeamInvite, readPendingTeamInvite } from './teamInvite';
import { getErrorMessage } from './errors.ts';

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
  const [notice, setNotice] = useState('Davet bağlantınız bu sekmede güvenle tutuluyor.');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const attemptRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await api<Session>('/api/session'));
    } catch (error) {
      setNotice(getErrorMessage(error, 'Hesap durumu doğrulanamadı.'));
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
    setNotice('Davet hesabınızla eşleştiriliyor…');
    void api('/api/team/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }).then(() => {
      clearPendingTeamInvite();
      setNotice('Davet kabul edildi. Ekip alanı açılıyor…');
      window.location.replace('/team');
    }).catch((error: unknown) => {
      attemptRef.current = null;
      if (error instanceof ApiRequestError && error.code && TERMINAL_INVITE_CODES.has(error.code)) {
        clearPendingTeamInvite();
      }
      setNotice(getErrorMessage(error, 'Davet kabul edilemedi.'));
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
          setNotice('Hesap oluşturuldu. E-postanızdaki doğrulama bağlantısını açın; davet bu sekmede korunacak.');
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
      setNotice(getErrorMessage(error, 'Hesap işlemi tamamlanamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      attemptRef.current = null;
      setNotice('Başka bir hesapla giriş yapabilirsiniz. Davet bu sekmede korunuyor.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="center-card"><p>Davet hazırlanıyor…</p></main>;

  const token = readPendingTeamInvite();
  if (!token) {
    return (
      <main className="center-card">
        <h1>Davet artık kullanılamıyor</h1>
        <p className="muted">Bağlantı geçersiz, süresi dolmuş veya daha önce kullanılmış olabilir.</p>
        <a className="primary-link" href="/">Çalışma alanına dön</a>
      </main>
    );
  }

  if (session?.user && session.passwordRecovery) {
    return (
      <main className="center-card">
        <p className="eyebrow">DAVET BEKLİYOR</p>
        <h1>Önce parolanızı tamamlayın</h1>
        <p className="muted">Kurtarma oturumu ekip yetkisi kazanamaz. Yeni parolanızı belirledikten sonra bu davet aynı sekmede devam eder.</p>
        <a className="primary-link" href="/account">Parola ekranına dön</a>
      </main>
    );
  }

  if (session?.user) {
    return (
      <main className="center-card">
        <p className="eyebrow">EKİP DAVETİ</p>
        <h1>Davet doğrulanıyor</h1>
        {notice && <div className="notice" role="status">{notice}</div>}
        <p className="muted">Giriş yapılan hesap: {session.user.email ?? 'E-posta bilgisi yok'}</p>
        <button className="ghost-button" type="button" disabled={busy} onClick={() => void logout()}>Başka hesapla giriş yap</button>
      </main>
    );
  }

  return (
    <main className="center-card invite-card">
      <p className="eyebrow">EKİP DAVETİ</p>
      <h1>{authMode === 'login' ? 'Davetli hesabınızla giriş yapın' : 'Davetli hesabınızı oluşturun'}</h1>
      <p className="muted">Davet bağlantısındaki gizli anahtar adres çubuğundan kaldırıldı. Girişten sonra yalnız sunucuya gönderilecek.</p>
      {notice && <div className="notice" role="status">{notice}</div>}
      <form className="form-stack" onSubmit={submitAuth}>
        {authMode === 'signup' && <label>Ad soyad<input name="fullName" autoComplete="name" maxLength={120} /></label>}
        <label>E-posta<input name="email" type="email" autoComplete="email" required /></label>
        <label>Parola<input name="password" type="password" minLength={10} maxLength={128} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required /></label>
        <button className="primary-button" disabled={busy}>{authMode === 'login' ? 'Giriş yap ve daveti kabul et' : 'Hesap oluştur'}</button>
      </form>
      <button className="text-button" type="button" disabled={busy} onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
        {authMode === 'login' ? 'Hesabım yok' : 'Zaten hesabım var'}
      </button>
    </main>
  );
}
