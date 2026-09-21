import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from './api';
import { useWorkspace } from './workspace-context';

type Role = 'owner' | 'manager' | 'staff';
type Business = { id: string; name: string; slug: string; timezone: string };
type Membership = {
  id: string;
  business_id: string;
  role: Role;
  active: boolean;
  businesses: Business | null;
};
type Customer = {
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type CustomerBookingLine = {
  appointmentId: string;
  lineOrdinal: number;
  serviceName: string;
  staffName: string;
  status: string;
  startsAt: string;
  endsAt: string;
  priceType: 'fixed' | 'range';
  priceMinMinor: number;
  priceMaxMinor: number;
  priceMinor: number | null;
  currency: string;
};
type CustomerBookingGroup = {
  groupId: string;
  status: string;
  version: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  currency: string;
  estimateMinMinor: number;
  estimateMaxMinor: number;
  lines: CustomerBookingLine[];
  legacyAppointmentId: string | null;
  managementMode: 'legacy_single' | 'group';
  lineCount: number;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
};
type PageInfo = { limit: number; hasMore: boolean; nextCursor: string | null };
type CustomerListResponse = { membership: Membership; customers: Customer[]; page: PageInfo };
type HistoryResponse = { bookings: CustomerBookingGroup[]; page: PageInfo };
type LoadState = 'idle' | 'loading' | 'success' | 'error';

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function localDateTime(value: string, timezone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('tr-TR', {
    ...(timezone ? { timeZone: timezone } : {}),
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function tryAmount(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function bookingEstimate(booking: CustomerBookingGroup) {
  return booking.estimateMinMinor === booking.estimateMaxMinor
    ? tryAmount(booking.estimateMinMinor, booking.currency)
    : `${tryAmount(booking.estimateMinMinor, booking.currency)} – ${tryAmount(booking.estimateMaxMinor, booking.currency)}`;
}

export default function CustomersPage() {
  const { session, activeMembership, activeBusinessId, scopeEpoch, selectBusiness } = useWorkspace();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerPage, setCustomerPage] = useState<PageInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<CustomerBookingGroup[]>([]);
  const [historyPage, setHistoryPage] = useState<PageInfo | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [listState, setListState] = useState<LoadState>('idle');
  const [listError, setListError] = useState('');
  const [historyState, setHistoryState] = useState<LoadState>('idle');
  const [historyError, setHistoryError] = useState('');
  const listController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const listGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const tenantGeneration = useRef(0);

  const selected = useMemo(
    () => customers.find((customer) => customer.customer_id === selectedId) ?? null,
    [customers, selectedId],
  );

  const setSelectedCustomerId = useCallback((customerId: string | null) => {
    selectedIdRef.current = customerId;
    setSelectedId(customerId);
  }, []);

  const cancelBusinessScopedReads = useCallback(() => {
    listController.current?.abort();
    historyController.current?.abort();
    ++listGeneration.current;
    ++historyGeneration.current;
    ++tenantGeneration.current;
  }, []);

  const loadCustomers = useCallback(async (query: string, cursor: string | null = null, append = false) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const generation = ++listGeneration.current;
    const tenant = tenantGeneration.current;
    const params = new URLSearchParams({ limit: '25' });
    if (query.trim()) params.set('search', query.trim());
    if (cursor) params.set('cursor', cursor);
    if (!append) {
      setListState('loading');
      setListError('');
    }
    try {
      const result = await api<CustomerListResponse>(`/api/customers?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || generation !== listGeneration.current || tenant !== tenantGeneration.current) return;
      if (result.membership.business_id !== activeBusinessId) {
        throw new Error('Müşteri kayıtları güncel işletme bağlamıyla eşleşmiyor.');
      }
      setCustomers((current) => append ? [...current, ...result.customers] : result.customers);
      setCustomerPage(result.page);
      if (!append) {
        setListState('success');
        const stillSelected = result.customers.some((row) => row.customer_id === selectedIdRef.current);
        if (!stillSelected) {
          setSelectedCustomerId(null);
          setHistory([]);
          setHistoryPage(null);
          setHistoryState('idle');
          setHistoryError('');
        }
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== listGeneration.current || tenant !== tenantGeneration.current) return;
      const text = message(error, 'Müşteriler yüklenemedi.');
      if (append) {
        setNotice(text);
      } else {
        setCustomers([]);
        setCustomerPage(null);
        setListError(text);
        setListState('error');
      }
    }
  }, [activeBusinessId, setSelectedCustomerId]);

  const loadHistory = useCallback(async (customerId: string, cursor: string | null = null, append = false) => {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    const generation = ++historyGeneration.current;
    const tenant = tenantGeneration.current;
    const params = new URLSearchParams({ limit: '25' });
    if (cursor) params.set('cursor', cursor);
    if (!append) {
      setHistoryState('loading');
      setHistoryError('');
    }
    try {
      const result = await api<HistoryResponse>(`/api/customers/${customerId}/group-history?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || generation !== historyGeneration.current || tenant !== tenantGeneration.current) return;
      setHistory((current) => append ? [...current, ...result.bookings] : result.bookings);
      setHistoryPage(result.page);
      if (!append) setHistoryState('success');
    } catch (error) {
      if (controller.signal.aborted || generation !== historyGeneration.current || tenant !== tenantGeneration.current) return;
      const text = message(error, 'Randevu geçmişi yüklenemedi.');
      if (append) {
        setNotice(text);
      } else {
        setHistory([]);
        setHistoryPage(null);
        setHistoryError(text);
        setHistoryState('error');
      }
    }
  }, []);

  const loadPage = useCallback(async () => {
    setLoading(true);
    cancelBusinessScopedReads();
    try {
      await loadCustomers('', null, false);
    } catch (error) {
      setNotice(message(error, 'Müşteri çalışma alanı yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  }, [cancelBusinessScopedReads, loadCustomers]);

  useEffect(() => {
    void loadPage();
    return () => {
      listController.current?.abort();
      historyController.current?.abort();
    };
  }, [loadPage, scopeEpoch]);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    setSelectedCustomerId(null);
    setHistory([]);
    setHistoryPage(null);
    setHistoryState('idle');
    setHistoryError('');
    await loadCustomers(search, null, false);
  }

  async function switchBusiness(businessId: string) {
    if (businessId === activeBusinessId) return;
    cancelBusinessScopedReads();
    setCustomers([]);
    setCustomerPage(null);
    setListState('idle');
    setListError('');
    setSelectedCustomerId(null);
    setHistory([]);
    setHistoryPage(null);
    setHistoryState('idle');
    setHistoryError('');
    await selectBusiness(businessId);
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await api<{ customer: Customer }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: data.get('name'),
          phone: data.get('phone'),
          email: data.get('email'),
          notes: data.get('notes'),
        }),
      });
      form.reset();
      setSearch('');
      await loadCustomers('', null, false);
      setSelectedCustomerId(result.customer.customer_id);
      await loadHistory(result.customer.customer_id);
      setNotice('Müşteri kaydı oluşturuldu.');
    } catch (error) {
      setNotice(message(error, 'Müşteri oluşturulamadı.'));
    } finally {
      setBusy(false);
    }
  }

  async function updateCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setNotice('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ customer: Customer }>(`/api/customers/${selected.customer_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedUpdatedAt: selected.updated_at,
          name: data.get('name'),
          phone: data.get('phone'),
          email: data.get('email'),
          notes: data.get('notes'),
        }),
      });
      setCustomers((current) => current.map((row) => row.customer_id === selected.customer_id ? result.customer : row));
      setNotice('Müşteri iletişim bilgileri güncellendi. Geçmiş randevu snapshotları değiştirilmedi.');
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'CUSTOMER_VERSION_CONFLICT') {
        await loadCustomers(search, null, false);
      }
      setNotice(message(error, 'Müşteri güncellenemedi.'));
    } finally {
      setBusy(false);
    }
  }

  function chooseCustomer(customerId: string) {
    setSelectedCustomerId(customerId);
    setHistory([]);
    setHistoryPage(null);
    setHistoryState('loading');
    setHistoryError('');
    setNotice('');
    void loadHistory(customerId);
  }

  if (loading) {
    return <main className="customers-shell"><section className="customers-card"><p>Müşteri kayıtları hazırlanıyor…</p></section></main>;
  }

  if (!session?.user) {
    return <main className="customers-shell"><section className="customers-card"><h1>Önce giriş yapın</h1><p>Müşteri kayıtları işletme hesabına özeldir.</p><a href="/app">Giriş ekranına dön</a></section></main>;
  }

  if (session.passwordRecovery) {
    return <main className="customers-shell"><section className="customers-card"><h1>Önce yeni parolanızı belirleyin</h1><p>Müşteri verileri parola kurtarma oturumunda kapalıdır.</p><a href="/app">Parolayı güncelle</a></section></main>;
  }

  return (
    <main className="customers-shell">
      <header className="customers-hero">
        <div><p className="customers-eyebrow">MÜŞTERİLER</p><h1>İşletme müşteri kayıtları</h1><p>İletişim bilgilerini yönetin, geçmiş rezervasyonları grup snapshotlarıyla inceleyin.</p></div>
        <a href="/app">Çalışma alanına dön</a>
      </header>

      {notice && <div className="customers-notice" role="status">{notice}</div>}

      <section className="customers-card customers-businesses">
        <div><strong>{activeMembership?.businesses?.name ?? 'İşletme seçin'}</strong><span>Yalnız aktif üyeliğiniz olan işletmeler gösterilir.</span></div>
        <div className="customers-business-buttons">
          {session.memberships.map((membership) => (
            <button
              key={membership.id}
              type="button"
              disabled={busy || membership.business_id === activeBusinessId}
              onClick={() => void switchBusiness(membership.business_id)}
            >
              {membership.businesses?.name ?? 'İşletme'}{membership.business_id === activeBusinessId ? ' · seçili' : ''}
            </button>
          ))}
        </div>
      </section>

      {!activeBusinessId ? (
        <section className="customers-card"><h2>İşletme seçimi gerekli</h2><p>Müşteri kayıtlarını açmak için önce yetkili olduğunuz bir işletmeyi seçin.</p></section>
      ) : (
        <div className="customers-layout">
          <section className="customers-card customers-list-panel" aria-busy={listState === 'loading'}>
            <div className="customers-section-head"><div><p className="customers-eyebrow">KAYITLAR</p><h2>Müşteriler</h2></div><span>{customers.length} gösteriliyor</span></div>
            <form className="customers-search" onSubmit={submitSearch}>
              <input aria-label="Müşteri ara" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} placeholder="Ad, telefon veya e-posta ara" />
              <button disabled={busy || listState === 'loading'}>Ara</button>
            </form>
            {listState === 'loading' ? (
              <p className="customers-muted" role="status">Müşteriler yükleniyor…</p>
            ) : listState === 'error' ? (
              <p className="customers-error" role="alert">{listError}</p>
            ) : customers.length ? (
              <ul className="customers-list">
                {customers.map((customer) => (
                  <li key={customer.customer_id}>
                    <button type="button" className={selectedId === customer.customer_id ? 'selected' : ''} onClick={() => chooseCustomer(customer.customer_id)}>
                      <strong>{customer.name}</strong>
                      <span>{customer.phone || customer.email || 'İletişim bilgisi yok'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : listState === 'success' ? (
              <p className="customers-muted">Bu aramada müşteri bulunamadı.</p>
            ) : null}
            {listState === 'success' && customerPage?.hasMore && customerPage.nextCursor && (
              <button className="customers-more" type="button" disabled={busy} onClick={() => void loadCustomers(search, customerPage.nextCursor, true)}>Daha fazla göster</button>
            )}
          </section>

          <section className="customers-card customers-detail-panel">
            {selected ? (
              <>
                <div className="customers-section-head"><div><p className="customers-eyebrow">MÜŞTERİ KARTI</p><h2>{selected.name}</h2></div><span>{activeMembership?.role}</span></div>
                <form className="customers-form" key={selected.updated_at} onSubmit={updateCustomer}>
                  <label>Ad soyad<input name="name" minLength={2} maxLength={120} defaultValue={selected.name} required /></label>
                  <label>Telefon<input name="phone" maxLength={40} defaultValue={selected.phone ?? ''} /></label>
                  <label>E-posta<input name="email" type="email" maxLength={254} defaultValue={selected.email ?? ''} /></label>
                  <label>Not<textarea name="notes" maxLength={1000} defaultValue={selected.notes ?? ''} /></label>
                  <button disabled={busy}>Bilgileri güncelle</button>
                </form>
                <div className="customers-history-head"><h3>Rezervasyon geçmişi</h3><span>Bir rezervasyon tek kayıt, hizmetleri sıralı satırlardır.</span></div>
                <div aria-busy={historyState === 'loading'}>
                  {historyState === 'loading' ? (
                    <p className="customers-muted" role="status">Randevu geçmişi yükleniyor…</p>
                  ) : historyState === 'error' ? (
                    <p className="customers-error" role="alert">{historyError}</p>
                  ) : history.length ? (
                    <ol className="customers-history">
                      {history.map((booking) => (
                        <li key={booking.groupId}>
                          <div>
                            <strong>{booking.lines.map((line) => line.serviceName).join(' + ')}</strong>
                            <span>{localDateTime(booking.startsAt, booking.timezone)} · {booking.lineCount} hizmet</span>
                            {booking.lines.map((line) => <small key={line.appointmentId}>{line.lineOrdinal}. {line.serviceName} · {line.staffName} · {line.status}</small>)}
                          </div>
                          <div className="customers-history-meta"><span>{booking.customerName}</span><span>{bookingEstimate(booking)}</span><span>{booking.status}</span></div>
                        </li>
                      ))}
                    </ol>
                  ) : historyState === 'success' ? (
                    <p className="customers-muted">Bu müşterinin randevu geçmişi yok.</p>
                  ) : null}
                </div>
                {historyState === 'success' && historyPage?.hasMore && historyPage.nextCursor && (
                  <button className="customers-more" type="button" disabled={busy} onClick={() => void loadHistory(selected.customer_id, historyPage.nextCursor, true)}>Daha eski rezervasyonları göster</button>
                )}
              </>
            ) : (
              <div className="customers-empty-detail"><h2>Bir müşteri seçin</h2><p>İletişim bilgileri ve randevu geçmişi burada açılır.</p></div>
            )}
          </section>

          <section className="customers-card customers-create-panel">
            <p className="customers-eyebrow">YENİ KAYIT</p><h2>Müşteri ekle</h2>
            <p className="customers-muted">Aynı telefon veya e-posta sessizce başka kayda bağlanmaz. Çakışma varsa sistem açıkça bildirir.</p>
            <form className="customers-form" onSubmit={createCustomer}>
              <label>Ad soyad<input name="name" minLength={2} maxLength={120} required /></label>
              <label>Telefon<input name="phone" maxLength={40} /></label>
              <label>E-posta<input name="email" type="email" maxLength={254} /></label>
              <label>Not<textarea name="notes" maxLength={1000} /></label>
              <button disabled={busy}>Müşteri oluştur</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
