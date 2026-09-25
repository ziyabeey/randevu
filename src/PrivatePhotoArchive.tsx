import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import { api } from './api';
import { PrivatePhotoTile, deletePrivatePhoto, publishPrivatePhoto, type PrivatePhoto } from './AppointmentPhotos';
import './private-media.css';

type Cursor = { beforeCreatedAt: string; beforeId: string } | null;
type ArchivePage = { photos: PrivatePhoto[]; next: Cursor };

// F16-03 business service-photo archive: every private appointment photo of the
// active business, newest first, optionally narrowed to one service.
export default function PrivatePhotoArchive({ services, businessId }: {
  services: Array<{ id: string; name: string }>;
  businessId: string;
}) {
  const [serviceId, setServiceId] = useState('');
  const [photos, setPhotos] = useState<PrivatePhoto[] | null>(null);
  const [next, setNext] = useState<Cursor>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);

  const fetchPage = useCallback(async (cursor: Cursor, append: boolean) => {
    const token = ++generation.current;
    const params = new URLSearchParams({ limit: '24' });
    if (serviceId) params.set('serviceId', serviceId);
    if (cursor) { params.set('beforeCreatedAt', cursor.beforeCreatedAt); params.set('beforeId', cursor.beforeId); }
    try {
      const page = await api<ArchivePage>(`/api/private-media?${params}`);
      if (token !== generation.current) return;
      setPhotos((existing) => (append && existing ? [...existing, ...page.photos.filter((item) => !existing.some((seen) => seen.id === item.id))] : page.photos));
      setNext(page.next);
      setNotice('');
    } catch (error) {
      if (token !== generation.current) return;
      setPhotos((existing) => existing ?? []);
      setNotice(error instanceof Error ? error.message : t('Fotoğraf arşivi yüklenemedi.'));
    }
  }, [serviceId]);

  useEffect(() => {
    setPhotos(null);
    setNext(null);
    void fetchPage(null, false);
    return () => { generation.current += 1; };
  }, [fetchPage, businessId]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await fetchPage(null, false);
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Fotoğraf işlemi tamamlanamadı.'));
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel span-two private-photo-archive" aria-label={t('Hizmet fotoğraf arşivi')}>
    <div className="section-head"><h2>{t('Hizmet fotoğraf arşivi')}</h2><span>{photos?.length ?? 0}{next ? '+' : ''}</span></div>
    <p className="muted">{t('Randevulara eklenen özel fotoğraflar. Müşteri sayfasında görünmezler; yalnız müşteri onayıyla salon galerisine ayrıca yayınlanabilirler.')}</p>
    <div className="private-photo-archive-filter">
      <label><span>{t('Hizmet')}</span><select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
        <option value="">{t('Tüm hizmetler')}</option>
        {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
      </select></label>
    </div>
    {photos === null ? <p className="muted">{t('Arşiv yükleniyor…')}</p>
      : photos.length ? <div className="private-photo-grid">{photos.map((photo) => <PrivatePhotoTile
        key={photo.id}
        photo={photo}
        busy={busy}
        onDelete={(item) => { if (window.confirm(t('Bu özel fotoğraf kalıcı olarak silinsin mi?'))) void run(() => deletePrivatePhoto(item), t('Fotoğraf silindi.')); }}
        onPublish={(item, alt) => void run(() => publishPrivatePhoto(item, alt), t('Fotoğraf salon galerisine eklendi.'))}
      />)}</div>
        : <p className="empty">{serviceId ? t('Bu hizmet için henüz fotoğraf yok.') : t('Henüz özel fotoğraf eklenmedi. Randevu detayındaki Fotoğraf sekmesinden ekleyebilirsiniz.')}</p>}
    {next && <button type="button" className="secondary-button load-more" disabled={busy} onClick={() => void fetchPage(next, true)}>{t('Daha fazla fotoğraf')}</button>}
    {notice && <p className="muted" role="status">{notice}</p>}
  </section>;
}
