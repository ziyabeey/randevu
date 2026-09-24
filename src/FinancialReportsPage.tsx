import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';
import { useWorkspace } from './workspace-context';

type FinancialReport = {
  businessId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  fromInstant: string;
  toInstant: string;
  asOf: string;
  currency: string | null;
  collectedMinor: number;
  cashCollectedMinor: number;
  cardCollectedMinor: number;
  refundMinor: number;
  correctionIncreaseMinor: number;
  correctionDecreaseMinor: number;
  paymentNetMinor: number;
  expenseMinor: number;
  cashExpenseMinor: number;
  cardExpenseMinor: number;
  netMovementMinor: number;
  cashNetMovementMinor: number;
  cardNetMovementMinor: number;
  expectedMinMinor: number;
  expectedMaxMinor: number;
  expectedAppointmentMinMinor: number;
  expectedAppointmentMaxMinor: number;
  appointmentCount: number;
  serviceSaleMinor: number;
  productSaleMinor: number;
  packageSaleMinor?: number;
  packageCoveredSessionCount?: number;
  packageCoveredValueMinor?: number;
  saleValueMinor: number;
  outstandingMinor: number;
  ticketCount: number;
  unsettledTicketCount: number;
};

function localDateInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function money(minor: number, currency: string | null) {
  if (!currency) return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency}`;
  }
}

function moneyRange(minorMin: number, minorMax: number, currency: string | null) {
  if (minorMin === minorMax) return money(minorMin, currency);
  return `${money(minorMin, currency)} – ${money(minorMax, currency)}`;
}

function timeLabel(instant: string, timeZone: string) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return instant;
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

export default function FinancialReportsPage() {
  const { activeBusinessId, activeBusiness, scopeEpoch } = useWorkspace();
  const timeZone = activeBusiness?.timezone ?? 'Europe/Istanbul';
  const today = useMemo(() => localDateInZone(timeZone), [timeZone]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const requestController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);

  const load = useCallback(async (from = startDate, to = endDate) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const generation = ++requestGeneration.current;
    setLoading(true);
    setNotice('');
    try {
      const params = new URLSearchParams({ startDate: from, endDate: to });
      const result = await api<{ report: FinancialReport }>(`/api/reports/financial?${params}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      if (result.report.businessId !== activeBusinessId) throw new Error('Rapor güncel işletmeyle eşleşmiyor.');
      setReport(result.report);
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      setReport(null);
      setNotice(error instanceof Error ? error.message : 'Mali rapor hazırlanamadı.');
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
      if (requestController.current === controller) requestController.current = null;
    }
  }, [activeBusinessId, endDate, startDate]);

  useEffect(() => {
    const next = localDateInZone(timeZone);
    setStartDate(next);
    setEndDate(next);
    setReport(null);
    setNotice('');
    void load(next, next);
    return () => {
      requestGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  // load intentionally runs against explicit dates during workspace reset.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusinessId, scopeEpoch, timeZone]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startDate || !endDate || endDate < startDate) {
      setNotice('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
      return;
    }
    void load();
  }

  const currency = report?.currency ?? null;

  return (
    <main className="financial-report-shell">
      <header className="financial-report-hero">
        <div>
          <p className="financial-report-eyebrow">KASA VE RAPORLAR</p>
          <h1>Gün sonu görünümü</h1>
          <p>Tahsilat, iade, masraf, satış ve açık bakiye aynı kaynak kayıtlarından yeniden hesaplanır. Bu ekran muhasebe kapanışı oluşturmaz.</p>
        </div>
      </header>

      <form className="financial-report-filter" onSubmit={submit}>
        <label>
          Başlangıç
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
        </label>
        <label>
          Bitiş
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
        </label>
        <button disabled={loading}>Raporu getir</button>
      </form>

      {notice && <div className="financial-report-notice" role="status">{notice}</div>}
      {loading ? <p className="financial-report-loading" aria-busy="true">Rapor hazırlanıyor…</p> : report && (
        <>
          <section className="financial-report-meta" aria-label="Rapor kimliği">
            <span>{report.startDate === report.endDate ? report.startDate : `${report.startDate} → ${report.endDate}`}</span>
            <span>{report.timezone}</span>
            <span>Hesaplama: {timeLabel(report.asOf, report.timezone)}</span>
          </section>

          <section className="financial-report-cards" aria-label="Mali özet">
            <article className="financial-report-card financial-report-card--primary">
              <span>Net hareket</span>
              <strong>{money(report.netMovementMinor, currency)}</strong>
              <small>Tahsilat etkisi − net masraf</small>
            </article>
            <article className="financial-report-card">
              <span>Tahsilat</span>
              <strong>{money(report.collectedMinor, currency)}</strong>
              <small>Nakit {money(report.cashCollectedMinor, currency)} · Kart {money(report.cardCollectedMinor, currency)}</small>
            </article>
            <article className="financial-report-card">
              <span>İade</span>
              <strong>{money(report.refundMinor, currency)}</strong>
              <small>Düzeltme +{money(report.correctionIncreaseMinor, currency)} / −{money(report.correctionDecreaseMinor, currency)}</small>
            </article>
            <article className="financial-report-card">
              <span>Masraf</span>
              <strong>{money(report.expenseMinor, currency)}</strong>
              <small>Nakit {money(report.cashExpenseMinor, currency)} · Kart {money(report.cardExpenseMinor, currency)}</small>
            </article>
            <article className="financial-report-card">
              <span>Beklenen tutar</span>
              <strong>{moneyRange(report.expectedMinMinor, report.expectedMaxMinor, currency)}</strong>
              <small>Kesinleşmemiş adisyonlar dahil snapshot aralığı</small>
            </article>
            <article className="financial-report-card">
              <span>Beklenen randevu bedeli</span>
              <strong>{moneyRange(report.expectedAppointmentMinMinor, report.expectedAppointmentMaxMinor, currency)}</strong>
              <small>{report.appointmentCount} randevu · gerçekleşen satıştan ayrıdır</small>
            </article>
            <article className="financial-report-card">
              <span>Satış değeri</span>
              <strong>{money(report.saleValueMinor, currency)}</strong>
              <small>Hizmet {money(report.serviceSaleMinor, currency)} · Ürün {money(report.productSaleMinor, currency)} · Paket {money(report.packageSaleMinor ?? 0, currency)}</small>
            </article>
            <article className="financial-report-card">
              <span>Paketten karşılanan seans</span>
              <strong>{report.packageCoveredSessionCount ?? 0}</strong>
              <small>Seans değeri {money(report.packageCoveredValueMinor ?? 0, currency)} · paket satışında gelir yazıldı, tekrar sayılmaz</small>
            </article>
            <article className="financial-report-card">
              <span>Açık bakiye</span>
              <strong>{money(report.outstandingMinor, currency)}</strong>
              <small>Para girişine eklenmez</small>
            </article>
          </section>

          <section className="financial-report-reconcile" aria-label="Mutabakat">
            <div>
              <h2>Kaynak mutabakatı</h2>
              <p>Nakit net {money(report.cashNetMovementMinor, currency)} · Kart net {money(report.cardNetMovementMinor, currency)}</p>
            </div>
            <div>
              <strong>{report.ticketCount}</strong>
              <span>adisyon</span>
            </div>
            <div>
              <strong>{report.unsettledTicketCount}</strong>
              <span>kesinleşmemiş toplam</span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
