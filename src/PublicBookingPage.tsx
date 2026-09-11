import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

type PublicBusiness = {
  name: string;
  slug: string;
  timezone: string;
  local_date: string;
  max_date: string;
  step_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
};
type PublicService = {
  service_id: string;
  name: string;
  duration_minutes: number;
  price_minor: number;
  currency: string;
};
type PublicStaff = { staff_id: string; staff_name: string };
type PublicSlot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};
type DeliveryStatus = 'sent' | 'already_sent' | 'skipped_no_email' | 'disabled' | 'failed' | 'unavailable';
type Confirmation = {
  appointment_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  service_name: string;
  staff_name: string;
  price_minor: number;
  currency: string;
  manage_url?: string;
  delivery_status?: DeliveryStatus;
};
type PagePayload = { business: PublicBusiness; services: PublicService[] };
type ApiError = { error?: { code?: string; message?: string } };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await response.json() as T & ApiError;
  if (!response.ok) {
    const error = new Error(body.error?.message ?? 'İşlem tamamlanamadı.');
    (error as Error & { code?: string }).code = body.error?.code;
    throw error;
  }
  return body;
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function createManagementToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function deliveryMessage(status: DeliveryStatus | undefined) {
  if (status === 'sent' || status === 'already_sent') return 'Randevu özeti ve yönetim bağlantısı e-posta adresinize de gönderildi.';
  if (status === 'skipped_no_email') return 'E-posta adresi vermediğiniz için yönetim bağlantısını bu sayfadan saklayın.';
  if (status === 'disabled') return 'E-posta gönderimi bu ortamda yapılandırılmamış. Yönetim bağlantısını bu sayfadan saklayın.';
  if (status === 'failed' || status === 'unavailable') return 'E-posta gönderilemedi. Randevunuz geçerli; yönetim bağlantısını bu sayfadan saklayın.';
  return null;
}

export default function PublicBookingPage({ slug }: { slug: string }) {
  const [page, setPage] = useState<PagePayload | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState('');
  const [staff, setStaff] = useState<PublicStaff[]>([]);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const idempotency = useRef<{ fingerprint: string; key: string; managementToken: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotice('');
      try {
        const next = await api<PagePayload>(`/api/public/business/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        setPage(next);
        const firstService = next.services[0]?.service_id ?? '';
        setServiceId(firstService);
        setDate(next.business.local_date);
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : 'Rezervasyon sayfası yüklenemedi.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setStaff([]);
    setStaffId('any');
    setSlots([]);
    setSelectedSlot(null);
    if (!serviceId) return () => { cancelled = true; };

    async function loadStaff() {
      try {
        const result = await api<{ staff: PublicStaff[] }>(`/api/public/business/${encodeURIComponent(slug)}/staff?serviceId=${encodeURIComponent(serviceId)}`);
        if (!cancelled) setStaff(result.staff);
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : 'Personel bilgileri yüklenemedi.');
      }
    }
    void loadStaff();
    return () => { cancelled = true; };
  }, [serviceId, slug]);

  const selectedService = useMemo(
    () => page?.services.find((service) => service.service_id === serviceId) ?? null,
    [page, serviceId],
  );

  function resetSlotSelection() {
    setSlots([]);
    setSelectedSlot(null);
    setNotice('');
  }

  async function loadSlots(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!serviceId || !date) return;
    setBusy(true);
    setNotice('');
    setSelectedSlot(null);
    try {
      const params = new URLSearchParams({ serviceId, date, staffId });
      const result = await api<{ slots: PublicSlot[] }>(`/api/public/business/${encodeURIComponent(slug)}/slots?${params}`);
      setSlots(result.slots);
      setNotice(result.slots.length ? `${result.slots.length} uygun saat bulundu.` : 'Bu gün için uygun saat kalmamış.');
    } catch (error) {
      setSlots([]);
      setNotice(error instanceof Error ? error.message : 'Uygun saatler getirilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot || !selectedService) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const customerName = String(formData.get('customerName') ?? '').trim();
    const customerPhone = String(formData.get('customerPhone') ?? '').trim();
    const customerEmail = String(formData.get('customerEmail') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim();
    if (!customerPhone && !customerEmail) {
      setNotice('Telefon veya e-posta bilgilerinden en az birini yazın.');
      return;
    }

    const payload = {
      customerName,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      notes: notes || null,
      serviceId: selectedService.service_id,
      staffId: selectedSlot.staff_id,
      startsAt: selectedSlot.starts_at,
    };
    const fingerprint = JSON.stringify(payload);
    if (!idempotency.current || idempotency.current.fingerprint !== fingerprint) {
      idempotency.current = {
        fingerprint,
        key: `pub-${crypto.randomUUID()}`,
        managementToken: createManagementToken(),
      };
    }

    setBusy(true);
    setNotice('');
    try {
      const current = idempotency.current;
      const result = await api<{ appointment: Confirmation }>(`/api/public/business/${encodeURIComponent(slug)}/book`, {
        method: 'POST',
        headers: { 'Idempotency-Key': current.key },
        body: JSON.stringify(payload),
      });
      const provision = await api<{ ok: true; delivery?: { status: DeliveryStatus } }>('/api/manage/provision', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId: result.appointment.appointment_id,
          bookingIdempotencyKey: current.key,
          managementToken: current.managementToken,
        }),
      });
      setConfirmation({
        ...result.appointment,
        manage_url: `/m#${encodeURIComponent(current.managementToken)}`,
        delivery_status: provision.delivery?.status,
      });
      idempotency.current = null;
    } catch (error) {
      const coded = error as Error & { code?: string };
      setNotice(coded.message);
      if (coded.code === 'SLOT_UNAVAILABLE') {
        setSelectedSlot(null);
        void loadSlots();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="public-booking-shell"><section className="public-booking-card"><p>Uygun saatler hazırlanıyor…</p></section></main>;
  }

  if (!page) {
    return (
      <main className="public-booking-shell">
        <section className="public-booking-card public-empty-state">
          <p className="public-kicker">YZT RANDEVU</p>
          <h1>Bu rezervasyon bağlantısı şu anda aktif değil.</h1>
          <p>{notice || 'İşletme bağlantıyı kapatmış veya adres geçersiz olabilir.'}</p>
        </section>
      </main>
    );
  }

  if (confirmation) {
    const mailNotice = deliveryMessage(confirmation.delivery_status);
    return (
      <main className="public-booking-shell">
        <section className="public-booking-card public-confirmation">
          <div className="public-success-mark">✓</div>
          <p className="public-kicker">RANDEVU OLUŞTURULDU</p>
          <h1>{page.business.name}</h1>
          <dl className="public-confirmation-list">
            <div><dt>Hizmet</dt><dd>{confirmation.service_name}</dd></div>
            <div><dt>Personel</dt><dd>{confirmation.staff_name}</dd></div>
            <div><dt>Tarih</dt><dd>{formatDateTime(confirmation.starts_at, confirmation.timezone)}</dd></div>
            <div><dt>Ücret</dt><dd>{money(confirmation.price_minor, confirmation.currency)}</dd></div>
          </dl>
          <p className="public-confirmation-note">Randevunuz işletmenin paneline kaydedildi. Yönetim bağlantınızı kaybetmeyin; bu bağlantı randevuyu taşıma ve iptal etme yetkisi verir.</p>
          {mailNotice && <p className="public-confirmation-note">{mailNotice}</p>}
          {confirmation.manage_url && <a className="public-primary" href={confirmation.manage_url}>Randevumu yönet</a>}
          <button className="public-secondary" type="button" onClick={() => { setConfirmation(null); setSlots([]); setSelectedSlot(null); setNotice(''); }}>Yeni randevu oluştur</button>
        </section>
      </main>
    );
  }

  return (
    <main className="public-booking-shell">
      <header className="public-booking-header">
        <p className="public-kicker">ONLINE RANDEVU</p>
        <h1>{page.business.name}</h1>
        <p>Hizmeti ve günü seçin, gerçek boş saatlerden birini ayırın.</p>
      </header>

      {notice && <div className="public-booking-notice" role="status">{notice}</div>}

      <div className="public-booking-layout">
        <section className="public-booking-card">
          <span className="public-step">1</span>
          <h2>Hizmet ve tarih</h2>
          {page.services.length ? (
            <form className="public-picker-form" onSubmit={(event) => void loadSlots(event)}>
              <label>
                <span>Hizmet</span>
                <select value={serviceId} onChange={(event) => { setServiceId(event.target.value); resetSlotSelection(); }}>
                  {page.services.map((service) => <option key={service.service_id} value={service.service_id}>{service.name} · {service.duration_minutes} dk · {money(service.price_minor, service.currency)}</option>)}
                </select>
              </label>
              <label>
                <span>Personel</span>
                <select value={staffId} onChange={(event) => { setStaffId(event.target.value); resetSlotSelection(); }}>
                  <option value="any">Fark etmez</option>
                  {staff.map((person) => <option key={person.staff_id} value={person.staff_id}>{person.staff_name}</option>)}
                </select>
              </label>
              <label>
                <span>Tarih</span>
                <input type="date" value={date} min={page.business.local_date} max={page.business.max_date} onChange={(event) => { setDate(event.target.value); resetSlotSelection(); }} required />
              </label>
              <button className="public-primary" disabled={busy || !serviceId}>{busy ? 'Bakılıyor…' : 'Uygun saatleri göster'}</button>
            </form>
          ) : <p className="public-muted">Şu anda online randevuya açık hizmet bulunmuyor.</p>}
        </section>

        <section className="public-booking-card">
          <span className="public-step">2</span>
          <h2>Uygun saat</h2>
          {slots.length ? (
            <div className="public-slot-grid">
              {slots.map((slot) => {
                const active = selectedSlot?.staff_id === slot.staff_id && selectedSlot.starts_at === slot.starts_at;
                return <button className={`public-slot ${active ? 'is-selected' : ''}`} type="button" key={`${slot.staff_id}-${slot.starts_at}`} onClick={() => { setSelectedSlot(slot); setNotice(''); }}><strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{slot.staff_name}</span></button>;
              })}
            </div>
          ) : <p className="public-muted">Önce hizmet ve tarih seçip uygun saatleri getirin.</p>}
        </section>

        <section className={`public-booking-card public-customer-card ${selectedSlot ? 'is-ready' : ''}`}>
          <span className="public-step">3</span>
          <h2>İletişim bilgileri</h2>
          {selectedSlot && selectedService ? (
            <>
              <div className="public-selection-summary">
                <strong>{selectedService.name}</strong>
                <span>{formatDateTime(selectedSlot.starts_at, selectedSlot.timezone)} · {selectedSlot.staff_name}</span>
              </div>
              <form className="public-customer-form" onSubmit={book}>
                <label><span>Ad soyad</span><input name="customerName" minLength={2} maxLength={120} autoComplete="name" required /></label>
                <div className="public-two-columns">
                  <label><span>Telefon</span><input name="customerPhone" maxLength={40} autoComplete="tel" placeholder="05xx…" /></label>
                  <label><span>E-posta</span><input name="customerEmail" maxLength={254} type="email" autoComplete="email" placeholder="ornek@eposta.com" /></label>
                </div>
                <small className="public-field-hint">Telefon veya e-postadan en az biri gerekli.</small>
                <label><span>Not <small>(isteğe bağlı)</small></span><textarea name="notes" maxLength={500} rows={3} /></label>
                <button className="public-primary public-book-button" disabled={busy}>{busy ? 'Randevu oluşturuluyor…' : 'Randevuyu oluştur'}</button>
              </form>
            </>
          ) : <p className="public-muted">Bir saat seçtiğinizde iletişim formu burada açılır.</p>}
        </section>
      </div>

      <footer className="public-booking-footer">Saatler {page.business.timezone} saat dilimine göre gösterilir.</footer>
    </main>
  );
}
