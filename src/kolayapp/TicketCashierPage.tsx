import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiRequestError, api } from '../api';
import type { ManagedCatalog } from '../CatalogSettingsPanel';
import { useWorkspace } from '../workspace-context';
import './ticket-cashier.css';

type PageInfo = { limit: number; hasMore: boolean; nextCursor: string | null };
type TicketLine = {
  lineId: string;
  ordinal: number;
  sourceType: 'service';
  sourceAppointmentLineId: string | null;
  serviceId: string;
  staffId: string | null;
  serviceName: string;
  staffName: string | null;
  quantity: number;
  priceType: 'fixed' | 'range';
  priceMinMinor: number;
  priceMaxMinor: number;
  currency: string;
  pricePolicyVersion: number;
  finalUnitPriceMinor: number | null;
  discountMinor: number;
  netMinor: number | null;
  finalizedAt: string | null;
  finalizationReason: string | null;
  discountAt: string | null;
  discountReason: string | null;
};
type PaymentEvent = {
  eventId: string;
  eventType: 'payment' | 'correction' | 'refund';
  sourcePaymentEventId: string | null;
  method: 'cash' | 'card' | null;
  correctionDirection: 'increase' | 'decrease' | null;
  amountMinor: number;
  effectMinor: number;
  reason: string | null;
  actorMembershipId: string;
  createdAt: string;
};
export type TicketContract = {
  ticketId: string;
  businessId: string;
  bookingGroupId: string | null;
  customerId: string;
  source: 'booking_group' | 'walk_in';
  status: 'open' | 'closed' | 'cancelled';
  version: number;
  currency: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  settlementReady: boolean;
  estimateMinMinor: number;
  estimateMaxMinor: number;
  subtotalMinor: number | null;
  discountMinor: number | null;
  totalMinor: number | null;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paidMinor: number;
  balanceMinor: number | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  lines: TicketLine[];
  paymentEvents: PaymentEvent[];
};
type Customer = {
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
};
type CustomerList = { customers: Customer[]; page: PageInfo };
type TicketList = { tickets: TicketContract[]; page: PageInfo };
type PendingAmbiguity = {
  businessId: string;
  action: string;
  idempotencyKey: string;
};

const PENDING_AMBIGUITY_STORAGE_KEY = 'randevu:ticket-cashier:pending-ambiguity:v1';

function samePendingAmbiguity(left: PendingAmbiguity | null, right: PendingAmbiguity) {
  return Boolean(left
    && left.businessId === right.businessId
    && left.action === right.action
    && left.idempotencyKey === right.idempotencyKey);
}

function readPendingAmbiguity(): PendingAmbiguity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_AMBIGUITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAmbiguity>;
    if (typeof parsed.businessId !== 'string'
      || typeof parsed.action !== 'string'
      || typeof parsed.idempotencyKey !== 'string'
      || !parsed.businessId
      || !parsed.action
      || !parsed.idempotencyKey) {
      window.sessionStorage.removeItem(PENDING_AMBIGUITY_STORAGE_KEY);
      return null;
    }
    return {
      businessId: parsed.businessId,
      action: parsed.action,
      idempotencyKey: parsed.idempotencyKey,
    };
  } catch {
    return null;
  }
}

function writePendingAmbiguity(value: PendingAmbiguity) {
  try {
    window.sessionStorage.setItem(PENDING_AMBIGUITY_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The in-memory key still protects the current mounted session.
  }
}

function clearPendingAmbiguity(expected: PendingAmbiguity) {
  try {
    const current = readPendingAmbiguity();
    if (!current || samePendingAmbiguity(current, expected)) {
      window.sessionStorage.removeItem(PENDING_AMBIGUITY_STORAGE_KEY);
    }
  } catch {
    // Storage unavailability must not turn a definitive server result into a UI failure.
  }
}

function money(minor: number | null, currency: string | null) {
  if (minor === null) return 'Kesinleşmedi';
  if (!currency) return String(minor);
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function parseMoney(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0 || number > 1_000_000) return null;
  return Math.round(number * 100);
}

function localDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function keyFor(map: Map<string, string>, action: string) {
  const current = map.get(action);
  if (current) return current;
  const value = crypto.randomUUID();
  map.set(action, value);
  return value;
}

function ambiguous(error: unknown) {
  return error instanceof ApiRequestError
    && (error.code === 'NETWORK_UNAVAILABLE'
      || error.code === 'REQUEST_TIMEOUT'
      || error.status === 503);
}

export default function TicketCashierPage() {
  const { activeBusinessId, scopeEpoch } = useWorkspace();
  const [tickets, setTickets] = useState<TicketContract[]>([]);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [status, setStatus] = useState<'all' | 'open' | 'closed' | 'cancelled'>('open');
  const [selected, setSelected] = useState<TicketContract | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [catalog, setCatalog] = useState<ManagedCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingAmbiguity, setPendingAmbiguity] = useState<PendingAmbiguity | null>(() => readPendingAmbiguity());
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialTicketId = initialParams.get('ticketId');
  const initialCustomerId = initialParams.get('customerId');
  const keys = useRef(new Map<string, string>());
  const listGeneration = useRef(0);

  const activeServices = useMemo(() => catalog?.services.filter((item) => item.active) ?? [], [catalog]);
  const activeStaff = useMemo(() => catalog?.staff.filter((item) => item.active) ?? [], [catalog]);

  const loadTicket = useCallback(async (ticketId: string) => {
    const result = await api<{ ticket: TicketContract }>(`/api/tickets/${ticketId}`);
    if (result.ticket.businessId !== activeBusinessId) throw new Error('Adisyon seçili işletmeyle eşleşmiyor.');
    setSelected(result.ticket);
    setTickets((current) => current.map((row) => row.ticketId === result.ticket.ticketId ? result.ticket : row));
    return result.ticket;
  }, [activeBusinessId]);

  const loadTickets = useCallback(async (append = false, cursor: string | null = null) => {
    const generation = ++listGeneration.current;
    const params = new URLSearchParams({ limit: '25', status });
    if (initialCustomerId) params.set('customerId', initialCustomerId);
    if (cursor) params.set('cursor', cursor);
    const result = await api<TicketList>(`/api/tickets?${params}`);
    if (generation !== listGeneration.current) return;
    setTickets((current) => append ? [...current, ...result.tickets] : result.tickets);
    setPage(result.page);
    if (!append) {
      setSelected((current) => current && !result.tickets.some((row) => row.ticketId === current.ticketId) ? null : current);
    }
  }, [initialCustomerId, status]);

  const loadLookups = useCallback(async () => {
    const [customerResult, nextCatalog] = await Promise.all([
      api<CustomerList>('/api/customers?limit=100'),
      api<ManagedCatalog>('/api/catalog'),
    ]);
    if (nextCatalog.membership.business_id !== activeBusinessId) throw new Error('Katalog seçili işletmeyle eşleşmiyor.');
    setCustomers(customerResult.customers);
    setCatalog(nextCatalog);
  }, [activeBusinessId]);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice('');
    const persistedAmbiguity = readPendingAmbiguity();
    keys.current.clear();
    if (persistedAmbiguity) keys.current.set(persistedAmbiguity.action, persistedAmbiguity.idempotencyKey);
    setPendingAmbiguity(persistedAmbiguity);
    try {
      await Promise.all([loadTickets(false), loadLookups()]);
      if (initialTicketId) await loadTicket(initialTicketId);
      if (persistedAmbiguity) {
        setNotice(persistedAmbiguity.businessId === activeBusinessId
          ? 'Sonucu belirsiz mali işlem korunuyor. Aynı işlem ve tutarla tekrar deneyin; önceki anahtar kullanılacak.'
          : 'Başka bir işletmede sonucu belirsiz mali işlem var. Yeni adisyon işlemi başlatmadan önce o işletmeye dönüp sonucu doğrulayın.');
      }
    } catch (error) {
      setTickets([]);
      setPage(null);
      setSelected(null);
      setNotice(error instanceof Error ? error.message : 'Adisyonlar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId, initialTicketId, loadLookups, loadTicket, loadTickets]);

  useEffect(() => { void load(); }, [load, scopeEpoch]);

  async function mutation(
    action: string,
    path: string,
    init: RequestInit,
    success: string,
    ticketId?: string,
  ) {
    if (pendingAmbiguity
      && (pendingAmbiguity.businessId !== activeBusinessId || pendingAmbiguity.action !== action)) {
      setNotice(pendingAmbiguity.businessId === activeBusinessId
        ? 'Önce sonucu belirsiz işlemi aynı bilgilerle tekrar doğrulayın. Yeni bir mali işlem başlatılmadı.'
        : 'Başka bir işletmede sonucu belirsiz mali işlem var. O işletmeye dönüp aynı işlemi doğrulamadan yeni adisyon işlemi başlatılmadı.');
      return null;
    }
    setBusy(true);
    setNotice('');
    const key = pendingAmbiguity?.businessId === activeBusinessId && pendingAmbiguity.action === action
      ? pendingAmbiguity.idempotencyKey
      : keyFor(keys.current, action);
    keys.current.set(action, key);
    const ambiguityIdentity = { businessId: activeBusinessId, action, idempotencyKey: key };
    try {
      const result = await api<{ ticket: TicketContract }>(path, {
        ...init,
        headers: { ...(init.headers ?? {}), 'Idempotency-Key': key },
        timeoutMs: 12_000,
      });
      keys.current.delete(action);
      clearPendingAmbiguity(ambiguityIdentity);
      setPendingAmbiguity((current) => samePendingAmbiguity(current, ambiguityIdentity) ? null : current);
      const id = result.ticket.ticketId ?? ticketId;
      if (id) await loadTicket(id);
      await loadTickets(false);
      setNotice(success);
      return result.ticket;
    } catch (error) {
      if (ambiguous(error)) {
        writePendingAmbiguity(ambiguityIdentity);
        setPendingAmbiguity(ambiguityIdentity);
        setNotice('İşlemin sonucu henüz doğrulanamadı. Aynı işlem ve tutarla tekrar deneyin; aynı anahtar kullanılacak ve ekran ödendi varsaymıyor.');
      } else {
        keys.current.delete(action);
        clearPendingAmbiguity(ambiguityIdentity);
        setPendingAmbiguity((current) => samePendingAmbiguity(current, ambiguityIdentity) ? null : current);
        if (ticketId) {
          try { await loadTicket(ticketId); } catch { /* retain the server error message */ }
        }
        setNotice(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createWalkIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const customerId = String(data.get('customerId') ?? '');
    if (!customerId) return setNotice('Müşteri seçin.');
    const ticket = await mutation(
      `walkin:${customerId}`,
      '/api/tickets',
      { method: 'POST', body: JSON.stringify({ customerId }) },
      'Yeni adisyon açıldı.',
    );
    if (ticket) setSelected(ticket);
  }

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const serviceId = String(data.get('serviceId') ?? '');
    const staffId = String(data.get('staffId') ?? '') || null;
    await mutation(
      `line:${selected.ticketId}:${selected.version}:${serviceId}:${staffId ?? 'none'}`,
      `/api/tickets/${selected.ticketId}/service-lines`,
      { method: 'POST', body: JSON.stringify({ serviceId, staffId, expectedVersion: selected.version }) },
      'Hizmet satırı eklendi.',
      selected.ticketId,
    );
  }

  async function finalizePrice(event: FormEvent<HTMLFormElement>, line: TicketLine) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const amountMinor = parseMoney(data.get('amount'));
    const reason = String(data.get('reason') ?? '').trim();
    if (amountMinor === null || reason.length < 2) return setNotice('Kesin tutar ve gerekçe gerekli.');
    await mutation(
      `finalize:${selected.ticketId}:${line.lineId}:${selected.version}`,
      `/api/tickets/${selected.ticketId}/lines/${line.lineId}/finalize-price`,
      { method: 'POST', body: JSON.stringify({ finalUnitPriceMinor: amountMinor, reason, expectedVersion: selected.version }) },
      'Hizmet tutarı kesinleştirildi.',
      selected.ticketId,
    );
  }

  async function discount(event: FormEvent<HTMLFormElement>, line: TicketLine) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const amountMinor = parseMoney(data.get('amount'));
    const reason = String(data.get('reason') ?? '').trim();
    if (amountMinor === null || reason.length < 2) return setNotice('İskonto tutarı ve gerekçe gerekli.');
    await mutation(
      `discount:${selected.ticketId}:${line.lineId}:${selected.version}`,
      `/api/tickets/${selected.ticketId}/lines/${line.lineId}/discount`,
      { method: 'PUT', body: JSON.stringify({ discountMinor: amountMinor, reason, expectedVersion: selected.version }) },
      'İskonto güncellendi.',
      selected.ticketId,
    );
  }

  async function payment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const amountMinor = parseMoney(data.get('amount'));
    const method = data.get('method');
    if (amountMinor === null || (method !== 'cash' && method !== 'card')) return setNotice('Tahsilat yöntemi ve tutarı gerekli.');
    await mutation(
      `payment:${selected.ticketId}:${method}:${amountMinor}`,
      `/api/tickets/${selected.ticketId}/payments`,
      { method: 'POST', body: JSON.stringify({ method, amountMinor }) },
      'Tahsilat sunucuda doğrulandı.',
      selected.ticketId,
    );
  }

  async function correction(event: FormEvent<HTMLFormElement>, paymentEvent: PaymentEvent) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const amountMinor = parseMoney(data.get('amount'));
    const direction = data.get('direction');
    const reason = String(data.get('reason') ?? '').trim();
    if (amountMinor === null || (direction !== 'increase' && direction !== 'decrease') || reason.length < 2) return setNotice('Düzeltme yönü, tutarı ve gerekçe gerekli.');
    await mutation(
      `correction:${selected.ticketId}:${paymentEvent.eventId}:${direction}:${amountMinor}`,
      `/api/tickets/${selected.ticketId}/payments/${paymentEvent.eventId}/corrections`,
      { method: 'POST', body: JSON.stringify({ direction, amountMinor, reason }) },
      'Düzeltme hareketi kaydedildi.',
      selected.ticketId,
    );
  }

  async function refund(event: FormEvent<HTMLFormElement>, paymentEvent: PaymentEvent) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const amountMinor = parseMoney(data.get('amount'));
    const reason = String(data.get('reason') ?? '').trim();
    if (amountMinor === null || reason.length < 2) return setNotice('İade tutarı ve gerekçe gerekli.');
    await mutation(
      `refund:${selected.ticketId}:${paymentEvent.eventId}:${amountMinor}`,
      `/api/tickets/${selected.ticketId}/payments/${paymentEvent.eventId}/refunds`,
      { method: 'POST', body: JSON.stringify({ amountMinor, reason }) },
      'İade hareketi kaydedildi.',
      selected.ticketId,
    );
  }

  async function lifecycle(kind: 'close' | 'cancel') {
    if (!selected) return;
    const reason = kind === 'cancel' ? window.prompt('İptal gerekçesi')?.trim() : null;
    if (kind === 'cancel' && (!reason || reason.length < 2)) return;
    await mutation(
      `${kind}:${selected.ticketId}:${selected.version}`,
      `/api/tickets/${selected.ticketId}/${kind}`,
      {
        method: 'POST',
        body: JSON.stringify(kind === 'close'
          ? { expectedVersion: selected.version }
          : { expectedVersion: selected.version, reason }),
      },
      kind === 'close' ? 'Adisyon kapatıldı.' : 'Adisyon iptal edildi.',
      selected.ticketId,
    );
  }

  if (loading) return <div className="ticket-page" role="main" aria-busy="true"><p>Adisyonlar hazırlanıyor…</p></div>;

  return (
    <div className="ticket-page" role="main">
      <div className="ticket-toolbar">
        <div><p className="ticket-eyebrow">ADİSYONLAR</p><h1>Kasa ve adisyon</h1></div>
        <label>Durum
          <select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setSelected(null); }}>
            <option value="open">Açık</option><option value="closed">Kapalı</option><option value="cancelled">İptal</option><option value="all">Tümü</option>
          </select>
        </label>
      </div>

      {notice && <div className="ticket-notice" role="status">{notice}</div>}

      <form className="ticket-walkin" onSubmit={createWalkIn}>
        <label>Randevusuz adisyon
          <select name="customerId" required defaultValue="">
            <option value="" disabled>Müşteri seçin</option>
            {customers.map((customer) => <option key={customer.customer_id} value={customer.customer_id}>{customer.name}</option>)}
          </select>
        </label>
        <button disabled={busy}>Yeni adisyon</button>
      </form>

      <div className="ticket-layout">
        <section className="ticket-list" aria-label="Adisyon listesi">
          {tickets.length ? tickets.map((ticket) => (
            <button key={ticket.ticketId} type="button" className={selected?.ticketId === ticket.ticketId ? 'selected' : ''} onClick={() => void loadTicket(ticket.ticketId)}>
              <strong>{ticket.customerName}</strong>
              <span>{ticket.source === 'booking_group' ? 'Randevu' : 'Randevusuz'} · {ticket.status}</span>
              <small>{money(ticket.totalMinor, ticket.currency)} · {ticket.paymentStatus} · kalan {money(ticket.balanceMinor, ticket.currency)}</small>
            </button>
          )) : <p>Açık filtrede adisyon yok.</p>}
          {page?.hasMore && page.nextCursor && <button type="button" disabled={busy} onClick={() => void loadTickets(true, page.nextCursor)}>Daha fazla</button>}
        </section>

        <section className="ticket-detail">
          {selected ? (
            <>
              <header>
                <div><p className="ticket-eyebrow">{selected.source === 'booking_group' ? 'RANDEVU ADİSYONU' : 'RANDEVUSUZ'}</p><h2>{selected.customerName}</h2></div>
                <span>{selected.status} · {selected.paymentStatus}</span>
              </header>

              <div className="ticket-totals" aria-label="Sunucu mali özeti">
                <div><span>Ara toplam</span><strong>{money(selected.subtotalMinor, selected.currency)}</strong></div>
                <div><span>İskonto</span><strong>{money(selected.discountMinor, selected.currency)}</strong></div>
                <div><span>Toplam</span><strong>{money(selected.totalMinor, selected.currency)}</strong></div>
                <div><span>Tahsil</span><strong>{money(selected.paidMinor, selected.currency)}</strong></div>
                <div><span>Kalan</span><strong>{money(selected.balanceMinor, selected.currency)}</strong></div>
              </div>

              <div className="ticket-lines">
                {selected.lines.map((line) => (
                  <article key={line.lineId}>
                    <div><strong>{line.serviceName}</strong><span>{line.staffName ?? 'Personel seçilmedi'} · {money(line.netMinor, line.currency)}</span></div>
                    {selected.status === 'open' && line.priceType === 'range' && line.finalUnitPriceMinor === null && (
                      <form onSubmit={(event) => void finalizePrice(event, line)}>
                        <input name="amount" inputMode="decimal" placeholder="Kesin tutar" required />
                        <input name="reason" placeholder="Gerekçe" minLength={2} required />
                        <button disabled={busy}>Tutarı kesinleştir</button>
                      </form>
                    )}
                    {selected.status === 'open' && line.finalUnitPriceMinor !== null && (
                      <form onSubmit={(event) => void discount(event, line)}>
                        <input name="amount" inputMode="decimal" placeholder="İskonto" required />
                        <input name="reason" placeholder="Gerekçe" minLength={2} required />
                        <button disabled={busy}>İskontoyu kaydet</button>
                      </form>
                    )}
                  </article>
                ))}
              </div>

              {selected.status === 'open' && (
                <form className="ticket-add-line" onSubmit={addService}>
                  <select name="serviceId" required defaultValue=""><option value="" disabled>Hizmet seçin</option>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
                  <select name="staffId" defaultValue=""><option value="">Personelsiz</option>{activeStaff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select>
                  <button disabled={busy}>Hizmet ekle</button>
                </form>
              )}

              {selected.status === 'open' && selected.settlementReady && selected.balanceMinor !== null && selected.balanceMinor > 0 && (
                <form className="ticket-payment" onSubmit={payment}>
                  <select name="method" defaultValue="cash"><option value="cash">Nakit</option><option value="card">Kart</option></select>
                  <input name="amount" inputMode="decimal" placeholder="Tahsilat" required />
                  <button disabled={busy}>Tahsilatı kaydet</button>
                </form>
              )}

              <div className="ticket-events">
                <h3>İşlem geçmişi</h3>
                {selected.paymentEvents.length ? selected.paymentEvents.map((item) => (
                  <article key={item.eventId}>
                    <div><strong>{item.eventType === 'payment' ? (item.method === 'cash' ? 'Nakit tahsilat' : 'Kart tahsilatı') : item.eventType === 'refund' ? 'İade' : 'Düzeltme'}</strong><span>{money(item.effectMinor, selected.currency)} · {localDate(item.createdAt)}</span></div>
                    {selected.status !== 'cancelled' && item.eventType === 'payment' && (
                      <div className="ticket-event-actions">
                        <form onSubmit={(event) => void correction(event, item)}>
                          <select name="direction" defaultValue="decrease"><option value="decrease">Azalt</option><option value="increase">Artır</option></select>
                          <input name="amount" inputMode="decimal" placeholder="Tutar" required />
                          <input name="reason" placeholder="Gerekçe" minLength={2} required />
                          <button disabled={busy}>Düzelt</button>
                        </form>
                        <form onSubmit={(event) => void refund(event, item)}>
                          <input name="amount" inputMode="decimal" placeholder="İade" required />
                          <input name="reason" placeholder="Gerekçe" minLength={2} required />
                          <button disabled={busy}>İade</button>
                        </form>
                      </div>
                    )}
                  </article>
                )) : <p>Henüz tahsilat hareketi yok.</p>}
              </div>

              {selected.status === 'open' && (
                <div className="ticket-lifecycle">
                  <button type="button" disabled={busy || !selected.settlementReady || selected.balanceMinor !== 0} onClick={() => void lifecycle('close')}>Adisyonu kapat</button>
                  <button type="button" disabled={busy} onClick={() => void lifecycle('cancel')}>Adisyonu iptal et</button>
                </div>
              )}
            </>
          ) : <div className="ticket-empty"><h2>Bir adisyon seçin</h2><p>Satırlar, server toplamları ve tahsilat geçmişi burada görünür.</p></div>}
        </section>
      </div>
    </div>
  );
}
