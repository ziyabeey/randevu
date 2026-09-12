import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';

type Role = 'owner' | 'manager' | 'staff';
type PublicSettings = {
  business_id: string;
  enabled: boolean;
  step_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
};
type SettingsPayload = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  business: { id: string; name: string; slug: string; timezone: string };
  settings: PublicSettings;
};

export default function PublicBookingSettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [stepMinutes, setStepMinutes] = useState(15);
  const [minNoticeMinutes, setMinNoticeMinutes] = useState(60);
  const [horizonDays, setHorizonDays] = useState(60);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api<SettingsPayload>('/api/public/settings');
      setData(next);
      setEnabled(next.settings.enabled);
      setStepMinutes(next.settings.step_minutes);
      setMinNoticeMinutes(next.settings.min_notice_minutes);
      setHorizonDays(next.settings.horizon_days);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Public rezervasyon ayarları yüklenemedi.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canManage = data?.membership.role === 'owner' || data?.membership.role === 'manager';
  const publicUrl = useMemo(() => {
    if (!data?.business.slug) return '';
    return `${window.location.origin}/r/${data.business.slug}`;
  }, [data]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ settings: PublicSettings }>('/api/public/settings', {
        method: 'PUT',
        body: JSON.stringify({ enabled, stepMinutes, minNoticeMinutes, horizonDays }),
      });
      setData((current) => current ? { ...current, settings: result.settings } : current);
      setNotice(enabled ? 'Public rezervasyon sayfası güncellendi ve aktif.' : 'Public rezervasyon sayfası kapatıldı.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ayarlar kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice('Rezervasyon bağlantısı panoya kopyalandı.');
    } catch {
      setNotice('Bağlantı kopyalanamadı. Adresi seçip elle kopyalayabilirsiniz.');
    }
  }

  if (loading) {
    return <main className="public-settings-page"><section className="public-admin-card"><p>Public rezervasyon ayarları hazırlanıyor…</p></section></main>;
  }

  if (!data) {
    return (
      <main className="public-settings-page">
        <section className="public-admin-card">
          <p className="eyebrow">PUBLIC BOOKING</p>
          <h1>Önce çalışma alanına giriş yapın.</h1>
          <p className="muted">Aktif işletme seçildikten sonra müşteri rezervasyon bağlantısını buradan yönetebilirsiniz.</p>
          <a className="primary-link" href="/">Çalışma alanına dön</a>
          {notice && <p className="public-inline-notice">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="public-settings-page">
      <header className="public-admin-hero">
        <div>
          <p className="eyebrow">FAZ 6 · PUBLIC BOOKING</p>
          <h1>Müşterinin kendi randevusunu alacağı bağlantı</h1>
          <p className="muted">{data.business.name} · {data.business.timezone}</p>
        </div>
        <span className={`public-state ${enabled ? 'is-on' : 'is-off'}`}>{enabled ? 'Aktif' : 'Kapalı'}</span>
      </header>

      {notice && <div className="public-page-notice" role="status">{notice}</div>}

      <section className="public-admin-grid">
        <article className="public-admin-card">
          <div className="section-head"><h2>Paylaşılabilir bağlantı</h2><span>{data.business.slug}</span></div>
          <p className="muted">Sayfa yalnızca aşağıdaki “Aktif” anahtarı açıkken müşterilere görünür.</p>
          <div className="public-link-box">
            <code>{publicUrl}</code>
            <button type="button" onClick={() => void copyLink()}>Kopyala</button>
          </div>
          {enabled && <a className="public-preview-link" href={`/r/${data.business.slug}`} target="_blank" rel="noreferrer">Müşteri görünümünü aç ↗</a>}
        </article>

        <article className="public-admin-card">
          <div className="section-head"><h2>Rezervasyon kuralları</h2><span>{data.membership.role}</span></div>
          <form className="public-settings-form" onSubmit={save}>
            <label className="public-toggle-row">
              <span><strong>Public sayfa</strong><small>Müşteriler bu linkten boş saatları görüp randevu oluşturabilir.</small></span>
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={!canManage || busy} />
            </label>

            <label>
              <span>Slot adımı</span>
              <select value={stepMinutes} onChange={(event) => setStepMinutes(Number(event.target.value))} disabled={!canManage || busy}>
                <option value={5}>5 dakika</option>
                <option value={10}>10 dakika</option>
                <option value={15}>15 dakika</option>
                <option value={20}>20 dakika</option>
                <option value={30}>30 dakika</option>
                <option value={60}>60 dakika</option>
              </select>
            </label>

            <label>
              <span>Minimum önceden rezervasyon</span>
              <div className="public-number-row"><input type="number" min={0} max={10080} value={minNoticeMinutes} onChange={(event) => setMinNoticeMinutes(Number(event.target.value))} disabled={!canManage || busy} /><small>dakika</small></div>
            </label>

            <label>
              <span>İleri tarih ufku</span>
              <div className="public-number-row"><input type="number" min={1} max={366} value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))} disabled={!canManage || busy} /><small>gün</small></div>
            </label>

            {canManage ? <button className="public-primary" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Ayarları kaydet'}</button> : <p className="muted">Staff rolü ayarları görebilir ancak değiştiremez.</p>}
          </form>
        </article>
      </section>
    </main>
  );
}
