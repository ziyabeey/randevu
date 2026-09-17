import { useEffect, useMemo, useRef, useState } from 'react';
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
  duration_minutes: number;
  price_minor: number;
  currency: string;
  category?: string | null;
  sort_order?: number;
  priceType?: 'fixed' | 'range';
  price_type?: 'fixed' | 'range';
  priceMinMinor?: number;
  price_min_minor?: number;
  priceMaxMinor?: number;
  price_max_minor?: number;
};

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
  const type = service.priceType ?? service.price_type ?? 'fixed';
  const min = service.priceMinMinor ?? service.price_min_minor ?? service.price_minor;
  const max = service.priceMaxMinor ?? service.price_max_minor ?? service.price_minor;
  return { type, min, max };
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

function validGroupSlot(value: unknown): value is PublicGroupSlot {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Partial<PublicGroupSlot>;
  if (typeof slot.startsAt !== 'string' || !Number.isFinite(Date.parse(slot.startsAt))
      || typeof slot.endsAt !== 'string' || !Number.isFinite(Date.parse(slot.endsAt))
      || Date.parse(slot.endsAt) <= Date.parse(slot.startsAt)
      || typeof slot.timezone !== 'string' || !slot.timezone
      || typeof slot.currency !== 'string' || !/^[A-Z]{3}$/.test(slot.currency)
      || !Number.isInteger(slot.estimateMinMinor) || Number(slot.estimateMinMinor) < 0
      || !Number.isInteger(slot.estimateMaxMinor) || Number(slot.estimateMaxMinor) < Number(slot.estimateMinMinor)
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
      && (item.priceType === 'fixed' || item.priceType === 'range')
      && Number.isInteger(item.priceMinMinor) && Number(item.priceMinMinor) >= 0
      && Number.isInteger(item.priceMaxMinor) && Number(item.priceMaxMinor) >= Number(item.priceMinMinor);
  });
}

export default function PublicMultiServiceSelection({ slug, onSelectionChange }: Props) {
  const [page, setPage] = useState<PagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [staffByService, setStaffByService] = useState<Record<string, PublicStaff[]>>({});
  const [staffChoice, setStaffChoice] = useState<Record<string, string>>({});
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<PublicGroupSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicGroupSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const catalogGeneration = useRef(0);
  const staffGeneration = useRef(0);
  const slotGeneration = useRef(0);
  const slotController = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = ++catalogGeneration.current;
    const controller = new AbortController();
    setLoading(true);
    setNotice('');
    setPage(null);
    setSelectedIds([]);
    setStaffByService({});
    setStaffChoice({});
    setSlots([]);
    setSelectedSlot(null);
    onSelectionChange?.(null);
    void (async () => {
      try {
        const next = await api<PagePayload>(`/api/public/business/${encodeURIComponent(slug)}`, {
          signal: controller.signal,
          timeoutMs: HTTP_TIMEOUT_MS,
        });
        if (generation !== catalogGeneration.current) return;
        setPage(next);
        setDate(next.business.local_date);
      } catch (error) {
        if (generation !== catalogGeneration.current || abortError(error)) return;
        setNotice(errorMessage(error, 'Hizmet listesi yüklenemedi.'));
      } finally {
        if (generation === catalogGeneration.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [slug]);

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
    setSlots([]);
    setSelectedSlot(null);
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
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  useEffect(() => {
    const generation = ++staffGeneration.current;
    const controllers: AbortController[] = [];
    const selectedSet = new Set(selectedIds);
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
        setNotice(errorMessage(error, 'Personel seçenekleri yüklenemedi.'));
      });
    }
    return () => controllers.forEach((controller) => controller.abort());
  }, [selectedIds, slug]);

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
      if (next.length !== result.slots.length) throw new Error('Uygunluk yanıtı doğrulanamadı.');
      setSlots(next);
      setNotice(next.length ? `${next.length} birlikte uygun başlangıç bulundu.` : 'Bu seçim için uygun ortak saat bulunamadı.');
    } catch (error) {
      if (generation !== slotGeneration.current || abortError(error)) return;
      setSlots([]);
      setNotice(errorMessage(error, 'Çoklu hizmet uygunluğu getirilemedi.'));
    } finally {
      if (generation === slotGeneration.current) {
        setBusy(false);
        slotController.current = null;
      }
    }
  }

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

  if (loading) return <section className="public-booking-card public-multi-service" aria-busy="true"><span className="public-step">A</span><h2>Birden fazla hizmet planla</h2><p className="public-muted">Hizmetler hazırlanıyor…</p></section>;
  if (!page) return <section className="public-booking-card public-multi-service"><span className="public-step">A</span><h2>Birden fazla hizmet planla</h2><p className="public-muted">{notice || 'Çoklu hizmet seçimi şu anda hazırlanamadı.'}</p></section>;

  return <section className="public-booking-card public-multi-service" aria-labelledby="public-multi-service-title">
    <span className="public-step">A</span>
    <div className="public-multi-heading"><div><h2 id="public-multi-service-title">Birden fazla hizmet planla</h2><p className="public-muted">Hizmetleri sırayla seçin. Personeli her hizmet için ayrı belirleyebilirsiniz.</p></div><strong>{selectedIds.length}/{MAX_LINES}</strong></div>
    {notice && <div className="public-inline-notice" role="status">{notice}</div>}

    <div className="public-service-catalog">
      {categoryGroups.map(([category, categoryServices]) => <fieldset key={category} className="public-service-category"><legend>{category}</legend>
        <div className="public-service-choice-grid">{categoryServices.map((service) => {
          const selected = selectedIds.includes(service.service_id);
          return <button key={service.service_id} type="button" className={`public-service-choice ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => toggleService(service.service_id)}>
            <span><strong>{service.name}</strong><small>{service.duration_minutes} dk</small></span><span className="public-service-price">{servicePriceLabel(service)}</span>
          </button>;
        })}</div>
      </fieldset>)}
    </div>

    {selectedServices.length > 0 && <div className="public-selected-lines" aria-label="Seçilen hizmet sırası">
      {selectedServices.map((service, index) => <div className="public-selected-line" key={service.service_id}>
        <div className="public-line-order"><span>{index + 1}</span><div><strong>{service.name}</strong><small>{service.duration_minutes} dk · {servicePriceLabel(service)}</small></div></div>
        <label><span className="sr-only">{service.name} için personel</span><select value={staffChoice[service.service_id] ?? 'any'} onChange={(event) => { setStaffChoice((current) => ({ ...current, [service.service_id]: event.target.value })); invalidatePlan(); }}><option value="any">Personel fark etmez</option>{(staffByService[service.service_id] ?? []).map((person) => <option key={person.staff_id} value={person.staff_id}>{person.staff_name}</option>)}</select></label>
        <div className="public-line-actions"><button type="button" disabled={index === 0} aria-label={`${service.name} hizmetini yukarı taşı`} onClick={() => moveService(index, -1)}>↑</button><button type="button" disabled={index === selectedServices.length - 1} aria-label={`${service.name} hizmetini aşağı taşı`} onClick={() => moveService(index, 1)}>↓</button><button type="button" aria-label={`${service.name} hizmetini kaldır`} onClick={() => toggleService(service.service_id)}>Kaldır</button></div>
      </div>)}
    </div>}

    {selectedServices.length > 0 && <div className="public-multi-date-row">
      <div className="public-date-shortcuts" aria-label="Tarih kısayolları"><button type="button" className={date === page.business.local_date ? 'is-selected' : ''} onClick={() => { setDate(page.business.local_date); invalidatePlan(); }}>Bugün</button><button type="button" onClick={() => { const next = new Date(`${page.business.local_date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); const value = next.toISOString().slice(0, 10); if (value <= page.business.max_date) { setDate(value); invalidatePlan(); } }}>Yarın</button></div>
      <label><span>Tarih</span><input type="date" value={date} min={page.business.local_date} max={page.business.max_date} onChange={(event) => { setDate(event.target.value); invalidatePlan(); }} /></label>
      <button className="public-primary" type="button" disabled={busy || !date || !selectedIds.length} onClick={() => void loadSlots()}>{busy ? 'Birlikte uygunluk aranıyor…' : 'Birlikte uygun saatleri bul'}</button>
    </div>}

    {slots.length > 0 && <div className="public-group-slot-grid" aria-label="Çoklu hizmet uygun saatleri">{slots.map((slot) => {
      const active = selectedSlot?.startsAt === slot.startsAt && selectedSlot?.endsAt === slot.endsAt;
      return <button type="button" key={`${slot.startsAt}-${slot.endsAt}`} className={`public-group-slot ${active ? 'is-selected' : ''}`} aria-pressed={active} onClick={() => chooseSlot(slot)}>
        <span><strong>{formatTime(slot.startsAt, slot.timezone)}</strong><small>{slot.lines.length} hizmet · {formatTime(slot.endsAt, slot.timezone)} bitiş</small></span><span>{slotPriceLabel(slot)}</span>
      </button>;
    })}</div>}

    {selectedSlot && <div className="public-group-summary" role="status">
      <div><span>Seçili plan</span><strong>{formatTime(selectedSlot.startsAt, selectedSlot.timezone)} · {slotPriceLabel(selectedSlot)}</strong></div>
      <ol>{selectedSlot.lines.map((line) => <li key={`${line.lineOrdinal}-${line.serviceId}`}><span><strong>{line.serviceName}</strong><small>{line.staffName} · {formatTime(line.startsAt, selectedSlot.timezone)}–{formatTime(line.endsAt, selectedSlot.timezone)}</small></span><span>{line.priceMinMinor === line.priceMaxMinor ? formatMoney(line.priceMinMinor, selectedSlot.currency) : `${formatMoney(line.priceMinMinor, selectedSlot.currency)} – ${formatMoney(line.priceMaxMinor, selectedSlot.currency)}`}</span></li>)}</ol>
      <p className="public-muted">Bu tutar sunucunun rezervasyon tahminidir. Kesin tahsilat tutarı değildir. İletişim ve oluşturma adımı F12-05 akışında bu seçimi devralır.</p>
    </div>}
  </section>;
}
