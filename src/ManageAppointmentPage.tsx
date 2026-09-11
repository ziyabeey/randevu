import { useEffect, useRef, useState } from 'react';

type ManagedAppointment = {
  appointment_id: string;
  business_name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  service_name: string;
  staff_name: string;
  price_minor: number;
  currency: string;
  can_reschedule: boolean;
  can_cancel: boolean;
  local_date: string;
  max_date: string;
};
type ManagedSlot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};
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

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    scheduled: 'Planlandı',
    confirmed: 'Onaylandı',
    completed: 'Tamamlandı',
    no_show: 'Gelmedi',
    cancelled: 'İptal edildi',
  };
  return labels[status] ?? status;
}

export default function ManageAppointmentPage({ token }: { token: string }) {
  const [appointment, setAppointment] = useState<ManagedAppointment | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<ManagedSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<ManagedSlot | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const rescheduleCommand = useRef<{ fingerprint: string; key: string } | null>(null);
  const cancelCommand = useRef<{ fingerprint: string; key: string } | null>(null);

  async function loadAppointment() {
    const result = await api<{ appointment: ManagedAppointment }>(`/api/manage/${encodeURIComponent(token)}`);
    setAppointment(result.appointment);
    setDate((current) => current || result.appointment.local_date);
    return result.appointment;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotice('');
      try {
        const result = await api<{ appointment: ManagedAppointment }>(`/api/manage/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setAppointment(result.appointment);
        setDate(result.appointment.local_date);
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : 'Randevu bilgisi yüklenemedi.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token]);

  async function loadSlots() {
    if (!date || !appointment?.can_reschedule) return;
    setBusy(true);
    setNotice('');
    setSelectedSlot(null);
    try {
      const params = new URLSearchParams({ date, staffId: 'any' });
      const result = await api<{ slots: ManagedSlot[] }>(`/api/manage/${encodeURIComponent(token)}/slots?${params}`);
      setSlots(result.slots);
      setNotice(result.slots.length ? `${result.slots.length} uygun saat bulundu.` : 'Bu gün için uygun saat bulunamadı.');
    } catch (error) {
      setSlots([]);
      setNotice(error instanceof Error ? error.message : 'Uygun saatler yüklenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!selectedSlot) return;
    const fingerprint = `${selectedSlot.staff_id}:${selectedSlot.starts_at}`;
    if (!rescheduleCommand.current || rescheduleCommand.current.fingerprint !== fingerprint) {
      rescheduleCommand.current = { fingerprint, key: `manage-res-${crypto.randomUUID()}` };
    }

    setBusy(true);
    setNotice('');
    try {
      await api(`/api/manage/${encodeURIComponent(token)}/reschedule`, {
        method: 'POST',
        headers: { 'Idempotency-Key': rescheduleCommand.current.key },
        body: JSON.stringify({ staffId: selectedSlot.staff_id, startsAt: selectedSlot.starts_at }),
      });
      rescheduleCommand.current = null;
      setSlots([]);
      setSelectedSlot(null);
      const next = await loadAppointment();
      setNotice(`Randevu ${formatDateTime(next.starts_at, next.timezone)} tarihine taşındı.`);
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

  async function cancelAppointment() {
    if (!appointment?.can_cancel) return;
    const cleanReason = reason.trim();
    const fingerprint = cleanReason || 'no-reason';
    if (!cancelCommand.current || cancelCommand.current.fingerprint !== fingerprint) {
      cancelCommand.current = { fingerprint, key: `manage-cancel-${crypto.randomUUID()}` };
    }
    if (!window.confirm('Bu randevuyu iptal etmek istediğinize emin misiniz?')) return;

    setBusy(true);
    setNotice('');
    try {
      await api(`/api/manage/${encodeURIComponent(token)}/cancel`, {
        method: 'POST',
        headers: { 'Idempotency-Key': cancelCommand.current.key },
        body: JSON.stringify({ reason: cleanReason || null }),
      });
      cancelCommand.current = null;
      setSlots([]);
      setSelectedSlot(null);
      await loadAppointment();
      setNotice('Randevu iptal edildi. Ayrılan saat yeniden müsait hale geldi.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Randevu iptal edilemedi.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="manage-shell"><section className="manage-card"><p>Randevu hazırlanıyor…</p></section></main>;
  }

  if (!appointment) {
    return (
      <main className="manage-shell">
        <section className="manage-card manage-empty">
          <p className="public-kicker">RANDEVU YÖNETİMİ</p>
          <h1>Bu bağlantı geçerli değil.</h1>
          <p>{notice || 'Bağlantı hatalı, iptal edilmiş veya artık kullanılamıyor olabilir.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="manage-shell">
      <header className="manage-header">
        <p className="public-kicker">RANDEVUMU YÖNET</p>
        <h1>{appointment.business_name}</h1>
        <span className={`manage-status status-${appointment.status}`}>{statusLabel(appointment.status)}</span>
      </header>

      {notice && <div className="public-booking-notice" role="status">{notice}</div>}

      <div className="manage-grid">
        <section className="manage-card manage-summary">
          <h2>Randevu bilgileri</h2>
          <dl className="public-confirmation-list">
            <div><dt>Hizmet</dt><dd>{appointment.service_name}</dd></div>
            <div><dt>Personel</dt><dd>{appointment.staff_name}</dd></div>
            <div><dt>Tarih</dt><dd>{formatDateTime(appointment.starts_at, appointment.timezone)}</dd></div>
            <div><dt>Ücret</dt><dd>{money(appointment.price_minor, appointment.currency)}</dd></div>
          </dl>
          <p className="manage-security-note">Bu sayfanın adresi randevunuzu değiştirme yetkisi verir. Bağlantıyı yalnız güvendiğiniz kişilerle paylaşın.</p>
        </section>

        <section className="manage-card">
          <h2>Başka saate taşı</h2>
          {appointment.can_reschedule ? (
            <>
              <div className="manage-date-row">
                <input type="date" value={date} min={appointment.local_date} max={appointment.max_date} onChange={(event) => { setDate(event.target.value); setSlots([]); setSelectedSlot(null); }} />
                <button className="public-primary" type="button" disabled={busy} onClick={() => void loadSlots()}>{busy ? 'Bakılıyor…' : 'Saatleri göster'}</button>
              </div>
              {slots.length > 0 && (
                <div className="public-slot-grid manage-slots">
                  {slots.map((slot) => {
                    const selected = selectedSlot?.staff_id === slot.staff_id && selectedSlot.starts_at === slot.starts_at;
                    return (
                      <button className={`public-slot ${selected ? 'is-selected' : ''}`} type="button" key={`${slot.staff_id}-${slot.starts_at}`} onClick={() => setSelectedSlot(slot)}>
                        <strong>{formatTime(slot.starts_at, slot.timezone)}</strong>
                        <span>{slot.staff_name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedSlot && <button className="public-primary manage-confirm" type="button" disabled={busy} onClick={() => void reschedule()}>Seçilen saate taşı</button>}
            </>
          ) : <p className="public-muted">Bu randevu artık taşınamaz.</p>}
        </section>

        <section className="manage-card manage-danger">
          <h2>Randevuyu iptal et</h2>
          {appointment.can_cancel ? (
            <>
              <label>
                <span>İptal nedeni <small>(isteğe bağlı)</small></span>
                <textarea value={reason} maxLength={240} rows={3} onChange={(event) => setReason(event.target.value)} />
              </label>
              <button className="manage-cancel-button" type="button" disabled={busy} onClick={() => void cancelAppointment()}>Randevuyu iptal et</button>
            </>
          ) : <p className="public-muted">Bu randevu artık iptal edilemez.</p>}
        </section>
      </div>

      <footer className="public-booking-footer">Saatler {appointment.timezone} saat dilimine göre gösterilir.</footer>
    </main>
  );
}
