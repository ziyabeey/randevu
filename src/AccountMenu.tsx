import { useEffect, useState } from 'react';
import { api } from './api';
import { formatDateTime, t } from './i18n';
import LanguageSwitch from './LanguageSwitch';

// F16-08 account menu, shared by the Randevu panel header and the SalonApp
// "Diğer" tab: who is signed in, the active business and role, the business
// plan from real subscription data, language, password change and sign-out.
// Business switching stays next to it (the existing business selector).

type Role = 'owner' | 'manager' | 'staff';
type PlanStatus = 'pilot' | 'trial' | 'active' | 'past_due' | 'cancelled';

export type AccountSummary = {
  businessId: string;
  businessName: string;
  role: Role;
  email: string | null;
  financialPermissions: string[];
  plan: { planKey: string; status: PlanStatus; periodEnd: string | null; access: 'full' | 'read_only' };
};

export function roleLabel(role: Role) {
  if (role === 'owner') return t('İşletme sahibi');
  if (role === 'manager') return t('Yönetici');
  return t('Çalışan');
}

function planStatusLabel(status: PlanStatus) {
  if (status === 'pilot') return t('Pilot (manuel etkinleştirme)');
  if (status === 'trial') return t('Deneme');
  if (status === 'active') return t('Aktif');
  if (status === 'past_due') return t('Ödeme bekleniyor');
  return t('Aktif değil');
}

function planName(planKey: string) {
  if (planKey === 'pilot') return t('Pilot plan');
  return planKey.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

const PERMISSION_LABELS: Record<string, string> = {
  payments_write: 'Tahsilat',
  pricing_adjustments_write: 'Fiyat ve indirim',
  financial_reports_read: 'Mali raporlar',
  inventory_write: 'Stok',
  expenses_write: 'Masraf',
};

export default function AccountMenu({ businessId, email, onChangePassword, onLogout, busy = false, variant = 'menu' }: {
  businessId: string;
  email: string | null;
  onChangePassword: () => void;
  onLogout: () => void;
  busy?: boolean;
  variant?: 'menu' | 'panel';
}) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAccount(null);
    setFailed(false);
    void api<{ account: AccountSummary }>('/api/account')
      .then((result) => {
        if (cancelled) return;
        if (result.account.businessId !== businessId) throw new Error('stale');
        setAccount(result.account);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [businessId]);

  const body = (
    <div className="account-menu-body">
      <dl className="account-facts">
        <div><dt>{t('Hesap')}</dt><dd>{email ?? account?.email ?? '—'}</dd></div>
        {account ? (
          <>
            <div><dt>{t('İşletme')}</dt><dd>{account.businessName}</dd></div>
            <div><dt>{t('Üyelik')}</dt><dd>{roleLabel(account.role)}</dd></div>
            <div>
              <dt>{t('Plan')}</dt>
              <dd>
                {planName(account.plan.planKey)} · {planStatusLabel(account.plan.status)}
                {account.plan.periodEnd && <small>{t('Dönem sonu: {date}', { date: formatDateTime(account.plan.periodEnd, { dateStyle: 'medium' }) })}</small>}
              </dd>
            </div>
            {account.role === 'staff' && (
              <div>
                <dt>{t('Yetkiler')}</dt>
                <dd>{account.financialPermissions.length
                  ? account.financialPermissions.map((key) => t(PERMISSION_LABELS[key] ?? 'Diğer yetki')).join(', ')
                  : t('Mali yetki yok')}</dd>
              </div>
            )}
          </>
        ) : failed ? (
          <div><dt>{t('Plan')}</dt><dd>{t('Hesap bilgisi şu anda yüklenemedi.')}</dd></div>
        ) : (
          <div><dt>{t('Plan')}</dt><dd aria-busy="true">{t('Yükleniyor…')}</dd></div>
        )}
      </dl>
      {account?.plan.access === 'read_only' && (
        <p className="account-plan-warning" role="status">{t('Plan aktif değil: kayıtlar yalnızca görüntülenebilir ve yeni online randevu alınmaz. Mevcut müşteri randevuları yönetim bağlantısından görüntülenip iptal edilebilir.')}</p>
      )}
      {account?.plan.status === 'past_due' && (
        <p className="account-plan-warning" role="status">{t('Plan ödemesi bekleniyor. Erişim şimdilik devam ediyor; otomatik tahsilat yapılmaz.')}</p>
      )}
      <LanguageSwitch />
      <div className="account-actions">
        <button className="ghost-button" type="button" onClick={onChangePassword} disabled={busy}>{t('Parolayı değiştir')}</button>
        <button className="ghost-button" type="button" onClick={onLogout} disabled={busy}>{t('Çıkış yap')}</button>
      </div>
    </div>
  );

  if (variant === 'panel') {
    return (
      <section className="account-panel" aria-labelledby="account-panel-title">
        <h2 id="account-panel-title">{t('Hesap ve üyelik')}</h2>
        {body}
      </section>
    );
  }
  return (
    <details className="account-menu">
      <summary>{t('Hesap')}</summary>
      {body}
    </details>
  );
}
