import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from './i18n';
import { ApiRequestError, api } from './api';

type PublicBusiness = {
  name: string;
  slug: string;
  timezone: string;
  local_date: string;
  max_date: string;
};

type PublicService = {
  service_id: string;
  name: string;
  category: string;
  sort_order: number;
  duration_minutes: number;
  price_type: 'fixed' | 'range';
  price_min_minor: number;
  price_max_minor: number;
  currency: string;
  price_policy_version: number;
};

type BusinessPayload = { business: PublicBusiness };
type CatalogPayload = { services: PublicService[] };
type PagePayload = { business: PublicBusiness; services: PublicService[] };
type PublicStaff = { staff_id: string; staff_name: string };

export type PublicMultiServiceLineSelection = {
  serviceId: string;
  staffId: string | null;
};

export type PublicGroupSlotLine = {
  lineOrdinal: number;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  priceType: 'fixed' | 'range';
  priceMinMinor: number;
  priceMaxMinor: number;
};

export type PublicGroupSlot = {
  startsAt: string;
  endsAt: string;
  timezone: string;
  currency: string;
  estimateMinMinor: number;
  estimateMaxMinor: number;
  lines: PublicGroupSlotLine[];
};

export type PublicMultiServiceSelectionState = {
  date: string;
  lines: PublicMultiServiceLineSelection[];
  slot: PublicGroupSlot;
};

type Props = {
  slug: string;
  availabilityRefreshToken?: number;
  onAvailabilityChange?: (available: boolean) => void;
  onSelectionChange?: (state: PublicMultiServiceSelectionState | null) => void;
};

const MAX_LINES = 10;
const HTTP_TIMEOUT_MS = 10_000;

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function serviceRange(service: PublicService) {
  return { min: service.price_min_minor, max: service.price_max_minor };
}

function servicePriceLabel(service: PublicService) {
  const range = serviceRange(service);
  return range.min === range.max
    ? formatMoney(range.min, service.currency)
    : `${formatMoney(range.min, service.currency)} – ${formatMoney(range.max, service.currency)}`;
}

function slotPriceLabel(slot: PublicGroupSlot) {
  return slot.estimateMinMinor === slot.estimateMaxMinor
    ? formatMoney(slot.estimateMinMinor, slot.currency)
    : `${formatMoney(slot.estimateMinMinor, slot.currency)} – ${formatMoney(slot.estimateMaxMinor, slot.currency)}`;
}

function abortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown, fallback: string) {
  if (abortError(error)) return '';
  if (error instanceof ApiRequestError && error.retryAfter !== undefined) {
    return `${error.message} Lütfen ${error.retryAfter} saniye sonra tekrar deneyin.`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

// Every offered slot is rendered through Intl with its own zone; a zone Intl
// rejects would throw during render, so it is dropped here like any other
// malformed slot rather than reaching the page.
function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('tr-TR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validGroupSlot(value: unknown): value is PublicGroupSlot {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Partial<PublicGroupSlot>;
  if (typeof slot.startsAt !== 'string' || !Number.isFinite(Date.parse(slot.startsAt))
      || typeof slot.endsAt !== 'string' || !Number.isFinite(Date.parse(slot.endsAt))
      || Date.parse(slot.endsAt) <= Date.parse(slot.startsAt)
      || !validTimeZone(slot.timezone)
      || typeof slot.currency !== 'string' || !/^[A-Z]{3}$/.test(slot.currency)
      || typeof slot.estimateMinMinor !== 'number' || !Number.isInteger(slot.estimateMinMinor) || slot.estimateMinMinor < 0
      || typeof slot.estimateMaxMinor !== 'number' || !Number.isInteger(slot.estimateMaxMinor) || slot.estimateMaxMinor < slot.estimateMinMinor
      || !Array.isArray(slot.lines) || slot.lines.length < 1 || slot.lines.length > MAX_LINES) return false;
  return slot.lines.every((line, index) => {
    if (!line || typeof line !== 'object') return false;
    const item = line as Partial<PublicGroupSlotLine>;
    return item.lineOrdinal === index + 1
      && typeof item.serviceId === 'string'
      && typeof item.serviceName === 'string' && Boolean(item.serviceName)
      && typeof item.staffId === 'string'
      && typeof item.staffName === 'string' && Boolean(item.staffName)
      && typeof item.startsAt === 'string' && Number.isFinite(Date.parse(item.startsAt))
      && typeof item.endsAt === 'string' && Number.isFinite(Date.parse(item.endsAt))
      && Date.parse(item.endsAt) > Date.parse(item.startsAt)
      && (item.priceType === 'fixed' || item.priceType === 'range')
      && typeof item.priceMinMinor === 'number' && Number.isInteger(item.priceMinMinor) && item.priceMinMinor >= 0
      && typeof item.priceMaxMinor === 'number' && Number.isInteger(item.priceMaxMinor) && item.priceMaxMinor >= item.priceMinMinor;
  });
}

function matchesRequestedLines(slot: PublicGroupSlot, expected: PublicMultiServiceLineSelection[]) {
  if (slot.lines.length !== expected.length) return false;
  return expected.every((line, index) => {
    const planned = slot.lines[index];
    return Boolean(planned)
      && planned!.serviceId === line.serviceId
      && (line.staffId === null || planned!.staffId === line.staffId);
  });
}

export default function PublicMultiServiceSelection({ slug, availabilityRefreshToken = 0, onAvailabilityChange, onSelectionChange }: Props) {
  const [page, setPage] = useState<PagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [staffByService, setStaffByService] = useState<Record<string, PublicStaff[]>>({});
  const [staffChoice, setStaffChoice] = useState<Record<string, string>>({});
  const [staffAttempt, setStaffAttempt] = useState(0);
  const [staffRetryable, setStaffRetryable] = useState(false);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<PublicGroupSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicGroupSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [slotRetryable, setSlotRetryable] = useState(false);
  const catalogGeneration = useRef(0);
  const staffGeneration = useRef(0);
  const slotGeneration = useRef(0);
  const slotController = useRef<AbortController | null>(null);
  const lastRefreshToken = useRef(availabilityRefreshToken);

  useEffect(() => {
    const generation = ++catalogGeneration.current;
    const controller = new AbortController();
    setLoading(true);
    setNotice('');
    setPage(null);
    setSelectedIds([]);
    setStaffByService({});
    setStaffChoice({});
    setStaffRetryable(false);
    setSlots([]);
    setSelectedSlot(null);
    setBusy(false);
    setSlotRetryable(false);
    onSelectionChange?.(null);
    void (async () => {
      try {
        const [business, catalog] = await Promise.all([
          api<BusinessPayload>(`/api/public/business/${encodeURIComponent(slug)}`, {
            signal: controller.signal,
            timeoutMs: HTTP_TIMEOUT_MS,
          }),
          api<CatalogPayload>(`/api/public/business/${encodeURIComponent(slug)}/services-v2`, {
            signal: controller.signal,
            timeoutMs: HTTP_TIMEOUT_MS,
          }),
        ]);
        if (generation !== catalogGeneration.current) return;
        const next: PagePayload = { business: business.business, services: catalog.services };
        setPage(next);
        setDate(next.business.local_date);
        onAvailabilityChange?.(true);
      } catch (error) {
        if (generation !== catalogGeneration.current || abortError(error)) return;
        onAvailabilityChange?.(false);
        setNotice(errorMessage(error, t('Hizmet listesi yüklenemedi.')));
      } finally {
        if (generation === catalogGeneration.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [slug, catalogAttempt, onAvailabilityChange, onSelectionChange]);

  const services = useMemo(() => {
    const copy = [...(page?.services ?? [])];
    copy.sort((a, b) => {
      const category = (a.category ?? '').localeCompare(b.category ?? '', 'tr');
      if (category) return category;
      const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return order || a.name.localeCompare(b.name, 'tr');
    });
    return copy;
  }, [page]);

  const selectedServices = useMemo(() => selectedIds
    .map((id) => services.find((service) => service.service_id === id))
    .filter((service): service is PublicService => Boolean(service)), [selectedIds, services]);

  function invalidatePlan() {
    slotGeneration.current += 1;
    slotController.current?.abort();
    slotController.current = null;
    setBusy(false);
    setSlots([]);
    setSelectedSlot(null);
    setSlotRetryable(false);
    onSelectionChange?.(null);
  }

  function toggleService(serviceId: string) {
    setNotice('');
    invalidatePlan();
    setSelectedIds((current) => {
      if (current.includes(serviceId)) return current.filter((id) => id !== serviceId);
      if (current.length >= MAX_LINES) {
        setNotice(`Bir rezervasyonda en fazla ${MAX_LINES} hizmet seçilebilir.`);
        return current;
      }
      return [...current, serviceId];
    });
  }

  function moveService(index: number, delta: -1 | 1) {
    invalidatePlan();
    setSelectedIds((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const currentId = current[index];
      const targetId = current[target];
      if (!currentId || !targetId) return current;
      const next = [...current];
      next[index] = targetId;
      next[target] = currentId;
      return next;
    });
  }

  useEffect(() => {
    const generation = ++staffGeneration.current;
    const controllers: AbortController[] = [];
    const selectedSet = new Set(selectedIds);
    setStaffRetryable(false);
    setStaffChoice((current) => Object.fromEntries(Object.entries(current).filter(([id]) => selectedSet.has(id))));
    setStaffByService((current) => Object.fromEntries(Object.entries(current).filter(([id]) => selectedSet.has(id))));
    if (!selectedIds.length) return undefined;

    for (const serviceId of selectedIds) {
      const controller = new AbortController();
      controllers.push(controller);
      void api<{ staff: PublicStaff[] }>(`/api/public/business/${encodeURIComponent(slug)}/staff?serviceId=${encodeURIComponent(serviceId)}`, {
        signal: controller.signal,
        timeoutMs: HTTP_TIMEOUT_MS,
      }).then((result) => {
        if (generation !== staffGeneration.current) return;
        setStaffByService((current) => ({ ...current, [serviceId]: result.staff }));
      }).catch((error) => {
        if (generation !== staffGeneration.current || abortError(error)) return;
        setStaffRetryable(true);
        setNotice(errorMessage(error, t('Personel seçenekleri yüklenemedi. Tekrar deneyin.')));
      });
    }
    return () => controllers.forEach((controller) => controller.abort());
  }, [selectedIds, slug, staffAttempt]);

  const lines = useMemo<PublicMultiServiceLineSelection[]>(() => selectedIds.map((serviceId) => ({
    serviceId,
    staffId: staffChoice[serviceId] && staffChoice[serviceId] !== 'any' ? staffChoice[serviceId] : null,
  })), [selectedIds, staffChoice]);

  async function loadSlots() {
    if (!date || !lines.length) return;
    invalidatePlan();
    const generation = ++slotGeneration.current;
    const controller = new AbortController();
    slotController.current = controller;
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ slots: unknown[] }>(`/api/public/business/${encodeURIComponent(slug)}/group-slots`, {
        method: 'POST',
        csrf: 'skip',
        signal: controller.signal,
        timeoutMs: HTTP_TIMEOUT_MS,
        body: JSON.stringify({ date, lines }),
      });
      if (generation !== slotGeneration.current) return;
      const next = result.slots.filter(validGroupSlot);
      if (next.length !== result.slots.length || next.some((slot) => !matchesRequestedLines(slot, lines))) {
        throw new Error(t('Uygunluk yanıtı doğrulanamadı.'));
      }
      setSlots(next);
      setSlotRetryable(false);
      setNotice(next.length ? `${next.length} birlikte uygun başlangıç bulundu.` : t('Bu seçim için uygun ortak saat bulunamadı. Başka bir tarih seçin.'));
    } catch (error) {
      if (generation !== slotGeneration.current || abortError(error)) return;
      setSlots([]);
      setSlotRetryable(true);
      setNotice(errorMessage(error, t('Çoklu hizmet uygunluğu getirilemedi. Tekrar deneyin.')));
    } finally {
      if (generation === slotGeneration.current) {
        setBusy(false);
        slotController.current = null;
      }
    }
  }

  useEffect(() => {
    if (availabilityRefreshToken === lastRefreshToken.current) return;
    lastRefreshToken.current = availabilityRefreshToken;
    if (date && lines.length) void loadSlots();
  }, [availabilityRefreshToken]);

  function chooseSlot(slot: PublicGroupSlot) {
    setSelectedSlot(slot);
    setNotice('');
    onSelectionChange?.({ date, lines, slot });
  }

  const categoryGroups = useMemo(() => {
    const groups = new Map<string, PublicService[]>();
    for (const service of services) {
      const key = service.category?.trim() || 'Hizmetler';
      groups.set(key, [...(groups.get(key) ?? []), service]);
    }
    return [...groups.entries()];
  }, [services]);

  if (loading) return <section className="public-booking-card public-multi-service" aria-busy="true"><span className="public-step">{t('A')}</span><h2>{t('Birden fazla hizmet planla')}</h2><p className="public-muted">{t('Hizmetler hazırlanıyor…')}</p></section>;
  if (!page) return <section className="public-booking-card public-multi-service"><span className="public-step">{t('A')}</span><h2>{t('Birden fazla hizmet planla')}</h2><div className="public-inline-notice is-error" role="alert"><p>{notice || t('Çoklu hizmet seçimi şu anda hazırlanamadı.')}</p><button className="public-retry" type="button" onClick={() => setCatalogAttempt((current) => current + 1)}>{t('Tekrar dene')}</button></div></section>;

  return <section className="public-booking-card public-multi-service" aria-labelledby="public-multi-service-title">
    <span className="public-step">{t('A')}</span>
    <div className="public-multi-heading"><div><h2 id="public-multi-service-title">{t('Hizmet planınızı oluşturun')}</h2><p className="public-muted">{t('Bir veya daha fazla hizmeti sırayla seçin. Personeli her hizmet için ayrı belirleyebilirsiniz.')}</p></div><strong>{selectedIds.length}/{MAX_LINES}</strong></div>
    {notice && <div className="public-inline-notice" role="status">{notice}</div>}
    {staffRetryable && <button className="public-retry" type="button" onClick={() => { setNotice(''); setStaffRetryable(false); setStaffAttempt((current) => current + 1); }}>{t('Personeli tekrar yükle')}</button>}

    {categoryGroups.length === 0 ? <div className="public-inline-notice public-empty-state" role="status"><p>{t('Şu anda seçilebilecek hizmet bulunmuyor. Kısa süre sonra yeniden deneyin.')}</p><button className="public-retry" type="button" onClick={() => setCatalogAttempt((current) => current + 1)}>{t('Hizmetleri yenile')}</button></div> : <div className="public-service-catalog">
      {categoryGroups.map(([category, categoryServices]) => <fieldset key={category} className="public-service-category"><legend>{category}</legend>
        <div className="public-service-choice-grid">{categoryServices.map((service) => {
          const selected = selectedIds.includes(service.service_id);
          return <button key={service.service_id} type="button" className={`public-service-choice ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => toggleService(service.service_id)}>
            <span><strong>{service.name}</strong><small>{service.duration_minutes} dk</small></span><span className="public-service-price">{servicePriceLabel(service)}</span>
          </button>;
        })}</div>
      </fieldset>)}
    </div>}

    {selectedServices.length > 0 && <div className="public-selected-lines" aria-label={t('Seçilen hizmet sırası')}>
      {selectedServices.map((service, index) => <div className="public-selected-line" key={service.service_id}>
        <div className="public-line-order"><span>{index + 1}</span><div><strong>{service.name}</strong><small>{service.duration_minutes} dk · {servicePriceLabel(service)}</small></div></div>
        <label><span className="sr-only">{service.name} için personel</span><select value={staffChoice[service.service_id] ?? 'any'} onChange={(event) => { setStaffChoice((current) => ({ ...current, [service.service_id]: event.target.value })); invalidatePlan(); }}><option value="any">{t('Personel fark etmez')}</option>{(staffByService[service.service_id] ?? []).map((person) => <option key={person.staff_id} value={person.staff_id}>{person.staff_name}</option>)}</select></label>
        <div className="public-line-actions"><button type="button" disabled={index === 0} aria-label={`${service.name} hizmetini yukarı taşı`} onClick={() => moveService(index, -1)}>↑</button><button type="button" disabled={index === selectedServices.length - 1} aria-label={`${service.name} hizmetini aşağı taşı`} onClick={() => moveService(index, 1)}>↓</button><button type="button" aria-label={`${service.name} hizmetini kaldır`} onClick={() => toggleService(service.service_id)}>{t('Kaldır')}</button></div>
      </div>)}
    </div>}

    {selectedServices.length > 0 && <div className="public-multi-date-row">
      <div className="public-date-shortcuts" aria-label={t('Tarih kısayolları')}><button type="button" className={date === page.business.local_date ? 'is-selected' : ''} onClick={() => { setDate(page.business.local_date); invalidatePlan(); }}>{t('Bugün')}</button><button type="button" onClick={() => { const next = new Date(`${page.business.local_date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); const value = next.toISOString().slice(0, 10); if (value <= page.business.max_date) { setDate(value); invalidatePlan(); } }}>{t('Yarın')}</button></div>
      <label><span>{t('Tarih')}</span><input type="date" value={date} min={page.business.local_date} max={page.business.max_date} onChange={(event) => { setDate(event.target.value); invalidatePlan(); }} /></label>
      <button className="public-primary" type="button" disabled={busy || !date || !selectedIds.length} onClick={() => void loadSlots()}>{busy ? t('Birlikte uygunluk aranıyor…') : slotRetryable ? 'Uygun saatleri tekrar dene' : 'Birlikte uygun saatleri bul'}</button>
    </div>}

    {slots.length > 0 && <div className="public-group-slot-grid" aria-label={t('Çoklu hizmet uygun saatleri')}>{slots.map((slot) => {
      const active = selectedSlot?.startsAt === slot.startsAt && selectedSlot?.endsAt === slot.endsAt;
      return <button type="button" key={`${slot.startsAt}-${slot.endsAt}`} className={`public-group-slot ${active ? 'is-selected' : ''}`} aria-pressed={active} onClick={() => chooseSlot(slot)}>
        <span><strong>{formatTime(slot.startsAt, slot.timezone)}</strong><small>{slot.lines.length} hizmet · {formatTime(slot.endsAt, slot.timezone)} bitiş</small></span><span>{slotPriceLabel(slot)}</span>
      </button>;
    })}</div>}

    {selectedSlot && <div className="public-group-summary" role="status">
      <div><span>{t('Seçili plan')}</span><strong>{formatTime(selectedSlot.startsAt, selectedSlot.timezone)} · {slotPriceLabel(selectedSlot)}</strong></div>
      <ol>{selectedSlot.lines.map((line) => <li key={`${line.lineOrdinal}-${line.serviceId}`}><span><strong>{line.serviceName}</strong><small>{line.staffName} · {formatTime(line.startsAt, selectedSlot.timezone)}–{formatTime(line.endsAt, selectedSlot.timezone)}</small></span><span>{line.priceMinMinor === line.priceMaxMinor ? formatMoney(line.priceMinMinor, selectedSlot.currency) : `${formatMoney(line.priceMinMinor, selectedSlot.currency)} – ${formatMoney(line.priceMaxMinor, selectedSlot.currency)}`}</span></li>)}</ol>
      <p className="public-muted">{t('Bu tutar sunucunun rezervasyon tahminidir. Kesin tahsilat tutarı değildir.')}</p>
    </div>}
  </section>;
}
