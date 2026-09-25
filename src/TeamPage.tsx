import { useCallback, useEffect, useState } from 'react';
import { intlLocale, t } from './i18n';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from './api';

type Role = 'owner' | 'manager' | 'staff';
type PermissionKey =
  | 'payments_write'
  | 'pricing_adjustments_write'
  | 'financial_reports_read'
  | 'inventory_write'
  | 'expenses_write';

type TeamMember = {
  id: string;
  displayName: string | null;
  email: string | null;
  role: Role;
  active: boolean;
};

type StaffProfile = {
  id: string;
  membershipId: string | null;
  name: string;
  active: boolean;
};

type Invitation = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
};

type FinancialGrant = { membershipId: string; permission: PermissionKey };

type TeamSnapshot = {
  actor: { membershipId: string; role: Role };
  members: TeamMember[];
  staff: StaffProfile[];
  invitations: Invitation[];
  financialPermissions: FinancialGrant[];
  effectiveFinancialPermissions: PermissionKey[];
};

const PERMISSIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: 'payments_write', label: 'Tahsilat işlemleri' },
  { key: 'pricing_adjustments_write', label: 'Fiyat / iskonto / iade düzeltmesi' },
  { key: 'financial_reports_read', label: 'Mali raporları görme' },
  { key: 'inventory_write', label: 'Stok yazımı' },
  { key: 'expenses_write', label: 'Masraf yazımı' },
];

function roleLabel(role: Role) {
  if (role === 'owner') return t('İşletme sahibi');
  if (role === 'manager') return t('Yönetici');
  return 'Çalışan';
}

function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? t('Bilinmiyor')
    : new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function isRetryableApiError(error: unknown) {
  return error instanceof ApiRequestError
    && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}

export default function TeamPage() {
  const [team, setTeam] = useState<TeamSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [authorityStale, setAuthorityStale] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ team: TeamSnapshot }>('/api/team');
      setTeam(result.team);
      setAuthorityStale(false);
    } catch (error) {
      if (!isRetryableApiError(error)) setTeam(null);
      setNotice(error instanceof Error ? error.message : t('Ekip bilgileri alınamadı.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refreshAuthorityAfterForbidden(error: unknown) {
    if (!(error instanceof ApiRequestError) || error.status !== 403) return;
    setAuthorityStale(true);
    await load();
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice('');
    try {
      await action();
      setNotice(success);
      await load();
    } catch (error) {
      await refreshAuthorityAfterForbidden(error);
      setNotice(error instanceof Error ? error.message : t('İşlem tamamlanamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setNotice('');
    setInviteUrl('');
    try {
      const result = await api<{ inviteUrl: string }>('/api/team/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), role: data.get('role') }),
      });
      form.reset();
      setInviteUrl(result.inviteUrl);
      setNotice(t('Davet oluşturuldu. Bağlantı yalnız bu yanıtta gösterilir; şimdi güvenli biçimde paylaşın.'));
      await load();
    } catch (error) {
      await refreshAuthorityAfterForbidden(error);
      setNotice(error instanceof Error ? error.message : t('Davet oluşturulamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice(t('Davet bağlantısı panoya kopyalandı.'));
    } catch {
      setNotice(t('Otomatik kopyalama kullanılamadı. Bağlantıyı seçip elle kopyalayın.'));
    }
  }

  if (loading) return <main className="center-card"><p>{t('Ekip erişimi doğrulanıyor…')}</p></main>;

  if (!team) {
    return (
      <main className="center-card">
        <h1>{t('Ekip alanı açılamadı')}</h1>
        {notice && <div className="notice" role="status">{notice}</div>}
        <p className="muted">{t('Giriş yapın ve erişiminiz olan bir işletme seçin.')}</p>
        <a className="primary-link" href="/">{t('Çalışma alanına dön')}</a>
      </main>
    );
  }

  const canManage = !authorityStale && (team.actor.role === 'owner' || team.actor.role === 'manager');
  const isOwner = !authorityStale && team.actor.role === 'owner';
  const activeMembers = team.members.filter((member) => member.active);

  return (
    <main className="workspace team-workspace">
      <section className="panel span-two">
        <div className="section-head">
          <div>
            <p className="eyebrow">{t('EKİP VE ERİŞİM')}</p>
            <h1>{t('Hesap erişimi ile operasyon ekibini ayırın')}</h1>
          </div>
          <span className="role-badge">{roleLabel(team.actor.role)}</span>
        </div>
        <p className="muted">{t('Hesap üyeliği uygulamaya giriş yetkisidir. Operasyon personeli ise randevu takviminde çalışan kişidir. İkisini yalnız gerektiğinde birbirine bağlayın.')}</p>
        {notice && <div className="notice" role="status">{notice}</div>}
      </section>

      <div className="dashboard-grid team-grid">
        <section className="panel">
          <div className="section-head"><h2>{t('Hesap üyeleri')}</h2><span>{team.members.length}</span></div>
          <div className="team-stack">
            {team.members.map((member) => {
              const managerLocked = team.actor.role === 'manager' && member.role === 'owner';
              const editable = canManage && !managerLocked;
              return (
                <article className="team-card" key={member.id}>
                  <div className="team-card-head">
                    <div>
                      <strong>{member.displayName || member.email || t('Ekip üyesi')}</strong>
                      {member.email && <span>{member.email}</span>}
                    </div>
                    <span className={member.active ? 'status-pill active' : 'status-pill'}>{member.active ? t('Aktif') : t('Pasif')}</span>
                  </div>
                  <div className="team-controls">
                    <label>
                      Rol
                      <select
                        value={member.role}
                        disabled={busy || !editable}
                        onChange={(event) => void run(
                          () => api(`/api/team/members/${member.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ role: event.target.value, active: member.active }),
                          }),
                          t('Üyelik rolü güncellendi.'),
                        )}
                      >
                        <option value="owner" disabled={!isOwner}>{t('İşletme sahibi')}</option>
                        <option value="manager">{t('Yönetici')}</option>
                        <option value="staff">{t('Çalışan')}</option>
                      </select>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={member.active}
                        disabled={busy || !editable}
                        onChange={(event) => void run(
                          () => api(`/api/team/members/${member.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ role: member.role, active: event.target.checked }),
                          }),
                          event.target.checked ? t('Üyelik etkinleştirildi.') : t('Üyelik pasifleştirildi.'),
                        )}
                      />
                      {t('Uygulamaya erişebilir')}
                    </label>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="section-head"><h2>{t('Operasyon personeli')}</h2><span>{team.staff.length}</span></div>
          {team.staff.length === 0 ? <p className="empty">{t('Henüz operasyon personeli yok.')}</p> : (
            <div className="team-stack">
              {team.staff.map((person) => (
                <article className="team-card" key={person.id}>
                  <div className="team-card-head">
                    <div><strong>{person.name}</strong><span>{person.active ? t('Randevu operasyonunda aktif') : t('Operasyonda pasif')}</span></div>
                  </div>
                  <label>
                    {t('Giriş hesabı bağlantısı')}
                    <select
                      value={person.membershipId ?? ''}
                      disabled={busy || !canManage}
                      onChange={(event) => void run(
                        () => api(`/api/team/staff/${person.id}/membership`, {
                          method: 'PUT',
                          body: JSON.stringify({ membershipId: event.target.value || null }),
                        }),
                        t('Personel-hesap bağlantısı güncellendi.'),
                      )}
                    >
                      <option value="">{t('Bağlantı yok')}</option>
                      {activeMembers.map((member) => (
                        <option key={member.id} value={member.id}>{member.displayName || member.email || roleLabel(member.role)}</option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
            </div>
          )}
        </section>

        {canManage && (
          <section className="panel span-two">
            <div className="section-head"><h2>{t('Davetler')}</h2><span>{t('{length} bekliyor', { length: team.invitations.length })}</span></div>
            <form className="team-invite-form" onSubmit={createInvitation}>
              <input name="email" type="email" required placeholder={t('calisan@isletme.com')} aria-label={t('Davet e-postası')} />
              <select name="role" defaultValue="staff" aria-label={t('Davet rolü')}>
                <option value="staff">{t('Çalışan')}</option>
                <option value="manager">{t('Yönetici')}</option>
                {isOwner && <option value="owner">{t('İşletme sahibi')}</option>}
              </select>
              <button className="primary-button" disabled={busy}>{t('Davet oluştur')}</button>
            </form>
            {inviteUrl && (
              <div className="invite-receipt">
                <label>{t('Tek seferlik paylaşım bağlantısı')}<input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /></label>
                <button className="ghost-button" type="button" onClick={() => void copyInvite()}>{t('Kopyala')}</button>
              </div>
            )}
            {team.invitations.length === 0 ? <p className="empty">{t('Bekleyen davet yok.')}</p> : (
              <ul className="data-list team-invitations">
                {team.invitations.map((invitation) => (
                  <li key={invitation.id}>
                    <div><strong>{invitation.email}</strong><span>{t('{role} · {expiresAt} tarihine kadar', { role: roleLabel(invitation.role), expiresAt: dateLabel(invitation.expiresAt) })}</span></div>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(
                        () => api(`/api/team/invitations/${invitation.id}/revoke`, { method: 'POST', body: '{}' }),
                        t('Davet geri alındı.'),
                      )}
                    >{t('Geri al')}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="panel span-two">
          <div className="section-head"><h2>{t('Mali izinler')}</h2><span>{isOwner ? t('Owner yönetir') : t('Etkin izinler')}</span></div>
          {isOwner ? (
            <div className="permission-table">
              {team.members.filter((member) => member.role === 'staff').map((member) => (
                <article className="permission-row" key={member.id}>
                  <strong>{member.displayName || member.email || t('Çalışan')}</strong>
                  <div className="permission-chips">
                    {PERMISSIONS.map((permission) => {
                      const enabled = team.financialPermissions.some((grant) => grant.membershipId === member.id && grant.permission === permission.key);
                      return (
                        <label className={`chip ${enabled ? 'selected' : ''}`} key={permission.key}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={busy || !member.active}
                            onChange={(event) => void run(
                              () => api(`/api/team/members/${member.id}/financial-permissions/${permission.key}`, {
                                method: 'PUT',
                                body: JSON.stringify({ enabled: event.target.checked }),
                              }),
                              t('Mali izin güncellendi.'),
                            )}
                          />
                          {t(permission.label)}
                        </label>
                      );
                    })}
                  </div>
                </article>
              ))}
              {team.members.every((member) => member.role !== 'staff') && <p className="empty">{t('Mali izin verilebilecek aktif staff hesabı yok.')}</p>}
            </div>
          ) : team.effectiveFinancialPermissions.length > 0 ? (
            <div className="permission-chips">
              {PERMISSIONS.filter((permission) => team.effectiveFinancialPermissions.includes(permission.key)).map((permission) => (
                <span className="chip selected" key={permission.key}>{t(permission.label)}</span>
              ))}
            </div>
          ) : (
            <p className="empty">{t('Bu hesap için açık mali izin yok.')}</p>
          )}
          {!isOwner && team.actor.role === 'manager' && <p className="muted team-note">{t('Yöneticiler operasyonu yönetebilir ancak owner adına mali izin dağıtamaz.')}</p>}
        </section>
      </div>
    </main>
  );
}
