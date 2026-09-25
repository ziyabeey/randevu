import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import type { FormEvent } from 'react';
import { api } from './api';
import { preparePublicMedia } from './publicMedia';
import './private-media.css';

export type PrivatePhoto = {
  id: string;
  groupId: string;
  serviceId: string | null;
  serviceName: string | null;
  customerName: string | null;
  caption: string | null;
  width: number;
  height: number;
  createdAt: string;
  published: boolean;
  canDelete: boolean;
  canPublish: boolean;
  contentUrl: string;
};

type ServiceOption = { serviceId: string; serviceName: string };

const PHOTO_LIMIT = 10;

export function PrivatePhotoTile({ photo, busy, onDelete, onPublish }: {
  photo: PrivatePhoto;
  busy: boolean;
  onDelete: (photo: PrivatePhoto) => void;
  onPublish: (photo: PrivatePhoto, altText: string) => void;
}) {
  const [broken, setBroken] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [altText, setAltText] = useState(photo.caption ?? '');
  // A published photo never offers the publish confirmation again.
  useEffect(() => {
    if (!photo.published) return;
    setPublishing(false);
    setConsent(false);
  }, [photo.published]);
  const label = photo.caption || photo.serviceName || t('Randevu fotoğrafı');
  return <figure className="private-photo-tile">
    {broken
      ? <div className="private-photo-fallback" role="img" aria-label={t('Fotoğraf yüklenemedi')}><span>{t('Fotoğraf yüklenemedi')}</span></div>
      : <img src={photo.contentUrl} alt={label} loading="lazy" width={photo.width} height={photo.height} onError={() => setBroken(true)} />}
    <figcaption>
      <strong>{label}</strong>
      <span>{[photo.serviceName, photo.customerName].filter(Boolean).join(' · ') || t('Özel fotoğraf')}</span>
      {photo.published && <span className="private-photo-badge">{t('Salon galerisinde yayında')}</span>}
    </figcaption>
    <div className="private-photo-actions">
      {photo.canPublish && !photo.published && !publishing && <button type="button" disabled={busy} onClick={() => setPublishing(true)}>{t('Galeride yayınla')}</button>}
      {photo.canDelete && <button type="button" className="danger-button" disabled={busy} onClick={() => onDelete(photo)}>{t('Sil')}</button>}
    </div>
    {publishing && !photo.published && <div className="private-photo-publish">
      <label className="private-photo-consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>{t('Müşteriden bu fotoğrafın salon galerisinde yayınlanması için açık onay aldım.')}</span>
      </label>
      <label><span>{t('Galeri açıklaması')}</span><input value={altText} maxLength={160} onChange={(event) => setAltText(event.target.value)} /></label>
      <div className="private-photo-actions">
        <button type="button" disabled={busy || !consent} onClick={() => onPublish(photo, altText)}>{t('Onaylı yayınla')}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => { setPublishing(false); setConsent(false); }}>{t('Vazgeç')}</button>
      </div>
    </div>}
  </figure>;
}

export async function deletePrivatePhoto(photo: PrivatePhoto) {
  await api(`/api/private-media/${encodeURIComponent(photo.id)}`, { method: 'DELETE' });
}

export async function publishPrivatePhoto(photo: PrivatePhoto, altText: string) {
  await api(`/api/private-media/${encodeURIComponent(photo.id)}/publish`, {
    method: 'POST', body: JSON.stringify({ consentConfirmed: true, altText: altText.trim() || null }),
  });
}

export default function AppointmentPhotos({ groupId, services }: { groupId: string; services: ServiceOption[] }) {
  const [photos, setPhotos] = useState<PrivatePhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [caption, setCaption] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const token = ++generation.current;
    try {
      const result = await api<{ photos: PrivatePhoto[] }>(`/api/bookings/groups/${encodeURIComponent(groupId)}/photos`, { signal: current.signal });
      if (token !== generation.current) return false;
      setPhotos(result.photos);
      return true;
    } catch (error) {
      if (token !== generation.current || current.signal.aborted) return false;
      setPhotos((existing) => existing ?? []);
      setNotice(error instanceof Error ? error.message : t('Fotoğraflar yüklenemedi.'));
      return false;
    }
  }, [groupId]);

  useEffect(() => {
    setPhotos(null);
    setNotice('');
    setServiceId('');
    setCaption('');
    void load();
    return () => { controller.current?.abort(); generation.current += 1; };
  }, [load]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('photo');
    if (!(file instanceof File) || !file.size) {
      setNotice(t('Önce bir fotoğraf seçin.'));
      return;
    }
    setBusy(true);
    setNotice(t('Fotoğraf hazırlanıyor…'));
    try {
      const prepared = await preparePublicMedia(file);
      const params = new URLSearchParams();
      if (serviceId) params.set('serviceId', serviceId);
      if (caption.trim()) params.set('caption', caption.trim());
      const query = params.toString();
      await api(`/api/bookings/groups/${encodeURIComponent(groupId)}/photos${query ? `?${query}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: prepared.blob,
      });
      form.reset();
      setCaption('');
      setNotice((await load()) ? t('Fotoğraf eklendi.') : t('Fotoğraf eklendi, ancak liste yenilenemedi.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Fotoğraf yüklenemedi.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo: PrivatePhoto) {
    if (!window.confirm(t('Bu özel fotoğraf kalıcı olarak silinsin mi?'))) return;
    setBusy(true);
    try {
      await deletePrivatePhoto(photo);
      setNotice((await load()) ? t('Fotoğraf silindi.') : t('Fotoğraf silindi, ancak liste yenilenemedi.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Fotoğraf silinemedi.'));
    } finally {
      setBusy(false);
    }
  }

  async function publish(photo: PrivatePhoto, altText: string) {
    setBusy(true);
    try {
      await publishPrivatePhoto(photo, altText);
      setNotice((await load()) ? t('Fotoğraf salon galerisine eklendi.') : t('Fotoğraf yayınlandı, ancak liste yenilenemedi.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Fotoğraf yayınlanamadı.'));
    } finally {
      setBusy(false);
    }
  }

  const count = photos?.length ?? 0;
  return <section className="appointment-photos" aria-label={t('Randevu fotoğrafları')}>
    <div className="section-head"><h3>{t('Özel fotoğraflar')}</h3><span>{count}/{PHOTO_LIMIT}</span></div>
    <p className="muted">{t('Bu fotoğraflar yalnız işletme ekibine görünür; müşteri sayfasında yer almaz. Salon galerisine yalnız müşteri onayıyla ayrıca yayınlanabilir.')}</p>
    {photos === null ? <p className="muted">{t('Fotoğraflar yükleniyor…')}</p>
      : photos.length ? <div className="private-photo-grid">{photos.map((photo) => <PrivatePhotoTile key={photo.id} photo={photo} busy={busy} onDelete={(item) => void remove(item)} onPublish={(item, alt) => void publish(item, alt)} />)}</div>
        : <p className="empty">{t('Bu randevuya henüz fotoğraf eklenmedi.')}</p>}
    {photos !== null && count < PHOTO_LIMIT && <form className="private-photo-upload" onSubmit={(event) => void upload(event)}>
      <label><span>{t('Fotoğraf')}</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} /></label>
      {services.length > 0 && <label><span>{t('Hizmet')} <small>{t('(isteğe bağlı)')}</small></span><select value={serviceId} disabled={busy} onChange={(event) => setServiceId(event.target.value)}>
        <option value="">{t('Hizmet seçilmedi')}</option>
        {services.map((service) => <option key={service.serviceId} value={service.serviceId}>{service.serviceName}</option>)}
      </select></label>}
      <label><span>{t('Açıklama')} <small>{t('(isteğe bağlı)')}</small></span><input value={caption} maxLength={240} disabled={busy} onChange={(event) => setCaption(event.target.value)} placeholder={t('Örn. işlem sonrası')} /></label>
      <button disabled={busy}>{busy ? t('İşleniyor…') : t('Fotoğraf ekle')}</button>
    </form>}
    {photos !== null && count >= PHOTO_LIMIT && <p className="muted">{t('Bir randevuya en fazla {PHOTO_LIMIT} fotoğraf eklenebilir. Yeni fotoğraf için önce birini silin.', { PHOTO_LIMIT: PHOTO_LIMIT })}</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
  </section>;
}
