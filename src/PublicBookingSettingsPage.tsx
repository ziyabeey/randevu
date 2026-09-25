import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from './i18n';
import type { FormEvent } from 'react';
import { api } from './api';
import { preparePublicMedia } from './publicMedia';

type Role = 'owner' | 'manager' | 'staff';
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
type PublicInformation = {
  business_id: string;
  kvkk_notice_text: string | null;
  kvkk_notice_url: string | null;
  privacy_policy_url: string | null;
  booking_terms_text: string | null;
  booking_terms_url: string | null;
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
  const [information, setInformation] = useState<PublicInformation | null>(null);
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
      const [settingsResult, profileResult, informationResult] = await Promise.all([
        api<SettingsPayload>('/api/public/settings'),
        api<ProfilePayload>('/api/public/profile'),
        api<{ information: PublicInformation }>('/api/public/profile/information'),
      ]);
      setData(settingsResult);
      setProfile(profileResult.profile);
      setInformation(informationResult.information);
      setEnabled(settingsResult.settings.enabled);
      setStepMinutes(settingsResult.settings.step_minutes);
      setMinNoticeMinutes(settingsResult.settings.min_notice_minutes);
      setHorizonDays(settingsResult.settings.horizon_days);
      setNotice('');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : t('Online randevu ayarları yüklenemedi.');
      setNotice(message);
      setData(null);
      setProfile(null);
      setInformation(null);
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
      setNotice(enabled ? t('Online randevu sayfası güncellendi ve aktif.') : t('Online randevu sayfası kapatıldı.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Ayarlar kaydedilemedi.'));
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
      setNotice(t('Salon profili kaydedildi.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Salon profili kaydedilemedi.'));
    } finally { setBusy(false); }
  }

  async function saveInformation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!information) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ information: PublicInformation }>('/api/public/profile/information', {
        method: 'PUT',
        body: JSON.stringify({
          kvkkNoticeText: String(form.get('kvkkNoticeText') ?? ''),
          kvkkNoticeUrl: String(form.get('kvkkNoticeUrl') ?? ''),
          privacyPolicyUrl: String(form.get('privacyPolicyUrl') ?? ''),
          bookingTermsText: String(form.get('bookingTermsText') ?? ''),
          bookingTermsUrl: String(form.get('bookingTermsUrl') ?? ''),
        }),
      });
      setInformation(result.information);
      setNotice(t('Rezervasyon bilgilendirmeleri kaydedildi.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Rezervasyon bilgilendirmeleri kaydedilemedi.'));
    } finally { setBusy(false); }
  }

  async function uploadMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('photo');
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setNotice(t('Fotoğraf hazırlanıyor…'));
    try {
      const prepared = await preparePublicMedia(file);
      await api(`/api/public/profile/media?alt=${encodeURIComponent(uploadAlt.trim())}`, {
        method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: prepared.blob,
      });
      setUploadAlt('');
      form.reset();
      const refreshed = await load();
      if (refreshed.ok) {
        setNotice(t('Fotoğraf eklendi.'));
      } else {
        setNotice(t('Yükleme sunucuda tamamlandı, ancak güncel salon durumu yeniden yüklenemedi. Tekrar yükleyin.'));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Fotoğraf yüklenemedi.'));
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
      setNotice(mediaId ? t('Kapak fotoğrafı güncellendi.') : t('Kapak fotoğrafı kaldırıldı.'));
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Kapak fotoğrafı güncellenemedi.')); }
    finally { setBusy(false); }
  }

  async function deleteMedia(mediaId: string) {
    setBusy(true);
    try {
      await api(`/api/public/profile/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
      const refreshed = await load();
      if (refreshed.ok) {
        setNotice(t('Fotoğraf silindi.'));
      } else {
        setNotice(t('Silme işlemi sunucuda tamamlandı, ancak güncel salon durumu yeniden yüklenemedi. Tekrar yükleyin.'));
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Fotoğraf silinemedi.')); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(publicUrl); setNotice(t('Rezervasyon bağlantısı panoya kopyalandı.')); }
    catch { setNotice(t('Bağlantı kopyalanamadı. Adresi seçip elle kopyalayabilirsiniz.')); }
  }

  if (loading) return <main className="public-settings-page"><section className="public-admin-card"><p>{t('Online randevu ayarları hazırlanıyor…')}</p></section></main>;
  if (!data || !profile || !information) return <main className="public-settings-page"><section className="public-admin-card"><h1>{t('Çalışma alanı açılamadı.')}</h1><p className="muted">{t('Aktif işletmeyi seçip tekrar deneyin.')}</p>{notice && <p className="public-inline-notice" role="status">{notice}</p>}<button type="button" className="public-primary" onClick={() => void load()}>{t('Tekrar yükle')}</button></section></main>;

  return <main className="public-settings-page">
    <header className="public-admin-hero"><div><p className="eyebrow">{t('ONLINE RANDEVU')}</p><h1>{t('Salon profiliniz ve randevu bağlantınız')}</h1><p className="muted">{data.business.name} · {data.business.timezone}</p></div><span className={`public-state ${enabled ? 'is-on' : 'is-off'}`}>{enabled ? t('Aktif') : t('Kapalı')}</span></header>
    {notice && <div className="public-page-notice" role="status">{notice}</div>}
    <section className="public-admin-grid">
      <article className="public-admin-card span-two"><div className="section-head"><h2>{t('Salon profili')}</h2><span>{t('Müşterilerin gördüğü bilgiler')}</span></div>
        <form className="public-settings-form public-profile-form" onSubmit={saveProfile}>
          <label><span>{t('Görünen salon adı')}</span><input name="publicName" defaultValue={profile.public_name} minLength={2} maxLength={120} disabled={!canManage || busy} /></label>
          <label><span>{t('Kısa açıklama')}</span><input name="shortDescription" defaultValue={profile.short_description ?? ''} maxLength={240} disabled={!canManage || busy} /></label>
          <label><span>{t('Salon hakkında')}</span><textarea name="longDescription" defaultValue={profile.long_description ?? ''} maxLength={2000} disabled={!canManage || busy} /></label>
          <div className="public-two-columns"><label><span>{t('Telefon')}</span><input name="publicPhone" defaultValue={profile.public_phone ?? ''} maxLength={40} disabled={!canManage || busy} /></label><label><span>{t('E-posta')}</span><input name="publicEmail" type="email" defaultValue={profile.public_email ?? ''} maxLength={254} disabled={!canManage || busy} /></label></div>
          <div className="public-two-columns"><label><span>{t('Web sitesi')}</span><input name="publicWebsite" type="url" placeholder={t('https://')} defaultValue={profile.public_website ?? ''} maxLength={500} disabled={!canManage || busy} /></label><label><span>{t('WhatsApp')}</span><input name="publicWhatsapp" defaultValue={profile.public_whatsapp ?? ''} maxLength={40} disabled={!canManage || busy} /></label></div>
          <label><span>{t('Adres')}</span><textarea name="addressText" defaultValue={profile.address_text ?? ''} maxLength={500} rows={3} disabled={!canManage || busy} /></label>
          <label className="public-toggle-row"><span><strong>{t('Çalışma saatlerini göster')}</strong><small>{t('Kurulumda tanımladığınız salon saatleri müşterilere görünür.')}</small></span><input name="showWorkHours" type="checkbox" defaultChecked={profile.show_work_hours} disabled={!canManage || busy} /></label>
          {canManage && <button className="public-primary" disabled={busy}>{t('Profili kaydet')}</button>}
        </form>
      </article>

      <article className="public-admin-card span-two">
        <div className="section-head"><h2>{t('Bilgilendirme ve koşullar')}</h2><span>{t('İşletmenin yayınladığı içerik')}</span></div>
        <p className="muted">{t('Randevu Kolay bu alanların metnini üretmez. İşletmenizin yayınlamayı onayladığı aydınlatma, gizlilik ve randevu koşullarını girin. Yeni müşteri rezervasyonu için aydınlatma metni veya HTTPS bağlantısı, HTTPS gizlilik bağlantısı ve randevu koşulları metni gerekir.')}</p>
        <form className="public-settings-form" onSubmit={saveInformation}>
          <label><span>{t('Aydınlatma / KVKK metni')} <small>{t('(metin veya bağlantı gerekli)')}</small></span><textarea name="kvkkNoticeText" defaultValue={information.kvkk_notice_text ?? ''} maxLength={12000} rows={8} disabled={!canManage || busy} /></label>
          <label><span>{t('Aydınlatma / KVKK bağlantısı')} <small>{t('(HTTPS)')}</small></span><input name="kvkkNoticeUrl" type="url" placeholder={t('https://')} defaultValue={information.kvkk_notice_url ?? ''} maxLength={1000} disabled={!canManage || busy} /></label>
          <label><span>{t('Gizlilik politikası bağlantısı')} <small>{t('(yayın için zorunlu, HTTPS)')}</small></span><input name="privacyPolicyUrl" type="url" placeholder={t('https://')} defaultValue={information.privacy_policy_url ?? ''} maxLength={1000} disabled={!canManage || busy} /></label>
          <label><span>{t('Randevu / iptal / değişiklik koşulları')} <small>{t('(yayın için zorunlu)')}</small></span><textarea name="bookingTermsText" defaultValue={information.booking_terms_text ?? ''} maxLength={8000} rows={7} disabled={!canManage || busy} /></label>
          <label><span>{t('Ayrıntılı randevu koşulları bağlantısı')} <small>{t('(isteğe bağlı, HTTPS)')}</small></span><input name="bookingTermsUrl" type="url" placeholder={t('https://')} defaultValue={information.booking_terms_url ?? ''} maxLength={1000} disabled={!canManage || busy} /></label>
          {canManage && <button className="public-primary" disabled={busy}>{t('Bilgilendirmeleri kaydet')}</button>}
        </form>
      </article>

      <article className="public-admin-card span-two"><div className="section-head"><h2>{t('Salon fotoğrafları')}</h2><span>{profile.media.length}/20</span></div><p className="muted">{t('JPG, PNG veya WebP seçin. Fotoğraf güvenli biçimde WebP\'ye hazırlanır; her yükleme en fazla 5 MB ve 2000 px uzun kenardır.')}</p>
        {profile.media.length ? <div className="public-media-admin-grid">{profile.media.map((media) => <div className="public-media-admin-item" key={media.id}><img src={`/api/public/profile/media/${media.id}/content`} alt={media.alt_text ?? t('{name} salon fotoğrafı', { name: profile.public_name })} /><div className="public-media-admin-actions"><button type="button" className={profile.cover_media_id === media.id ? 'is-cover' : ''} disabled={!canManage || busy} onClick={() => void setCover(media.id)}>{profile.cover_media_id === media.id ? t('Kapak fotoğrafı') : t('Kapak yap')}</button><button type="button" disabled={!canManage || busy} onClick={() => void deleteMedia(media.id)}>{t('Sil')}</button></div></div>)}</div> : <p className="public-muted">{t('Fotoğraf henüz eklenmedi. Müşteri sayfası bu durumda nötr bir yer tutucu gösterir.')}</p>}
        {canManage && profile.media.length < 20 && <form className="public-media-upload" onSubmit={uploadMedia}><label><span>{t('Fotoğraf')}</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy} /></label><label><span>{t('Fotoğraf açıklaması')}</span><input value={uploadAlt} onChange={(event) => setUploadAlt(event.target.value)} maxLength={160} placeholder={t('Örn. Salon giriş alanı')} disabled={busy} /></label><button className="public-primary" disabled={busy}>{busy ? t('İşleniyor…') : t('Fotoğraf ekle')}</button></form>}
      </article>

      <article className="public-admin-card"><div className="section-head"><h2>{t('Paylaşılabilir bağlantı')}</h2><span>{data.business.slug}</span></div><div className="public-link-box"><code>{publicUrl}</code><button type="button" onClick={() => void copyLink()}>{t('Kopyala')}</button></div>{enabled && <a className="public-preview-link" href={`/r/${data.business.slug}`} target="_blank" rel="noreferrer">{t('Müşteri görünümünü aç ↗')}</a>}</article>
      <article className="public-admin-card"><div className="section-head"><h2>{t('Rezervasyon kuralları')}</h2><span>{data.membership.role === 'staff' ? t('Çalışan') : data.membership.role === 'manager' ? t('Yönetici') : t('İşletme sahibi')}</span></div><form className="public-settings-form" onSubmit={saveSettings}><label className="public-toggle-row"><span><strong>{t('Online randevu sayfası')}</strong><small>{t('Kurulum eksikse yayın güvenli biçimde reddedilir.')}</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={!canManage || busy} /></label><label><span>{t('Slot adımı')}</span><select value={stepMinutes} onChange={(event) => setStepMinutes(Number(event.target.value))} disabled={!canManage || busy}><option value={5}>{t('5 dakika')}</option><option value={10}>{t('10 dakika')}</option><option value={15}>{t('15 dakika')}</option><option value={20}>{t('20 dakika')}</option><option value={30}>{t('30 dakika')}</option><option value={60}>{t('60 dakika')}</option></select></label><label><span>{t('Minimum önceden rezervasyon')}</span><div className="public-number-row"><input type="number" min={0} max={10080} value={minNoticeMinutes} onChange={(event) => setMinNoticeMinutes(Number(event.target.value))} disabled={!canManage || busy} /><small>{t('dakika')}</small></div></label><label><span>{t('İleri tarih ufku')}</span><div className="public-number-row"><input type="number" min={1} max={366} value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))} disabled={!canManage || busy} /><small>{t('gün')}</small></div></label>{canManage ? <button className="public-primary" disabled={busy}>{t('Ayarları kaydet')}</button> : <p className="muted">{t('Çalışanlar ayarları görebilir ancak değiştiremez.')}</p>}</form></article>
    </section>
  </main>;
}
