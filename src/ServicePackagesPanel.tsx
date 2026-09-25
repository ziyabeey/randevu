import { useCallback, useEffect, useState } from 'react';
import { intlLocale, t } from './i18n';
import type { FormEvent } from 'react';
import { api } from './api';
import './service-packages.css';

export type ServicePackage = {
  packageId: string;
  businessId: string;
  serviceId: string;
  serviceName: string | null;
  name: string;
  sessionCount: number;
  validityDays: number;
  priceMinor: number;
  unitValueMinor: number;
  currency: string;
  active: boolean;
  version: number;
};

type PackageService = { id: string; name: string; active: boolean };

type Props = {
  businessId: string;
  services: PackageService[];
  canManage: boolean;
};

export function packageMoney(minor: number, currency = 'TRY') {
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(minor / 100);
}

function parseMoneyInput(value: FormDataEntryValue | null) {
  // Same rule as the ticket cashier: one decimal separator (comma or dot), no grouping.
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const minor = Math.round(Number(text) * 100);
  return Number.isSafeInteger(minor) && minor >= 0 && minor <= 100000000 ? minor : null;
}

function definitionFrom(form: HTMLFormElement) {
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  const sessionCount = Number(data.get('sessionCount'));
  const validityDays = Number(data.get('validityDays'));
  const priceMinor = parseMoneyInput(data.get('price'));
  if (name.length < 2 || name.length > 120
      || !Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 100
      || !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 730
      || priceMinor === null) {
    return null;
  }
  return { name, sessionCount, validityDays, priceMinor, serviceId: String(data.get('serviceId') ?? '') };
}

// F16-05: a package is a fixed number of sessions of one service, sold once as
// its own ticket line. Changing a definition never changes packages already sold.
export default function ServicePackagesPanel({ businessId, services, canManage }: Props) {
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ packages: ServicePackage[] }>('/api/service-packages?includeInactive=true');
      if (result.packages.some((item) => item.businessId !== businessId)) throw new Error(t('Paketler seçili işletmeyle eşleşmiyor.'));
      setPackages(result.packages);
    } catch (error) {
      setPackages([]);
      setNotice(error instanceof Error ? error.message : t('Paketler yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const definition = definitionFrom(form);
    if (!definition || !definition.serviceId) {
      setNotice(t('Hizmet, paket adı, 1–100 seans, 1–730 gün ve geçerli bir fiyat girin.'));
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await api('/api/service-packages', {
        method: 'POST',
        body: JSON.stringify({ packageId: crypto.randomUUID(), ...definition }),
      });
      form.reset();
      setNotice(t('Paket tanımı eklendi.'));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Paket eklenemedi.'));
    } finally { setBusy(false); }
  }

  async function save(item: ServicePackage, next: { name: string; sessionCount: number; validityDays: number; priceMinor: number; active: boolean }) {
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/service-packages/${item.packageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...next, expectedVersion: item.version }),
      });
      setEditing(null);
      setNotice(next.active === item.active ? t('Paket tanımı güncellendi. Satılmış paketler değişmedi.') : next.active ? t('Paket yeniden satışa açıldı.') : t('Paket satışa kapatıldı. Satılmış paketler kullanılmaya devam eder.'));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Paket güncellenemedi.'));
      await load();
    } finally { setBusy(false); }
  }

  function submitEdit(event: FormEvent<HTMLFormElement>, item: ServicePackage) {
    event.preventDefault();
    const definition = definitionFrom(event.currentTarget);
    if (!definition) {
      setNotice(t('Paket adı, 1–100 seans, 1–730 gün ve geçerli bir fiyat girin.'));
      return;
    }
    void save(item, { ...definition, active: item.active });
  }

  const activeServices = services.filter((service) => service.active);

  return (
    <section className="panel span-two service-packages" aria-labelledby="service-packages-title">
      <div className="section-head">
        <div><p className="eyebrow">{t('PAKETLER')}</p><h2 id="service-packages-title">{t('Seans paketleri')}</h2></div>
        <span>{t('{item} satışta', { item: packages.filter((item) => item.active).length })}</span>
      </div>
      <p className="muted">{t('Paket, tek bir hizmetin belirli sayıda seansıdır. Satış adisyonda bir kez gelir olarak görünür; kullanılan seans yeniden gelir sayılmaz. İade, kullanılmayan seanslar oranında hesaplanır.')}</p>
      {notice && <p className="service-packages-notice" role="status">{notice}</p>}
      {loading ? <p className="muted">{t('Paketler yükleniyor…')}</p> : packages.length === 0 ? <p className="empty">{t('Henüz paket tanımı yok.')}</p> : (
        <ul className="service-package-list">
          {packages.map((item) => (
            <li key={item.packageId} className={item.active ? '' : 'inactive'}>
              <div className="service-package-summary">
                <strong>{item.name}</strong>
                <span>{t('{value} · {sessionCount} seans · {validityDays} gün geçerli', { value: item.serviceName ?? t('Hizmet'), sessionCount: item.sessionCount, validityDays: item.validityDays })}</span>
                <span>{t('{price} · seans değeri {unitValue}', { price: packageMoney(item.priceMinor, item.currency), unitValue: packageMoney(item.unitValueMinor, item.currency) })}</span>
              </div>
              <span className="status-pill">{item.active ? t('Satışta') : t('Satışa kapalı')}</span>
              {canManage && editing !== item.packageId && (
                <div className="service-package-actions">
                  <button type="button" disabled={busy} onClick={() => setEditing(item.packageId)}>{t('Düzenle')}</button>
                  <button type="button" disabled={busy} onClick={() => void save(item, {
                    name: item.name, sessionCount: item.sessionCount, validityDays: item.validityDays,
                    priceMinor: item.priceMinor, active: !item.active,
                  })}>{item.active ? t('Satışa kapat') : t('Satışa aç')}</button>
                </div>
              )}
              {canManage && editing === item.packageId && (
                <form className="service-package-form" onSubmit={(event) => submitEdit(event, item)}>
                  <label>{t('Paket adı')}<input name="name" defaultValue={item.name} required minLength={2} maxLength={120} /></label>
                  <label>{t('Seans')}<input name="sessionCount" type="number" inputMode="numeric" min={1} max={100} defaultValue={item.sessionCount} required /></label>
                  <label>{t('Geçerlilik (gün)')}<input name="validityDays" type="number" inputMode="numeric" min={1} max={730} defaultValue={item.validityDays} required /></label>
                  <label>{t('Fiyat (TL)')}<input name="price" inputMode="decimal" defaultValue={(item.priceMinor / 100).toFixed(2).replace('.', ',')} required /></label>
                  <div className="service-package-actions">
                    <button className="primary-button" disabled={busy}>{t('Kaydet')}</button>
                    <button type="button" disabled={busy} onClick={() => setEditing(null)}>{t('Vazgeç')}</button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form className="service-package-form create" onSubmit={create}>
          <h3>{t('Yeni paket')}</h3>
          <label>{t('Hizmet')}
            <select name="serviceId" required defaultValue="">
              <option value="" disabled>{t('Hizmet seçin')}</option>
              {activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </label>
          <label>{t('Paket adı')}<input name="name" placeholder={t('5 Seans Lazer')} required minLength={2} maxLength={120} /></label>
          <label>{t('Seans')}<input name="sessionCount" type="number" inputMode="numeric" min={1} max={100} defaultValue={5} required /></label>
          <label>{t('Geçerlilik (gün)')}<input name="validityDays" type="number" inputMode="numeric" min={1} max={730} defaultValue={90} required /></label>
          <label>{t('Fiyat (TL)')}<input name="price" inputMode="decimal" placeholder="1000" required /></label>
          <button className="primary-button" disabled={busy || activeServices.length === 0}>{t('Paketi ekle')}</button>
        </form>
      )}
    </section>
  );
}
