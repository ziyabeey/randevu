import { useCallback, useEffect, useRef, useState } from 'react';
import { intlLocale, t } from './i18n';
import { api } from './api';
import './staff-commission.css';

// F16-07: commission is written by the database when a ticket closes and moved
// by later returns/refunds; this panel only reads the ledger and edits rate
// versions (owner/manager). Nothing here computes an amount the salon pays.

type CommissionStaffRow = {
  staffId: string;
  staffName: string;
  serviceBaseMinor: number;
  packageUnitBaseMinor: number;
  productBaseMinor: number;
  adjustmentBaseMinor: number;
  baseMinor: number;
  commissionMinor: number;
  adjustmentCommissionMinor: number;
  lineCount: number;
  adjustmentCount: number;
};

type CommissionMovement = {
  entryId: string;
  occurredAt: string;
  kind: 'line' | 'product_return' | 'payment_adjustment';
  staffId: string;
  staffName: string;
  ticketId: string;
  customerName: string;
  lineKind: 'service' | 'package_covered' | 'product';
  itemName: string;
  rateBps: number;
  rateSource: 'service_default' | 'service_override' | 'product_default' | 'none';
  baseMinor: number;
  amountMinor: number;
};

type CommissionReport = {
  businessId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  asOf: string;
  scope: 'business' | 'own';
  ownStaffId: string | null;
  currency: string | null;
  totals: { baseMinor: number; commissionMinor: number; adjustmentCommissionMinor: number; lineCount: number };
  staff: CommissionStaffRow[];
  movements: CommissionMovement[];
  movementCount: number;
  movementsTruncated: boolean;
  definition: string[];
};

type RateOverride = { serviceId: string; serviceName: string; version: number; rateBps: number | null };
type StaffRates = {
  staffId: string;
  staffName: string;
  active: boolean;
  version: number;
  serviceRateBps: number | null;
  productRateBps: number | null;
  overrides: RateOverride[];
};
type CatalogService = { id: string; name: string; active: boolean };

export function money(minor: number, currency: string | null) {
  const value = minor / 100;
  if (!currency) return new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  try {
    return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(value);
  } catch {
    return `${new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

export function percentText(bps: number | null) {
  if (bps === null) return '—';
  const percent = bps / 100;
  return `%${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, '').replace('.', ',')}`;
}

export function parsePercentBps(value: string) {
  const text = value.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const bps = Math.round(Number(text) * 100);
  return bps >= 0 && bps <= 10000 ? bps : null;
}

function bpsInput(bps: number | null) {
  if (bps === null) return '';
  return String(bps / 100).replace('.', ',');
}

const KIND_LABEL: Record<CommissionMovement['kind'], string> = {
  line: 'Kapanış',
  product_return: 'Ürün iadesi',
  payment_adjustment: 'İade/düzeltme payı',
};

const LINE_LABEL: Record<CommissionMovement['lineKind'], string> = {
  service: 'Hizmet',
  package_covered: 'Paket seansı',
  product: 'Ürün',
};

function timeLabel(instant: string, timeZone: string) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return instant;
  return new Intl.DateTimeFormat(intlLocale(), { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export default function StaffCommissionPanel({ businessId, startDate, endDate, requestKey, canManage }: {
  businessId: string;
  startDate: string;
  endDate: string;
  requestKey: number;
  canManage: boolean;
}) {
  const [report, setReport] = useState<CommissionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setLoading(true);
    setNotice('');
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const result = await api<{ report: CommissionReport }>(`/api/reports/commission?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (result.report.businessId !== businessId) throw new Error(t('Prim raporu güncel işletmeyle eşleşmiyor.'));
      setReport(result.report);
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setReport(null);
      setNotice(error instanceof Error ? error.message : t('Prim raporu hazırlanamadı.'));
    } finally {
      if (generation === generationRef.current) setLoading(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  // requestKey is the explicit reload signal from the page's report form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, requestKey]);

  useEffect(() => {
    void load();
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [load]);

  const currency = report?.currency ?? null;

  return (
    <section className="commission-panel" aria-labelledby="commission-title">
      <div className="commission-head">
        <div>
          <p className="financial-report-eyebrow">{t('PRİM VE ÇALIŞAN RAPORU')}</p>
          <h2 id="commission-title">{t('Prim raporu')}</h2>
          <p className="commission-scope">
            {report?.scope === 'own'
              ? t('Yalnız sizin prim hareketleriniz gösterilir.')
              : t('Seçili tarihlerde yazılan tüm çalışan prim hareketleri.')}
          </p>
        </div>
        {report && (
          <div className="commission-total">
            <span>{t('Toplam prim')}</span>
            <strong>{money(report.totals.commissionMinor, currency)}</strong>
            <small>{t('{lineCount} satır · matrah {base}', { lineCount: report.totals.lineCount, base: money(report.totals.baseMinor, currency) })}</small>
          </div>
        )}
      </div>

      {notice && <div className="financial-report-notice" role="status">{notice}</div>}
      {loading ? <p className="financial-report-loading" aria-busy="true">{t('Prim raporu hazırlanıyor…')}</p> : report && (
        <>
          <details className="commission-definition">
            <summary>{t('Hesap tanımı')}</summary>
            <ul>{report.definition.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>

          {report.staff.length === 0 ? (
            <p className="commission-empty">{t('Bu tarihlerde prim hareketi yok. Prim, adisyon kapanınca yazılır.')}</p>
          ) : (
            <div className="commission-table" role="table" aria-label={t('Çalışan prim özeti')}>
              <div className="commission-row commission-row--head" role="row">
                <span role="columnheader">{t('Çalışan')}</span>
                <span role="columnheader">{t('Hizmet')}</span>
                <span role="columnheader">{t('Paket seansı')}</span>
                <span role="columnheader">{t('Ürün')}</span>
                <span role="columnheader">{t('İade/düzeltme')}</span>
                <span role="columnheader">{t('Prim')}</span>
              </div>
              {report.staff.map((row) => (
                <div className="commission-row" role="row" key={row.staffId}>
                  <span role="cell" className="commission-staff"><strong>{row.staffName}</strong><small>{row.adjustmentCount ? t('{lines} satır · {adjustments} düzeltme', { lines: row.lineCount, adjustments: row.adjustmentCount }) : t('{lines} satır', { lines: row.lineCount })}</small></span>
                  <span role="cell" data-label="Hizmet">{money(row.serviceBaseMinor, currency)}</span>
                  <span role="cell" data-label="Paket seansı">{money(row.packageUnitBaseMinor, currency)}</span>
                  <span role="cell" data-label="Ürün">{money(row.productBaseMinor, currency)}</span>
                  <span role="cell" data-label="İade/düzeltme">{money(row.adjustmentBaseMinor, currency)}</span>
                  <span role="cell" data-label="Prim" className="commission-amount">{money(row.commissionMinor, currency)}</span>
                </div>
              ))}
            </div>
          )}

          {report.movements.length > 0 && (
            <details className="commission-movements">
              <summary>{t('Prim hareketleri ({movementCount})', { movementCount: report.movementCount })}</summary>
              {report.movementsTruncated && <p className="commission-note">{t('Son 500 hareket gösteriliyor; toplamlar tüm hareketleri kapsar.')}</p>}
              <ul>
                {report.movements.map((item) => (
                  <li key={item.entryId}>
                    <div>
                      <strong>{item.staffName}</strong>
                      <span>{item.itemName} · {t(LINE_LABEL[item.lineKind])} · {item.customerName}</span>
                      <small>{timeLabel(item.occurredAt, report.timezone)} · {t(KIND_LABEL[item.kind])} · {percentText(item.rateBps)}</small>
                    </div>
                    <div className="commission-movement-amount">
                      <strong>{money(item.amountMinor, currency)}</strong>
                      <small>{t('matrah {base}', { base: money(item.baseMinor, currency) })}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {canManage && <CommissionRatesEditor businessId={businessId} />}
    </section>
  );
}

function CommissionRatesEditor({ businessId }: { businessId: string }) {
  const [staff, setStaff] = useState<StaffRates[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rates, catalog] = await Promise.all([
        api<{ staff: StaffRates[] }>('/api/commission-rates'),
        api<{ services: CatalogService[]; membership: { business_id: string } }>('/api/catalog'),
      ]);
      if (catalog.membership.business_id !== businessId) throw new Error(t('Oranlar seçili işletmeyle eşleşmiyor.'));
      setStaff(rates.staff);
      setServices(catalog.services.filter((service) => service.active));
    } catch (error) {
      setStaff([]);
      setNotice(error instanceof Error ? error.message : t('Prim oranları yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  function replace(next: StaffRates) {
    setStaff((current) => current.map((item) => item.staffId === next.staffId ? next : item));
  }

  async function saveDefaults(item: StaffRates, form: HTMLFormElement) {
    const data = new FormData(form);
    const serviceRateBps = parsePercentBps(String(data.get('serviceRate') ?? ''));
    const productRateBps = parsePercentBps(String(data.get('productRate') ?? ''));
    if (serviceRateBps === null || productRateBps === null) {
      setNotice(t('Oranlar %0 ile %100 arasında, en fazla iki ondalıkla girilmeli.'));
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ staff: StaffRates }>(`/api/commission-rates/${item.staffId}`, {
        method: 'POST',
        body: JSON.stringify({ serviceRateBps, productRateBps, expectedVersion: item.version }),
      });
      replace(result.staff);
      setNotice(t('{staff} için yeni oranlar kaydedildi. Yalnız bundan sonra kapanan adisyonlara uygulanır.', { staff: item.staffName }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Oranlar kaydedilemedi.'));
      await load();
    } finally { setBusy(false); }
  }

  async function saveOverride(item: StaffRates, serviceId: string, rateBps: number | null) {
    const current = item.overrides.find((override) => override.serviceId === serviceId);
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ staff: StaffRates }>(`/api/commission-rates/${item.staffId}/services/${serviceId}`, {
        method: 'POST',
        body: JSON.stringify({ rateBps, expectedVersion: current?.version ?? 0 }),
      });
      replace(result.staff);
      setNotice(rateBps === null ? t('Hizmet istisnası kaldırıldı; varsayılan hizmet oranı geçerli.') : t('Hizmet istisnası kaydedildi.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Hizmet istisnası kaydedilemedi.'));
      await load();
    } finally { setBusy(false); }
  }

  return (
    <section className="commission-rates" aria-labelledby="commission-rates-title">
      <h3 id="commission-rates-title">{t('Prim oranları')}</h3>
      <p className="commission-note">{t('Her değişiklik yeni bir tarihli sürüm olarak kaydedilir ve yalnız sonraki kapanışlara uygulanır; yazılmış prim kayıtları değişmez.')}</p>
      {notice && <p className="commission-rates-notice" role="status">{notice}</p>}
      {loading ? <p className="financial-report-loading">{t('Oranlar yükleniyor…')}</p> : staff.length === 0 ? (
        <p className="commission-empty">{t('Önce Hizmetler sayfasından çalışan ekleyin.')}</p>
      ) : (
        <ul className="commission-rate-list">
          {staff.map((item) => {
            const active = item.overrides.filter((override) => override.rateBps !== null);
            const available = services.filter((service) => !active.some((override) => override.serviceId === service.id));
            return (
              <li key={item.staffId} className={item.active ? '' : 'inactive'}>
                <form
                  className="commission-rate-form"
                  aria-label={`${item.staffName} prim oranları`}
                  onSubmit={(event) => { event.preventDefault(); void saveDefaults(item, event.currentTarget); }}
                >
                  <strong>{item.staffName}{item.active ? '' : t(' (pasif)')}</strong>
                  <label>{t('Hizmet (%)')}<input name="serviceRate" inputMode="decimal" defaultValue={bpsInput(item.serviceRateBps)} placeholder="0" key={`s${item.version}`} /></label>
                  <label>{t('Ürün (%)')}<input name="productRate" inputMode="decimal" defaultValue={bpsInput(item.productRateBps)} placeholder="0" key={`p${item.version}`} /></label>
                  <button disabled={busy}>{t('Kaydet')}</button>
                  <small>{item.version ? t('Sürüm {version}', { version: item.version }) : t('Oran tanımlı değil (prim yazılmaz)')}</small>
                </form>
                {active.length > 0 && (
                  <ul className="commission-overrides">
                    {active.map((override) => (
                      <li key={override.serviceId}>
                        <span>{override.serviceName}: {percentText(override.rateBps)}</span>
                        <button type="button" disabled={busy} onClick={() => void saveOverride(item, override.serviceId, null)}>{t('İstisnayı kaldır')}</button>
                      </li>
                    ))}
                  </ul>
                )}
                {available.length > 0 && (
                  <form
                    className="commission-override-form"
                    aria-label={`${item.staffName} hizmet istisnası`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const rateBps = parsePercentBps(String(data.get('rate') ?? ''));
                      const serviceId = String(data.get('serviceId') ?? '');
                      if (rateBps === null || !serviceId) {
                        setNotice(t('Hizmet ve %0–100 arası istisna oranı seçin.'));
                        return;
                      }
                      void saveOverride(item, serviceId, rateBps);
                    }}
                  >
                    <label>{t('Hizmet istisnası')}
                      <select name="serviceId" defaultValue="">
                        <option value="" disabled>{t('Hizmet seçin')}</option>
                        {available.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                      </select>
                    </label>
                    <label>{t('Oran (%)')}<input name="rate" inputMode="decimal" placeholder="15" /></label>
                    <button disabled={busy}>{t('İstisna ekle')}</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
