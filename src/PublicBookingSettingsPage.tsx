import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';
import { preparePublicMedia } from './publicMedia';
import type { Role } from '../shared/types.ts';
import { getErrorMessage } from './errors.ts';

type PublicSettings = {
  business_id: string;
  enabled: boolean;
  step_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
};
type PublicMedia = {
  id: string;
  alt_text: string | null;
  sort_order: number;
  width: number;
  height: number;
};
type PublicProfile = {
  business_id: string;
  public_name: string;
  short_description: string | null;
  long_description: string | null;
  public_phone: string | null;
  public_email: string | null;
  public_website: string | null;
  public_whatsapp: string | null;
  address_text: string | null;
  show_work_hours: boolean;
  cover_media_id: string | null;
  media: PublicMedia[];
};
type SettingsPayload = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  business: { id: string; name: string; slug: string; timezone: string };
  settings: PublicSettings;
};
type ProfilePayload = { membership: SettingsPayload['membership']; profile: PublicProfile };
type LoadResult = { ok: true } | { ok: false; message: string };

function profileBody(profile: PublicProfile, coverMediaId = profile.cover_media_id) {
  return {
    publicName: profile.public_name,
    shortDescription: profile.short_description,
    longDescription: profile.long_description,
    publicPhone: profile.public_phone,
    publicEmail: profile.public_email,
    publicWebsite: profile.public_website,
    publicWhatsapp: profile.public_whatsapp,
    addressText: profile.address_text,
    showWorkHours: profile.show_work_hours,
    coverMediaId,
  };
}

export default function PublicBookingSettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [stepMinutes, setStepMinutes] = useState(15);
  const [minNoticeMinutes, setMinNoticeMinutes] = useState(60);
  const [horizonDays, setHorizonDays] = useState(60);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [uploadAlt, setUploadAlt] = useState('');

  const load = useCallback(async (): Promise<LoadResult> => {
    setLoading(true);
    try {
      const [settingsResult, profileResult] = await Promise.all([
        api<SettingsPayload>('/api/public/settings'),
        api<ProfilePayload>('/api/public/profile'),
      ]);
      setData(settingsResult);
      setProfile(profileResult.profile);
      setEnabled(settingsResult.settings.enabled);
      setStepMinutes(settingsResult.settings.step_minutes);
      setMinNoticeMinutes(settingsResult.settings.min_notice_minutes);
      setHorizonDays(settingsResult.settings.horizon_days);
      setNotice('');
      return { ok: true };
    } catch (error) {
      const message = getErrorMessage(error, 'Online randevu ayarları yüklenemedi.');
      setNotice(message);
      setData(null);
      setProfile(null);
      return { ok: false, message };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canManage = data?.membership.role === 'owner' || data?.membership.role === 'manager';
  const publicUrl = useMemo(() => data?.business.slug ? `${window.location.origin}/r/${data.business.slug}` : '', [data]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ settings: PublicSettings }>('/api/public/settings', {
        method: 'PUT', body: JSON.stringify({ enabled, stepMinutes, minNoticeMinutes, horizonDays }),
      });
      setData((current) => current ? { ...current, settings: result.settings } : current);
      setNotice(enabled ? 'Online randevu sayfası güncellendi ve aktif.' : 'Online randevu sayfası kapatıldı.');
    } catch (error) {
      setNotice(getErrorMessage(error, 'Ayarlar kaydedilemedi.'));
    } finally { setBusy(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ profile: PublicProfile }>('/api/public/profile', {
        method: 'PUT',
        body: JSON.stringify({
          publicName: String(form.get('publicName') ?? ''),
          shortDescription: String(form.get('shortDescription') ?? ''),
          longDescription: String(form.get('longDescription') ?? ''),
          publicPhone: String(form.get('publicPhone') ?? ''),
          publicEmail: String(form.get('publicEmail') ?? ''),
          publicWebsite: String(form.get('publicWebsite') ?? ''),
          publicWhatsapp: String(form.get('publicWhatsapp') ?? ''),
          addressText: String(form.get('addressText') ?? ''),
          showWorkHours: form.get('showWorkHours') === 'on',
          coverMediaId: profile.cover_media_id,
        }),
      });
      setProfile(result.profile);
      setNotice('Salon profili kaydedildi.');
    } catch (error) {
      setNotice(getErrorMessage(error, 'Salon profili kaydedilemedi.'));
    } finally { setBusy(false); }
  }

  async function uploadMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('photo');
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setNotice('Fotoğraf hazırlanıyor…');
    try {
      const prepared = await preparePublicMedia(file);
      await api(`/api/public/profile/media?alt=${encodeURIComponent(uploadAlt.trim())}`, {
        method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: prepared.blob,
      });
      setUploadAlt('');
      form.reset();
      const refreshed = await load();
      if (refreshed.ok) {
        setNotice('Fotoğraf eklendi.');
      } else {
        setNotice('Yükleme sunucuda tamamlandı, ancak güncel salon durumu yeniden yüklenemedi. Tekrar yükleyin.');
      }
    } catch (error) {
      setNotice(getErrorMessage(error, 'Fotoğraf yüklenemedi.'));
    } finally { setBusy(false); }
  }

  async function setCover(mediaId: string | null) {
    if (!profile) return;
    setBusy(true);
    try {
      const result = await api<{ profile: PublicProfile }>('/api/public/profile', {
        method: 'PUT', body: JSON.stringify(profileBody(profile, mediaId)),
      });
      setProfile(result.profile);
      setNotice(mediaId ? 'Kapak fotoğrafı güncellendi.' : 'Kapak fotoğrafı kaldırıldı.');
    } catch (error) { setNotice(getErrorMessage(error, 'Kapak fotoğrafı güncellenemedi.')); }
    finally { setBusy(false); }
  }

  async function deleteMedia(mediaId: string) {
    setBusy(true);
    try {
      await api(`/api/public/profile/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
      const refreshed = await load();
      if (refreshed.ok) {
        setNotice('Fotoğraf silindi.');
      } else {
        setNotice('Silme işlemi sunucuda tamamlandı, ancak güncel salon durumu yeniden yüklenemedi. Tekrar yükleyin.');
      }
    } catch (error) { setNotice(getErrorMessage(error, 'Fotoğraf silinemedi.')); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(publicUrl); setNotice('Rezervasyon bağlantısı panoya kopyalandı.'); }
    catch { setNotice('Bağlantı kopyalanamadı. Adresi seçip elle kopyalayabilirsiniz.'); }
  }

  if (loading) return <main className="public-settings-page"><section className="public-admin-card"><p>Online randevu ayarları hazırlanıyor…</p></section></main>;
  if (!data || !profile) return <main className="public-settings-page"><section className="public-admin-card"><h1>Çalışma alanı açılamadı.</h1><p className="muted">Aktif işletmeyi seçip tekrar deneyin.</p>{notice && <p className="public-inline-notice" role="status">{notice}</p>}<button type="button" className="public-primary" onClick={() => void load()}>Tekrar yükle</button></section></main>;

  return <main className="public-settings-page">
    <header className="public-admin-hero"><div><p className="eyebrow">ONLINE RANDEVU</p><h1>Salon profiliniz ve randevu bağlantınız</h1><p className="muted">{data.business.name} · {data.business.timezone}</p></div><span className={`public-state ${enabled ? 'is-on' : 'is-off'}`}>{enabled ? 'Aktif' : 'Kapalı'}</span></header>
    {notice && <div className="public-page-notice" role="status">{notice}</div>}
    <section className="public-admin-grid">
      <article className="public-admin-card span-two"><div className="section-head"><h2>Salon profili</h2><span>Müşterilerin gördüğü bilgiler</span></div>
        <form className="public-settings-form public-profile-form" onSubmit={saveProfile}>
          <label><span>Görünen salon adı</span><input name="publicName" defaultValue={profile.public_name} minLength={2} maxLength={120} disabled={!canManage || busy} /></label>
          <label><span>Kısa açıklama</span><input name="shortDescription" defaultValue={profile.short_description ?? ''} maxLength={240} disabled={!canManage || busy} /></label>
          <label><span>Salon hakkında</span><textarea name="longDescription" defaultValue={profile.long_description ?? ''} maxLength={2000} disabled={!canManage || busy} /></label>
          <div className="public-two-columns"><label><span>Telefon</span><input name="publicPhone" defaultValue={profile.public_phone ?? ''} maxLength={40} disabled={!canManage || busy} /></label><label><span>E-posta</span><input name="publicEmail" type="email" defaultValue={profile.public_email ?? ''} maxLength={254} disabled={!canManage || busy} /></label></div>
          <div className="public-two-columns"><label><span>Web sitesi</span><input name="publicWebsite" type="url" placeholder="https://" defaultValue={profile.public_website ?? ''} maxLength={500} disabled={!canManage || busy} /></label><label><span>WhatsApp</span><input name="publicWhatsapp" defaultValue={profile.public_whatsapp ?? ''} maxLength={40} disabled={!canManage || busy} /></label></div>
          <label><span>Adres</span><textarea name="addressText" defaultValue={profile.address_text ?? ''} maxLength={500} rows={3} disabled={!canManage || busy} /></label>
          <label className="public-toggle-row"><span><strong>Çalışma saatlerini göster</strong><small>Kurulumda tanımladığınız salon saatleri müşterilere görünür.</small></span><input name="showWorkHours" type="checkbox" defaultChecked={profile.show_work_hours} disabled={!canManage || busy} /></label>
          {canManage && <button className="public-primary" disabled={busy}>Profili kaydet</button>}
        </form>
      </article>

      <article className="public-admin-card span-two"><div className="section-head"><h2>Salon fotoğrafları</h2><span>{profile.media.length}/20</span></div><p className="muted">JPG, PNG veya WebP seçin. Fotoğraf güvenli biçimde WebP'ye hazırlanır; her yükleme en fazla 5 MB ve 2000 px uzun kenardır.</p>
        {profile.media.length ? <div className="public-media-admin-grid">{profile.media.map((media) => <div className="public-media-admin-item" key={media.id}><img src={`/api/public/profile/media/${media.id}/content`} alt={media.alt_text ?? `${profile.public_name} salon fotoğrafı`} /><div className="public-media-admin-actions"><button type="button" className={profile.cover_media_id === media.id ? 'is-cover' : ''} disabled={!canManage || busy} onClick={() => void setCover(media.id)}>{profile.cover_media_id === media.id ? 'Kapak fotoğrafı' : 'Kapak yap'}</button><button type="button" disabled={!canManage || busy} onClick={() => void deleteMedia(media.id)}>Sil</button></div></div>)}</div> : <p className="public-muted">Fotoğraf henüz eklenmedi. Müşteri sayfası bu durumda nötr bir yer tutucu gösterir.</p>}
        {canManage && profile.media.length < 20 && <form className="public-media-upload" onSubmit={uploadMedia}><label><span>Fotoğraf</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy} /></label><label><span>Fotoğraf açıklaması</span><input value={uploadAlt} onChange={(event) => setUploadAlt(event.target.value)} maxLength={160} placeholder="Örn. Salon giriş alanı" disabled={busy} /></label><button className="public-primary" disabled={busy}>{busy ? 'İşleniyor…' : 'Fotoğraf ekle'}</button></form>}
      </article>

      <article className="public-admin-card"><div className="section-head"><h2>Paylaşılabilir bağlantı</h2><span>{data.business.slug}</span></div><div className="public-link-box"><code>{publicUrl}</code><button type="button" onClick={() => void copyLink()}>Kopyala</button></div>{enabled && <a className="public-preview-link" href={`/r/${data.business.slug}`} target="_blank" rel="noreferrer">Müşteri görünümünü aç ↗</a>}</article>
      <article className="public-admin-card"><div className="section-head"><h2>Rezervasyon kuralları</h2><span>{data.membership.role === 'staff' ? 'Çalışan' : data.membership.role === 'manager' ? 'Yönetici' : 'İşletme sahibi'}</span></div><form className="public-settings-form" onSubmit={saveSettings}><label className="public-toggle-row"><span><strong>Online randevu sayfası</strong><small>Kurulum eksikse yayın güvenli biçimde reddedilir.</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={!canManage || busy} /></label><label><span>Slot adımı</span><select value={stepMinutes} onChange={(event) => setStepMinutes(Number(event.target.value))} disabled={!canManage || busy}><option value={5}>5 dakika</option><option value={10}>10 dakika</option><option value={15}>15 dakika</option><option value={20}>20 dakika</option><option value={30}>30 dakika</option><option value={60}>60 dakika</option></select></label><label><span>Minimum önceden rezervasyon</span><div className="public-number-row"><input type="number" min={0} max={10080} value={minNoticeMinutes} onChange={(event) => setMinNoticeMinutes(Number(event.target.value))} disabled={!canManage || busy} /><small>dakika</small></div></label><label><span>İleri tarih ufku</span><div className="public-number-row"><input type="number" min={1} max={366} value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))} disabled={!canManage || busy} /><small>gün</small></div></label>{canManage ? <button className="public-primary" disabled={busy}>Ayarları kaydet</button> : <p className="muted">Çalışanlar ayarları görebilir ancak değiştiremez.</p>}</form></article>
    </section>
  </main>;
}
