import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiRequestError, api } from '../api';
import type { ManagedCatalog } from '../CatalogSettingsPanel';
import type { ServicePackage } from '../ServicePackagesPanel';
import { promoValueText } from '../PublicPromo';
import { useWorkspace } from '../workspace-context';
import './ticket-cashier.css';

type PageInfo = { limit: number; hasMore: boolean; nextCursor: string | null };
type TicketLine = {
  lineId: string;
  ordinal: number;
  sourceType: 'service' | 'product' | 'package';
  sourceAppointmentLineId: string | null;
  serviceId: string | null;
  staffId: string | null;
  serviceName: string | null;
  staffName: string | null;
  productId: string | null;
  productName: string | null;
  productCode: string | null;
  quantity: number;
  priceType: 'fixed' | 'range';
  priceMinMinor: number;
  priceMaxMinor: number;
  currency: string;
  pricePolicyVersion: number;
  finalUnitPriceMinor: number | null;
  discountMinor: number;
  netMinor: number | null;
  returnedQuantity?: number;
  finalizedAt: string | null;
  finalizationReason: string | null;
  discountAt: string | null;
  discountReason: string | null;
  packageId?: string | null;
  packageName?: string | null;
  soldPackage?: {
    customerPackageId: string;
    status: 'active' | 'cancelled' | 'refunded';
    sessionsTotal: number;
    sessionsUsed: number;
    expiresAt: string;
    refundPreviewMinor: number | null;
    refundValueMinor: number | null;
    refundedSessions: number | null;
  } | null;
  packageCoverage?: {
    usageId: string;
    customerPackageId: string;
    packageName: string;
    valueMinor: number;
  } | null;
};
type CustomerPackage = {
  customerPackageId: string;
  customerId: string;
  serviceId: string;
  packageName: string;
  serviceName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  currency: string;
  status: 'active' | 'cancelled' | 'refunded';
  expiresAt: string;
  expired: boolean;
  saleTicketId: string;
  saleTicketStatus: 'open' | 'closed' | 'cancelled';
  refundPreviewMinor: number | null;
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
  packageCoveredMinor?: number | null;
  returnedMinor?: number;
  packageRefundedMinor?: number;
  promoDiscountMinor?: number;
  promo?: {
    redemptionId: string;
    code: string;
    kind: 'percent' | 'fixed';
    percentBps: number | null;
    amountMinor: number | null;
    source: 'booking' | 'ticket';
    status: 'reserved' | 'consumed';
  } | null;
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
type StockProduct = {
  productId: string;
  businessId: string;
  name: string;
  code: string | null;
  salePriceMinor: number;
  currency: string;
  stockOnHand: number;
  version: number;
  active: boolean;
};
type ProductList = { products: StockProduct[]; page: PageInfo };
type TicketList = { tickets: TicketContract[]; page: PageInfo };
type PendingAmbiguity = {
  businessId: string;
  action: string;
  idempotencyKey: string;
  path: string;
  method: string;
  body: string | null;
  success: string;
  ticketId: string | null;
};

const PENDING_AMBIGUITY_STORAGE_KEY = 'randevu:ticket-cashier:pending-ambiguity:v2';

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
      || typeof parsed.path !== 'string'
      || typeof parsed.method !== 'string'
      || (parsed.body !== null && typeof parsed.body !== 'string')
      || typeof parsed.success !== 'string'
      || (parsed.ticketId !== null && typeof parsed.ticketId !== 'string')
      || !parsed.businessId
      || !parsed.action
      || !parsed.idempotencyKey
      || !parsed.path.startsWith('/api/tickets')
      || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(parsed.method)
      || !parsed.success) {
      window.sessionStorage.removeItem(PENDING_AMBIGUITY_STORAGE_KEY);
      return null;
    }
    return {
      businessId: parsed.businessId,
      action: parsed.action,
      idempotencyKey: parsed.idempotencyKey,
      path: parsed.path,
      method: parsed.method,
      body: parsed.body,
      success: parsed.success,
      ticketId: parsed.ticketId,
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

function shortDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(new Date(value));
}

function packageStatusLabel(status: 'active' | 'cancelled' | 'refunded') {
  if (status === 'active') return 'aktif';
  if (status === 'refunded') return 'iade edildi';
  return 'iptal edildi';
}

// F16-05: the proportional refund amount comes from the server; the cashier only
// spreads it over the ticket's own payments by their remaining net amount.
function refundSources(ticket: TicketContract, amountMinor: number) {
  let remaining = amountMinor;
  const sources: Array<{ paymentEventId: string; amountMinor: number; method: PaymentEvent['method'] }> = [];
  for (const payment of ticket.paymentEvents.filter((event) => event.eventType === 'payment')) {
    if (remaining <= 0) break;
    const net = payment.amountMinor + ticket.paymentEvents
      .filter((event) => event.sourcePaymentEventId === payment.eventId)
      .reduce((sum, event) => sum + event.effectMinor, 0);
    if (net <= 0) continue;
    const take = Math.min(net, remaining);
    sources.push({ paymentEventId: payment.eventId, amountMinor: take, method: payment.method });
    remaining -= take;
  }
  return remaining === 0 ? sources : null;
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
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [servicePackages, setServicePackages] = useState<ServicePackage[]>([]);
  const [customerPackages, setCustomerPackages] = useState<CustomerPackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingAmbiguity, setPendingAmbiguity] = useState<PendingAmbiguity | null>(() => readPendingAmbiguity());
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialTicketId = initialParams.get('ticketId');
  const initialCustomerId = initialParams.get('customerId');
  const showStandaloneProductSale = initialParams.get('newProductSale') === '1';
  const showStandalonePackageSale = initialParams.get('newPackageSale') === '1';
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
    const [customerResult, nextCatalog, productResult, packageResult] = await Promise.all([
      api<CustomerList>('/api/customers?limit=100'),
      api<ManagedCatalog>('/api/catalog'),
      api<ProductList>('/api/products?limit=100&includeArchived=false'),
      // Packages are an optional sale path; a package-list outage must not
      // take the cashier (payments, closing) down with it.
      api<{ packages: ServicePackage[] }>('/api/service-packages').catch(() => ({ packages: [] as ServicePackage[] })),
    ]);
    if (nextCatalog.membership.business_id !== activeBusinessId) throw new Error('Katalog seçili işletmeyle eşleşmiyor.');
    if (productResult.products.some((product) => product.businessId !== activeBusinessId)) {
      throw new Error('Ürün kataloğu seçili işletmeyle eşleşmiyor.');
    }
    if (packageResult.packages.some((item) => item.businessId !== activeBusinessId)) {
      throw new Error('Paket kataloğu seçili işletmeyle eşleşmiyor.');
    }
    setCustomers(customerResult.customers);
    setCatalog(nextCatalog);
    setProducts(productResult.products.filter((product) => product.active));
    setServicePackages(packageResult.packages.filter((item) => item.active));
  }, [activeBusinessId]);

  const selectedCustomerId = selected?.customerId ?? null;
  const selectedVersion = selected?.version ?? null;
  const selectedStatus = selected?.status ?? null;
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerPackages([]);
      return;
    }
    let current = true;
    api<{ packages: CustomerPackage[] }>(`/api/customer-packages?customerId=${selectedCustomerId}&includeClosed=true`)
      .then((result) => {
        if (current) setCustomerPackages(result.packages.filter((item) => item.customerId === selectedCustomerId));
      })
      .catch(() => { if (current) setCustomerPackages([]); });
    return () => { current = false; };
  }, [selectedCustomerId, selectedVersion, selectedStatus]);

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
    const method = String(init.method ?? 'POST').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : null;
    const pendingRequestMatches = Boolean(pendingAmbiguity
      && pendingAmbiguity.businessId === activeBusinessId
      && pendingAmbiguity.action === action
      && pendingAmbiguity.path === path
      && pendingAmbiguity.method === method
      && pendingAmbiguity.body === body);
    if (pendingAmbiguity && !pendingRequestMatches) {
      setNotice(pendingAmbiguity.businessId === activeBusinessId
        ? 'Önce sonucu belirsiz işlemi kayıtlı istekle doğrulayın. Yeni bir mali işlem başlatılmadı.'
        : 'Başka bir işletmede sonucu belirsiz mali işlem var. O işletmeye dönüp kayıtlı isteği doğrulamadan yeni adisyon işlemi başlatılmadı.');
      return null;
    }
    setBusy(true);
    setNotice('');
    const key = pendingRequestMatches
      ? pendingAmbiguity!.idempotencyKey
      : keyFor(keys.current, action);
    keys.current.set(action, key);
    const ambiguityIdentity: PendingAmbiguity = {
      businessId: activeBusinessId,
      action,
      idempotencyKey: key,
      path,
      method,
      body,
      success,
      ticketId: ticketId ?? null,
    };
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

  async function retryPendingAmbiguity() {
    const pending = pendingAmbiguity;
    if (!pending) return;
    if (pending.businessId !== activeBusinessId) {
      setNotice('Belirsiz işlemi doğrulamak için önce işlemin başladığı işletmeye dönün.');
      return;
    }
    await mutation(
      pending.action,
      pending.path,
      { method: pending.method, body: pending.body ?? undefined },
      pending.success,
      pending.ticketId ?? undefined,
    );
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

  // F16-08: the SalonApp "Yeni paket satışı" action opens a package sale as its
  // own ticket (the F16-05 package-sale route), like a standalone product sale.
  async function createPackageSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const customerId = String(data.get('customerId') ?? '');
    const packageId = String(data.get('packageId') ?? '');
    const item = servicePackages.find((row) => row.packageId === packageId);
    if (!customerId || !item) return setNotice('Müşteri ve paket seçin.');
    const ticket = await mutation(
      `package-sale:${customerId}:${packageId}:${item.version}`,
      '/api/tickets/package-sales',
      {
        method: 'POST',
        body: JSON.stringify({ customerId, packageId, expectedPackageVersion: item.version }),
      },
      'Paket satışı adisyona dönüştürüldü.',
    );
    if (ticket) {
      setSelected(ticket);
      form.reset();
      await loadLookups();
    }
  }

  async function createProductSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const customerId = String(data.get('customerId') ?? '');
    const productId = String(data.get('productId') ?? '');
    const quantity = Number(data.get('quantity'));
    const product = products.find((item) => item.productId === productId);
    if (!customerId || !product || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      return setNotice('Müşteri, ürün ve satış miktarı gerekli.');
    }
    const ticket = await mutation(
      `product-sale:${customerId}:${productId}:${product.version}:${quantity}`,
      '/api/tickets/product-sales',
      {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          productId,
          quantity,
          expectedProductVersion: product.version,
        }),
      },
      'Ürün satışı adisyona dönüştürüldü.',
    );
    if (ticket) {
      setSelected(ticket);
      form.reset();
      await loadLookups();
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const productId = String(data.get('productId') ?? '');
    const quantity = Number(data.get('quantity'));
    const product = products.find((item) => item.productId === productId);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      return setNotice('Ürün ve satış miktarı gerekli.');
    }
    const ticket = await mutation(
      `product-line:${selected.ticketId}:${selected.version}:${productId}:${product.version}:${quantity}`,
      `/api/tickets/${selected.ticketId}/product-lines`,
      {
        method: 'POST',
        body: JSON.stringify({
          productId,
          quantity,
          expectedVersion: selected.version,
          expectedProductVersion: product.version,
        }),
      },
      'Ürün adisyona eklendi ve stok sunucuda düşüldü.',
      selected.ticketId,
    );
    if (ticket) {
      form.reset();
      await loadLookups();
    }
  }

  async function productReturnRefund(event: FormEvent<HTMLFormElement>, line: TicketLine) {
    event.preventDefault();
    if (!selected || line.sourceType !== 'product') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const sourcePaymentEventId = String(data.get('sourcePaymentEventId') ?? '');
    const quantity = Number(data.get('quantity'));
    const amountMinor = parseMoney(data.get('amount'));
    const reason = String(data.get('reason') ?? '').trim();
    const returnToStock = data.get('returnToStock') === 'on';
    if (!sourcePaymentEventId || !Number.isInteger(quantity) || quantity < 1 || amountMinor === null || reason.length < 2) {
      return setNotice('İade kaynağı, miktarı, tutarı ve gerekçesi gerekli.');
    }
    const ticket = await mutation(
      `product-return:${selected.ticketId}:${line.lineId}:${sourcePaymentEventId}:${quantity}:${amountMinor}:${returnToStock}`,
      `/api/tickets/${selected.ticketId}/lines/${line.lineId}/product-return-refund`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourcePaymentEventId,
          quantity,
          amountMinor,
          returnToStock,
          reason,
        }),
      },
      returnToStock
        ? 'Ürün iadesi ve stoğa geri dönüş birlikte doğrulandı.'
        : 'Finansal iade kaydedildi; ürün stoğa geri alınmadı.',
      selected.ticketId,
    );
    if (ticket) {
      form.reset();
      await loadLookups();
    }
  }

  async function addPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const packageId = String(new FormData(form).get('packageId') ?? '');
    const item = servicePackages.find((row) => row.packageId === packageId);
    if (!item) return setNotice('Satılacak paketi seçin.');
    const ticket = await mutation(
      `package-line:${selected.ticketId}:${selected.version}:${packageId}:${item.version}`,
      `/api/tickets/${selected.ticketId}/package-lines`,
      {
        method: 'POST',
        body: JSON.stringify({ packageId, expectedVersion: selected.version, expectedPackageVersion: item.version }),
      },
      'Paket adisyona eklendi. Seanslar tahsilat ve kapanıştan sonra diğer ziyaretlerde de kullanılabilir.',
      selected.ticketId,
    );
    if (ticket) form.reset();
  }

  async function applyPackage(event: FormEvent<HTMLFormElement>, line: TicketLine) {
    event.preventDefault();
    if (!selected) return;
    const customerPackageId = String(new FormData(event.currentTarget).get('customerPackageId') ?? '');
    if (!customerPackageId) return setNotice('Kullanılacak paketi seçin.');
    await mutation(
      `package-use:${selected.ticketId}:${selected.version}:${line.lineId}:${customerPackageId}`,
      `/api/tickets/${selected.ticketId}/lines/${line.lineId}/package-usage`,
      { method: 'POST', body: JSON.stringify({ customerPackageId, expectedVersion: selected.version }) },
      'Seans paketten düşüldü; hizmet satırı paket hakkıyla karşılandı.',
      selected.ticketId,
    );
  }

  async function reversePackage(event: FormEvent<HTMLFormElement>, line: TicketLine) {
    event.preventDefault();
    if (!selected) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (reason.length < 2) return setNotice('Geri alma gerekçesi girin.');
    await mutation(
      `package-reverse:${selected.ticketId}:${selected.version}:${line.lineId}`,
      `/api/tickets/${selected.ticketId}/lines/${line.lineId}/package-usage/reverse`,
      { method: 'POST', body: JSON.stringify({ reason, expectedVersion: selected.version }) },
      'Paket kullanımı geri alındı; seans pakete iade edildi.',
      selected.ticketId,
    );
  }

  async function refundPackage(event: FormEvent<HTMLFormElement>, line: TicketLine) {
    event.preventDefault();
    const sold = line.soldPackage;
    if (!selected || !sold || sold.refundPreviewMinor === null) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (reason.length < 2) return setNotice('İade gerekçesi girin.');
    const sources = refundSources(selected, sold.refundPreviewMinor);
    if (!sources) return setNotice('Bu adisyonun tahsilatları iade tutarını karşılamıyor.');
    await mutation(
      `package-refund:${sold.customerPackageId}:${sold.refundPreviewMinor}`,
      `/api/customer-packages/${sold.customerPackageId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({
          expectedRefundMinor: sold.refundPreviewMinor,
          sources: sources.map(({ paymentEventId, amountMinor }) => ({ paymentEventId, amountMinor })),
          reason,
        }),
      },
      'Kullanılmayan seanslar oranında paket iadesi kaydedildi.',
      selected.ticketId,
    );
  }

  async function applyPromo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/.test(code)) return setNotice('Kampanya kodu 3–32 harf, rakam veya tire olmalı.');
    const ticket = await mutation(
      `promo-apply:${selected.ticketId}:${selected.version}:${code.toUpperCase()}`,
      `/api/tickets/${selected.ticketId}/promo`,
      { method: 'POST', body: JSON.stringify({ code, expectedVersion: selected.version }) },
      'Kampanya kodu adisyona uygulandı; indirim sunucuda hesaplandı.',
      selected.ticketId,
    );
    if (ticket) form.reset();
  }

  async function removePromo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (reason.length < 2) return setNotice('Kaldırma gerekçesi girin.');
    await mutation(
      `promo-remove:${selected.ticketId}:${selected.version}`,
      `/api/tickets/${selected.ticketId}/promo/remove`,
      { method: 'POST', body: JSON.stringify({ reason, expectedVersion: selected.version }) },
      'Kampanya kodu adisyondan kaldırıldı; kodun kullanım hakkı serbest kaldı.',
      selected.ticketId,
    );
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

      {notice && (
        <div className="ticket-notice" role="status">
          <span>{notice}</span>
          {pendingAmbiguity?.businessId === activeBusinessId && (
            <button type="button" disabled={busy} onClick={() => void retryPendingAmbiguity()}>
              Belirsiz işlemi doğrula
            </button>
          )}
        </div>
      )}

      {showStandaloneProductSale && (
        <form className="ticket-product-sale" onSubmit={createProductSale}>
          <label>Yeni ürün satışı
            <select name="customerId" required defaultValue="">
              <option value="" disabled>Müşteri seçin</option>
              {customers.map((customer) => <option key={customer.customer_id} value={customer.customer_id}>{customer.name}</option>)}
            </select>
          </label>
          <select name="productId" required defaultValue="">
            <option value="" disabled>Ürün seçin</option>
            {products.map((product) => <option key={product.productId} value={product.productId}>{product.name} · stok {product.stockOnHand}</option>)}
          </select>
          <input name="quantity" inputMode="numeric" type="number" min="1" max="1000" defaultValue="1" required />
          <button disabled={busy}>Ürün satışını oluştur</button>
        </form>
      )}

      {showStandalonePackageSale && (
        <form className="ticket-product-sale ticket-package-sale" onSubmit={createPackageSale}>
          <label>Yeni paket satışı
            <select name="customerId" required defaultValue="">
              <option value="" disabled>Müşteri seçin</option>
              {customers.map((customer) => <option key={customer.customer_id} value={customer.customer_id}>{customer.name}</option>)}
            </select>
          </label>
          {servicePackages.length === 0 ? (
            <p className="ticket-empty">Satılabilir paket yok. Önce Hizmetler sayfasından paket tanımlayın.</p>
          ) : (
            <select name="packageId" required defaultValue="" aria-label="Satılacak paket">
              <option value="" disabled>Paket seçin</option>
              {servicePackages.map((item) => (
                <option key={item.packageId} value={item.packageId}>{item.name} · {item.sessionCount} seans · {money(item.priceMinor, item.currency)}</option>
              ))}
            </select>
          )}
          <button disabled={busy || servicePackages.length === 0}>Paket satışını oluştur</button>
        </form>
      )}

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
                <div><span>İskonto</span><strong>{money(selected.discountMinor === null ? null : selected.discountMinor - (selected.packageCoveredMinor ?? 0), selected.currency)}</strong></div>
                {(selected.packageCoveredMinor ?? 0) > 0 && (
                  <div><span>Paket hakkı</span><strong>{money(selected.packageCoveredMinor ?? 0, selected.currency)}</strong></div>
                )}
                {selected.promo && (
                  <div><span>Kampanya ({selected.promo.code})</span><strong>{money(-(selected.promoDiscountMinor ?? 0), selected.currency)}</strong></div>
                )}
                {(selected.packageRefundedMinor ?? 0) > 0 && (
                  <div><span>Paket iadesi</span><strong>{money(selected.packageRefundedMinor ?? 0, selected.currency)}</strong></div>
                )}
                {(selected.returnedMinor ?? 0) > 0 && (
                  <div><span>İade</span><strong>{money(selected.returnedMinor ?? 0, selected.currency)}</strong></div>
                )}
                <div><span>Toplam</span><strong>{money(selected.totalMinor, selected.currency)}</strong></div>
                <div><span>Tahsil</span><strong>{money(selected.paidMinor, selected.currency)}</strong></div>
                <div><span>Kalan</span><strong>{money(selected.balanceMinor, selected.currency)}</strong></div>
              </div>

              <div className="ticket-lines">
                {selected.lines.map((line) => (
                  <article key={line.lineId}>
                    <div>
                      <strong>{line.sourceType === 'product' ? (line.productName ?? 'Ürün') : line.sourceType === 'package' ? (line.packageName ?? 'Paket') : line.serviceName}</strong>
                      <span>{line.sourceType === 'product'
                        ? `${line.productCode ?? 'Kodsuz'} · ${line.quantity} adet${(line.returnedQuantity ?? 0) > 0 ? ` · ${line.returnedQuantity} iade` : ''} · ${money(line.netMinor, line.currency)}`
                        : line.sourceType === 'package'
                          ? `Paket satışı${line.soldPackage ? ` · ${line.soldPackage.sessionsTotal} seans · ${line.soldPackage.sessionsUsed} kullanıldı · ${packageStatusLabel(line.soldPackage.status)} · son gün ${shortDate(line.soldPackage.expiresAt)}` : ''} · ${money(line.netMinor, line.currency)}`
                          : line.packageCoverage
                            ? `${line.staffName ?? 'Personel seçilmedi'} · Paket hakkı: ${line.packageCoverage.packageName} · ${money(line.netMinor, line.currency)}`
                            : `${line.staffName ?? 'Personel seçilmedi'} · ${money(line.netMinor, line.currency)}`}</span>
                    </div>
                    {selected.status === 'open' && line.sourceType === 'service' && line.priceType === 'range' && line.finalUnitPriceMinor === null && (
                      <form onSubmit={(event) => void finalizePrice(event, line)}>
                        <input name="amount" inputMode="decimal" placeholder="Kesin tutar" required />
                        <input name="reason" placeholder="Gerekçe" minLength={2} required />
                        <button disabled={busy}>Tutarı kesinleştir</button>
                      </form>
                    )}
                    {selected.status === 'open' && line.sourceType === 'service' && line.finalUnitPriceMinor !== null && !line.packageCoverage && line.discountMinor === 0
                      && customerPackages.some((item) => item.status === 'active' && !item.expired && item.sessionsRemaining > 0
                        && item.serviceId === line.serviceId
                        && (item.saleTicketStatus === 'closed' || item.saleTicketId === selected.ticketId)) && (
                      <form className="ticket-package-use" onSubmit={(event) => void applyPackage(event, line)}>
                        <select name="customerPackageId" required defaultValue="" aria-label="Kullanılacak paket">
                          <option value="" disabled>Paket seçin</option>
                          {customerPackages.filter((item) => item.status === 'active' && !item.expired && item.sessionsRemaining > 0
                            && item.serviceId === line.serviceId
                            && (item.saleTicketStatus === 'closed' || item.saleTicketId === selected.ticketId)).map((item) => (
                            <option key={item.customerPackageId} value={item.customerPackageId}>{item.packageName} · {item.sessionsRemaining} seans kaldı</option>
                          ))}
                        </select>
                        <button disabled={busy}>Paketten düş</button>
                      </form>
                    )}
                    {selected.status === 'open' && line.packageCoverage && (
                      <form className="ticket-package-reverse" onSubmit={(event) => void reversePackage(event, line)}>
                        <input name="reason" placeholder="Geri alma gerekçesi" minLength={2} required aria-label="Paket kullanımını geri alma gerekçesi" />
                        <button disabled={busy}>Paket kullanımını geri al</button>
                      </form>
                    )}
                    {selected.status === 'closed' && line.sourceType === 'package' && line.soldPackage?.status === 'active' && line.soldPackage.refundPreviewMinor !== null && (
                      <form className="ticket-package-refund" onSubmit={(event) => void refundPackage(event, line)}>
                        <p>{line.soldPackage.sessionsTotal - line.soldPackage.sessionsUsed} kullanılmayan seans · iade {money(line.soldPackage.refundPreviewMinor, line.currency)}{(() => {
                          const sources = refundSources(selected, line.soldPackage.refundPreviewMinor);
                          if (!sources) return ' · tahsilatlar iade tutarını karşılamıyor';
                          return sources.length ? ` · ${sources.map((source) => `${source.method === 'card' ? 'Kart' : 'Nakit'} ${money(source.amountMinor, line.currency)}`).join(' + ')}` : '';
                        })()}</p>
                        <input name="reason" placeholder="İade gerekçesi" minLength={2} required aria-label="Paket iade gerekçesi" />
                        <button disabled={busy || !refundSources(selected, line.soldPackage.refundPreviewMinor)}>Kalan seansları iade et</button>
                      </form>
                    )}
                    {selected.status === 'open' && line.sourceType === 'service' && line.finalUnitPriceMinor !== null && !line.packageCoverage && (
                      <form onSubmit={(event) => void discount(event, line)}>
                        <input name="amount" inputMode="decimal" placeholder="İskonto" required />
                        <input name="reason" placeholder="Gerekçe" minLength={2} required />
                        <button disabled={busy}>İskontoyu kaydet</button>
                      </form>
                    )}
                    {line.sourceType === 'product' && line.quantity - (line.returnedQuantity ?? 0) > 0 && selected.paymentEvents.some((event) => event.eventType === 'payment') && (
                      <form className="ticket-product-return" onSubmit={(event) => void productReturnRefund(event, line)}>
                        <select name="sourcePaymentEventId" required defaultValue="">
                          <option value="" disabled>Tahsilat seçin</option>
                          {selected.paymentEvents.filter((event) => event.eventType === 'payment').map((event) => (
                            <option key={event.eventId} value={event.eventId}>{event.method === 'cash' ? 'Nakit' : 'Kart'} · {money(event.amountMinor, line.currency)}</option>
                          ))}
                        </select>
                        <input name="quantity" type="number" inputMode="numeric" min="1" max={line.quantity - (line.returnedQuantity ?? 0)} defaultValue="1" required />
                        <input name="amount" inputMode="decimal" placeholder={`İade tutarı · birim ${money(line.finalUnitPriceMinor, line.currency)}`} required />
                        <input name="reason" placeholder="İade gerekçesi" minLength={2} required />
                        <label><input name="returnToStock" type="checkbox" /> Satılabilir stoğa geri al</label>
                        <button disabled={busy}>Ürün iadesini kaydet</button>
                      </form>
                    )}
                  </article>
                ))}
              </div>

              {selected.status === 'open' && (
                <form className="ticket-add-product" onSubmit={addProduct}>
                  <select name="productId" required defaultValue=""><option value="" disabled>Ürün seçin</option>{products.map((product) => <option key={product.productId} value={product.productId}>{product.name} · stok {product.stockOnHand}</option>)}</select>
                  <input name="quantity" type="number" inputMode="numeric" min="1" max="1000" defaultValue="1" required />
                  <button disabled={busy}>Ürün ekle</button>
                </form>
              )}

              {selected.status === 'open' && servicePackages.length > 0 && (
                <form className="ticket-add-package" onSubmit={addPackage}>
                  <select name="packageId" required defaultValue="" aria-label="Satılacak paket">
                    <option value="" disabled>Paket seçin</option>
                    {servicePackages.filter((item) => !selected.currency || item.currency === selected.currency).map((item) => (
                      <option key={item.packageId} value={item.packageId}>{item.name} · {item.sessionCount} seans · {money(item.priceMinor, item.currency)}</option>
                    ))}
                  </select>
                  <button disabled={busy}>Paket sat</button>
                </form>
              )}

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

              {selected.status === 'open' && (selected.promo ? (
                <form className="ticket-promo" onSubmit={removePromo}>
                  <p>{selected.promo.code} · {promoValueText({ ...selected.promo, currency: selected.currency })} · {selected.promo.source === 'booking' ? 'online randevuda ayrıldı' : 'adisyonda uygulandı'}. Adisyon kapanınca kullanılmış sayılır.</p>
                  <input name="reason" placeholder="Kaldırma gerekçesi" minLength={2} required aria-label="Kampanya kodunu kaldırma gerekçesi" />
                  <button disabled={busy}>Kampanyayı kaldır</button>
                </form>
              ) : (
                <form className="ticket-promo" onSubmit={applyPromo}>
                  <input name="code" placeholder="Kampanya kodu" maxLength={32} required aria-label="Kampanya kodu" />
                  <button disabled={busy}>Kodu uygula</button>
                </form>
              ))}
              {selected.status !== 'open' && selected.promo && (
                <p className="ticket-promo-note">Kampanya {selected.promo.code}: {promoValueText({ ...selected.promo, currency: selected.currency })} · {selected.promo.status === 'consumed' ? 'kullanıldı' : 'ayrıldı'}</p>
              )}

              {customerPackages.length > 0 && (
                <div className="ticket-customer-packages" aria-label="Müşteri paketleri">
                  <h3>Müşteri paketleri</h3>
                  {customerPackages.map((item) => (
                    <article key={item.customerPackageId}>
                      <strong>{item.packageName}</strong>
                      <span>{item.serviceName} · {item.status === 'active' ? `${item.sessionsRemaining}/${item.sessionsTotal} seans kaldı` : packageStatusLabel(item.status)}{item.status === 'active' ? (item.expired ? ' · süresi doldu' : ` · son gün ${shortDate(item.expiresAt)}`) : ''}{item.status === 'active' && item.saleTicketStatus !== 'closed' ? ' · satış adisyonu kapanmadı' : ''}</span>
                    </article>
                  ))}
                </div>
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
