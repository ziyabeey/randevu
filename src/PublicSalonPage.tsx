import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, api } from './api';
import PublicBookingPage from './PublicBookingPage';
import PublicMultiServiceSelection from './PublicMultiServiceSelection';
import type { PublicMultiServiceSelectionState } from './PublicMultiServiceSelection';
import './public-multi-service.css';

type PublicMedia = {
  id: string;
  alt_text: string | null;
  sort_order: number;
  width: number;
  height: number;
};
type BusinessHour = { weekday: number; starts_local: string; ends_local: string };
type PublicProfile = {
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
  work_hours: BusinessHour[];
  media: PublicMedia[];
};

const dayLabels = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const FAVORITE_KEY_PREFIX = 'randevu-kolay:favorite-salon:';

function favoriteKey(slug: string) {
  return `${FAVORITE_KEY_PREFIX}${slug}`;
}

function safePublicSalonUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '').join('') || 'R').slice(0, 2);
}

function timeLabel(value: string) {
  return value.slice(0, 5);
}

function MediaImage({ media, className, eager = false, fallbackName }: {
  media: PublicMedia;
  className: string;
  eager?: boolean;
  fallbackName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className={`${className} public-salon-photo-fallback`} role="img" aria-label="Fotoğraf yüklenemedi">
      <strong>{initials(fallbackName)}</strong><span>Fotoğraf yüklenemedi</span>
    </div>;
  }
  return <img
    className={className}
    src={`/api/public/media/${encodeURIComponent(media.id)}`}
    alt={media.alt_text ?? `${fallbackName} salon fotoğrafı`}
    width={media.width}
    height={media.height}
    loading={eager ? 'eager' : 'lazy'}
    fetchPriority={eager ? 'high' : 'auto'}
    onError={() => setFailed(true)}
  />;
}

function ContactLink({ label, href }: { label: string; href: string }) {
  return <a className="public-salon-contact" href={href} rel={href.startsWith('http') ? 'noreferrer' : undefined}>
    {label}
  </a>;
}

export default function PublicSalonPage({ slug }: { slug: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [inactive, setInactive] = useState(false);
  const [notice, setNotice] = useState('');
  const [bookingSelection, setBookingSelection] = useState<PublicMultiServiceSelectionState | null>(null);
  const [bookingResultVisible, setBookingResultVisible] = useState(false);
  const [availabilityRefreshToken, setAvailabilityRefreshToken] = useState(0);
  const refreshBookingAvailability = useCallback(() => setAvailabilityRefreshToken((value) => value + 1), []);
  const [favorite, setFavorite] = useState(false);
  const [actionNotice, setActionNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInactive(false);
    setNotice('');
    setProfile(null);
    api<{ profile: PublicProfile }>(`/api/public/business/${encodeURIComponent(slug)}/profile`, { timeoutMs: 10_000 })
      .then((result) => {
        if (!cancelled) setProfile(result.profile);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 404) {
          setInactive(true);
          return;
        }
        setNotice(error instanceof Error ? error.message : 'Salon bilgileri şu anda yüklenemedi.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    setActionNotice('');
    try {
      setFavorite(window.localStorage.getItem(favoriteKey(slug)) === '1');
    } catch {
      setFavorite(false);
    }
  }, [slug]);

  function toggleFavorite() {
    const next = !favorite;
    try {
      if (next) window.localStorage.setItem(favoriteKey(slug), '1');
      else window.localStorage.removeItem(favoriteKey(slug));
      setFavorite(next);
      setActionNotice(next ? 'Salon bu cihazda favorilere eklendi.' : 'Salon bu cihazdaki favorilerden çıkarıldı.');
    } catch {
      setActionNotice('Favori tercihi bu cihazda kaydedilemedi.');
    }
  }

  async function shareSalon() {
    const url = safePublicSalonUrl();
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: profile?.public_name ?? 'Salon', url });
        setActionNotice('Salon bağlantısı paylaşıldı.');
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setActionNotice('Salon bağlantısı kopyalandı.');
        return;
      }
      setActionNotice('Paylaşım bu tarayıcıda kullanılamıyor.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setActionNotice('Salon bağlantısı paylaşılamadı.');
    }
  }

  const cover = useMemo(() => {
    if (!profile?.cover_media_id) return null;
    return profile.media.find((media) => media.id === profile.cover_media_id) ?? null;
  }, [profile]);
  const gallery = useMemo(() => profile?.media.filter((media) => media.id !== profile.cover_media_id) ?? [], [profile]);

  if (inactive) {
    return <main className="public-salon-page public-salon-inactive">
      <section className="public-salon-state-card">
        <p className="public-kicker">ONLINE RANDEVU</p>
        <h1>Bu rezervasyon bağlantısı şu anda aktif değil.</h1>
        <p>İşletme bağlantıyı kapatmış, kurulumu eksik kalmış veya adres geçersiz olabilir.</p>
      </section>
    </main>;
  }

  return <div className="public-salon-page">
    {loading && <section className="public-salon-hero public-salon-hero-loading" aria-busy="true" aria-label="Salon bilgileri yükleniyor">
      <div className="public-salon-photo-skeleton" />
      <div className="public-salon-copy-skeleton"><span /><span /><span /></div>
    </section>}

    {profile && <>
      <header className="public-salon-hero">
        <div className="public-salon-cover">
          {cover
            ? <MediaImage media={cover} className="public-salon-cover-image" eager fallbackName={profile.public_name} />
            : <div className="public-salon-cover-placeholder" role="img" aria-label="Salon fotoğrafı henüz eklenmedi">
              <strong>{initials(profile.public_name)}</strong>
              <span>Fotoğraf henüz eklenmedi</span>
            </div>}
        </div>
        <div className="public-salon-hero-copy">
          <p className="public-kicker">ONLINE RANDEVU</p>
          <h1>{profile.public_name}</h1>
          {profile.short_description && <p className="public-salon-lead">{profile.short_description}</p>}
          <nav className="public-salon-section-nav" aria-label="Salon bölümleri">
            <a href="#randevu">Hizmetler</a>
            <a href="#salon-bilgileri">Bilgiler</a>
          </nav>
          <div className="public-salon-actions" aria-label="Salon işlemleri">
            <button type="button" aria-pressed={favorite} onClick={toggleFavorite}>
              {favorite ? 'Favorilerde' : 'Favoriye ekle'}
            </button>
            <button type="button" onClick={() => void shareSalon()}>Paylaş</button>
          </div>
          {actionNotice && <p className="public-salon-action-notice" role="status">{actionNotice}</p>}
        </div>
      </header>

      {gallery.length > 0 && <section className="public-salon-gallery" aria-labelledby="salon-gallery-title">
        <div className="public-salon-section-head">
          <p className="public-kicker">SALONDAN</p>
          <h2 id="salon-gallery-title">Fotoğraflar</h2>
        </div>
        <div className="public-salon-gallery-grid">
          {gallery.map((media) => <MediaImage key={media.id} media={media} className="public-salon-gallery-image" fallbackName={profile.public_name} />)}
        </div>
      </section>}

      <section id="salon-bilgileri" className="public-salon-info" aria-labelledby="salon-info-title">
        <div className="public-salon-info-copy">
          <p className="public-kicker">SALON BİLGİLERİ</p>
          <h2 id="salon-info-title">Bilgiler</h2>
          {profile.long_description
            ? <p>{profile.long_description}</p>
            : profile.short_description
              ? <p>{profile.short_description}</p>
              : <p className="public-muted">Salon açıklaması henüz eklenmedi.</p>}
          {profile.address_text && <address>{profile.address_text}</address>}
          <div className="public-salon-contacts">
            {profile.public_phone && <ContactLink label={profile.public_phone} href={`tel:${profile.public_phone.replace(/\s+/g, '')}`} />}
            {profile.public_email && <ContactLink label={profile.public_email} href={`mailto:${profile.public_email}`} />}
            {profile.public_website && <ContactLink label="Web sitesi" href={profile.public_website} />}
            {profile.public_whatsapp && <ContactLink label="WhatsApp" href={`https://wa.me/${profile.public_whatsapp.replace(/\D/g, '')}`} />}
          </div>
        </div>
        {profile.show_work_hours && profile.work_hours.length > 0 && <div className="public-salon-hours">
          <h3>Çalışma saatleri</h3>
          <dl>
            {profile.work_hours.map((hours, index) => <div key={`${hours.weekday}-${hours.starts_local}-${index}`}>
              <dt>{dayLabels[hours.weekday] ?? `Gün ${hours.weekday}`}</dt>
              <dd>{timeLabel(hours.starts_local)}–{timeLabel(hours.ends_local)}</dd>
            </div>)}
          </dl>
        </div>}
      </section>
    </>}

    {notice && <div className="public-salon-notice" role="status">
      <strong>Salon bilgileri gösterilemedi.</strong> {notice} Randevu alanını yine de kullanabilirsiniz.
    </div>}

    <div id="randevu" className="public-salon-booking">
      {!bookingResultVisible && <div className="public-booking-shell public-multi-service-shell">
        <PublicMultiServiceSelection
          slug={slug}
          availabilityRefreshToken={availabilityRefreshToken}
          onSelectionChange={setBookingSelection}
        />
      </div>}
      <PublicBookingPage
        slug={slug}
        multiServiceSelection={bookingSelection}
        onPlanNeedsRefresh={refreshBookingAvailability}
        onResultVisibilityChange={setBookingResultVisible}
      />
    </div>
  </div>;
}
