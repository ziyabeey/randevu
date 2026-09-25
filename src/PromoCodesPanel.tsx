import { useCallback, useEffect, useState } from 'react';
import { intlLocale, t } from './i18n';
import type { FormEvent } from 'react';
import { api } from './api';
import { promoValueText } from './PublicPromo';
import './service-packages.css';

type PromoCode = {
  promoId: string;
  businessId: string;
  code: string;
  kind: 'percent' | 'fixed';
  percentBps: number | null;
  amountMinor: number | null;
  currency: string;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  serviceIds: string[];
  serviceNames: string[];
  reservedCount: number;
  consumedCount: number;
  active: boolean;
  version: number;
};

type PromoService = { id: string; name: string; active: boolean };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'short' }).format(new Date(value));
}

function parseAmount(value: string) {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const minor = Math.round(Number(text) * 100);
  return Number.isSafeInteger(minor) && minor >= 1 && minor <= 100000000 ? minor : null;
}

function parsePercent(value: string) {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const bps = Math.round(Number(text) * 100);
  return bps >= 1 && bps <= 10000 ? bps : null;
}

// A local calendar date becomes the start (00:00) or the exclusive end (next
// day 00:00) of the campaign in the browser's timezone.
function dayStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function dayEndExclusive(value: string) {
  const start = dayStart(value);
  if (!start) return null;
  return new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
}

// F16-06: salon campaign codes. The value is fixed or a percentage (rounded
// down on the ticket), limited by dates, services and an optional usage count.
export default function PromoCodesPanel({ businessId, services, canManage }: {
  businessId: string;
  services: PromoService[];
  canManage: boolean;
}) {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ promoCodes: PromoCode[] }>('/api/promo-codes');
      if (result.promoCodes.some((item) => item.businessId !== businessId)) throw new Error(t('Kampanyalar seçili işletmeyle eşleşmiyor.'));
      setCodes(result.promoCodes);
    } catch (error) {
      setCodes([]);
      setNotice(error instanceof Error ? error.message : t('Kampanyalar yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = String(data.get('code') ?? '').trim();
    const value = String(data.get('value') ?? '');
    const startsAt = dayStart(String(data.get('startsOn') ?? ''));
    const endsOn = String(data.get('endsOn') ?? '');
    const endsAt = endsOn ? dayEndExclusive(endsOn) : null;
    const limitText = String(data.get('usageLimit') ?? '').trim();
    const usageLimit = limitText ? Number(limitText) : null;
    const serviceIds = data.getAll('serviceIds').map(String);
    const percentBps = kind === 'percent' ? parsePercent(value) : null;
    const amountMinor = kind === 'fixed' ? parseAmount(value) : null;
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/.test(code) || !startsAt
        || (kind === 'percent' ? percentBps === null : amountMinor === null)
        || (endsOn && (!endsAt || Date.parse(endsAt) <= Date.parse(startsAt)))
        || (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 100000))) {
      setNotice(t('Kod (3–32 harf/rakam/tire), indirim değeri, başlangıç tarihi, bitişten önce gelen başlangıç ve 1–100000 kullanım sınırı girin.'));
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await api('/api/promo-codes', {
        method: 'POST',
        body: JSON.stringify({ promoId: crypto.randomUUID(), code, kind, percentBps, amountMinor, startsAt, endsAt, usageLimit, serviceIds }),
      });
      form.reset();
      setKind('percent');
      setNotice(t('Kampanya kodu eklendi.'));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Kampanya eklenemedi.'));
    } finally { setBusy(false); }
  }

  async function toggle(item: PromoCode) {
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/promo-codes/${item.promoId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          kind: item.kind, percentBps: item.percentBps, amountMinor: item.amountMinor,
          startsAt: item.startsAt, endsAt: item.endsAt, usageLimit: item.usageLimit,
          serviceIds: item.serviceIds, active: !item.active, expectedVersion: item.version,
        }),
      });
      setNotice(item.active ? t('Kampanya kapatıldı. Ayrılmış kodlar adisyonda geçerli kalır.') : t('Kampanya yeniden açıldı.'));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Kampanya güncellenemedi.'));
      await load();
    } finally { setBusy(false); }
  }

  const activeServices = services.filter((service) => service.active);
  const today = new Date();
  const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <section className="panel span-two service-packages promo-codes" aria-labelledby="promo-codes-title">
      <div className="section-head">
        <div><p className="eyebrow">{t('KAMPANYALAR')}</p><h2 id="promo-codes-title">{t('Kampanya kodları')}</h2></div>
        <span>{t('{item} aktif', { item: codes.filter((item) => item.active).length })}</span>
      </div>
      <p className="muted">{t('Müşteri kodu online randevuda girer; kod o randevu için ayrılır ve adisyon kapanınca kullanılmış sayılır. İptal edilen randevunun kodu serbest kalır. Bir adisyonda tek kod geçerlidir; paketten karşılanan hizmete indirim uygulanmaz ve yüzde indirim kuruşa aşağı yuvarlanır.')}</p>
      {notice && <p className="service-packages-notice" role="status">{notice}</p>}
      {loading ? <p className="muted">{t('Kampanyalar yükleniyor…')}</p> : codes.length === 0 ? <p className="empty">{t('Henüz kampanya kodu yok.')}</p> : (
        <ul className="service-package-list">
          {codes.map((item) => (
            <li key={item.promoId} className={item.active ? '' : 'inactive'}>
              <div className="service-package-summary">
                <strong>{item.code}</strong>
                <span>{promoValueText(item)} · {item.serviceNames.length ? item.serviceNames.join(', ') : t('Tüm hizmetler')}</span>
                <span>{item.endsAt ? `${dateLabel(item.startsAt)} – ${dateLabel(new Date(Date.parse(item.endsAt) - 1).toISOString())}` : `${dateLabel(item.startsAt)}${t(' · bitiş yok')}`}{' · '}{item.usageLimit ? t('{consumed} kullanıldı · {reserved} ayrıldı / {limit}', { consumed: item.consumedCount, reserved: item.reservedCount, limit: item.usageLimit }) : t('{consumed} kullanıldı · {reserved} ayrıldı', { consumed: item.consumedCount, reserved: item.reservedCount })}</span>
              </div>
              <span className="status-pill">{item.active ? t('Aktif') : t('Kapalı')}</span>
              {canManage && (
                <div className="service-package-actions">
                  <button type="button" disabled={busy} onClick={() => void toggle(item)}>{item.active ? t('Kampanyayı kapat') : t('Kampanyayı aç')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form className="service-package-form create promo-code-form" onSubmit={create}>
          <h3>{t('Yeni kampanya kodu')}</h3>
          <label>{t('Kod')}<input name="code" placeholder={t('YAZ20')} required minLength={3} maxLength={32} autoCapitalize="characters" /></label>
          <label>İndirim türü
            <select value={kind} onChange={(event) => setKind(event.target.value as 'percent' | 'fixed')}>
              <option value="percent">{t('Yüzde')}</option>
              <option value="fixed">{t('Sabit tutar (TL)')}</option>
            </select>
          </label>
          <label>{kind === 'percent' ? t('Yüzde (%)') : t('Tutar (TL)')}<input name="value" inputMode="decimal" required placeholder={kind === 'percent' ? '20' : '100'} /></label>
          <label>{t('Başlangıç')}<input name="startsOn" type="date" required defaultValue={todayValue} /></label>
          <label>{t('Bitiş (dahil)')}<input name="endsOn" type="date" /></label>
          <label>{t('Kullanım sınırı')}<input name="usageLimit" type="number" inputMode="numeric" min={1} max={100000} placeholder={t('Sınırsız')} /></label>
          <fieldset className="promo-code-services">
            <legend>{t('Hizmet kapsamı (boş = tüm hizmetler)')}</legend>
            {activeServices.map((service) => (
              <label key={service.id} className="chip"><input type="checkbox" name="serviceIds" value={service.id} /> {service.name}</label>
            ))}
          </fieldset>
          <button className="primary-button" disabled={busy}>{t('Kampanyayı ekle')}</button>
        </form>
      )}
    </section>
  );
}
