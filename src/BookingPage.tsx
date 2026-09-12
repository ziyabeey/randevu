import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Role = 'owner' | 'manager' | 'staff';
type Session = {
  user: null | { id: string; email: string | null; fullName: string | null };
  memberships: Array<{ id: string; business_id: string; role: Role; active: boolean }>;
  activeBusinessId: string | null;
};
type Service = {
  id: string; name: string; duration_minutes: number; buffer_before_minutes: number;
  buffer_after_minutes: number; price_minor: number; currency: string; active: boolean;
};
type Staff = { id: string; name: string; active: boolean };
type Assignment = { staff_id: string; service_id: string; active: boolean };
type Catalog = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  services: Service[]; staff: Staff[]; assignments: Assignment[];
};
type Setup = { timezone: string };
type Slot = { staff_id: string; staff_name: string; starts_at: string; ends_at: string; timezone: string };
type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
type Appointment = {
  id: string; customer_id: string; service_id: string; staff_id: string; status: AppointmentStatus;
  starts_at: string; ends_at: string; timezone: string; customer_name_snapshot: string;
  customer_phone_snapshot: string | null; customer_email_snapshot: string | null;
  service_name_snapshot: string; staff_name_snapshot: string; price_minor_snapshot: number;
  currency_snapshot: string; notes: string | null; cancellation_reason: string | null;
};
type AppointmentEvent = {
  id: string; event_type: string; actor_user_id: string; from_status: string | null;
  to_status: string | null; payload: Record<string, unknown>; created_at: string;
};

function commandKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateInZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone, dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(value / 100);
}

const statusText: Record<AppointmentStatus, string> = {
  scheduled: 'Planlandı', confirmed: 'Onaylandı', completed: 'Tamamlandı', no_show: 'Gelmedi', cancelled: 'İptal',
};

export default function BookingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [timezone, setTimezone] = useState('Europe/Istanbul');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState(dateToday());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [createKey, setCreateKey] = useState(commandKey);

  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(dateToday());
  const [rescheduleStaff, setRescheduleStaff] = useState('any');
  const [rescheduleSlots, setRescheduleSlots] = useState<Slot[]>([]);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<Slot | null>(null);
  const [eventsFor, setEventsFor] = useState<Appointment | null>(null);
  const [events, setEvents] = useState<AppointmentEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextSession = await api<Session>('/api/session');
      setSession(nextSession);
      if (!nextSession.user || !nextSession.activeBusinessId) {
        setCatalog(null); setAppointments([]); return;
      }
      const [nextCatalog, nextSetup, nextBookings] = await Promise.all([
        api<Catalog>('/api/catalog'),
        api<Setup>('/api/availability/setup'),
        api<{ appointments: Appointment[] }>('/api/bookings'),
      ]);
      setCatalog(nextCatalog);
      setTimezone(nextSetup.timezone);
      setAppointments(nextBookings.appointments);
      setServiceId((current) => current || nextCatalog.services.find((item) => item.active)?.id || '');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Randevu ekranı yüklenemedi.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeServices = useMemo(() => catalog?.services.filter((item) => item.active) ?? [], [catalog]);
  const activeStaff = useMemo(() => catalog?.staff.filter((item) => item.active) ?? [], [catalog]);
  const eligibleStaff = useMemo(() => {
    if (!catalog || !serviceId) return [];
    const ids = new Set(catalog.assignments.filter((item) => item.active && item.service_id === serviceId).map((item) => item.staff_id));
    return activeStaff.filter((person) => ids.has(person.id));
  }, [activeStaff, catalog, serviceId]);

  const rescheduleEligibleStaff = useMemo(() => {
    if (!catalog || !rescheduleTarget) return [];
    const ids = new Set(catalog.assignments.filter((item) => item.active && item.service_id === rescheduleTarget.service_id).map((item) => item.staff_id));
    return activeStaff.filter((person) => ids.has(person.id));
  }, [activeStaff, catalog, rescheduleTarget]);

  async function previewSlots() {
    if (!serviceId) return;
    setBusy(true); setNotice(''); setSlots([]); setSelectedSlot(null);
    const params = new URLSearchParams({ date, serviceId, staffId, step: '15' });
    try {
      const result = await api<{ slots: Slot[] }>(`/api/availability/slots?${params}`);
      setSlots(result.slots);
      setNotice(result.slots.length ? `${result.slots.length} boş saat bulundu.` : 'Bu seçim için boş saat yok.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Saatler hesaplanamadı.'); }
    finally { setBusy(false); }
  }

  async function createBooking() {
    if (!selectedSlot) return;
    setBusy(true); setNotice('');
    try {
      await api('/api/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': createKey },
        body: JSON.stringify({
          customerName, customerPhone, customerEmail, notes,
          serviceId, staffId: selectedSlot.staff_id, startsAt: selectedSlot.starts_at,
        }),
      });
      setNotice('Randevu oluşturuldu ve slot kilitlendi.');
      setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setNotes('');
      setSlots([]); setSelectedSlot(null); setCreateKey(commandKey());
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Randevu oluşturulamadı.'); }
    finally { setBusy(false); }
  }

  async function changeStatus(appointment: Appointment, status: 'confirmed' | 'completed' | 'no_show' | 'cancelled') {
    const reason = status === 'cancelled' ? (window.prompt('İptal nedeni (isteğe bağlı):') ?? '') : '';
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/${appointment.id}/status`, {
        method: 'POST', headers: { 'Idempotency-Key': commandKey() },
        body: JSON.stringify({ status, reason }),
      });
      setNotice(`Randevu: ${statusText[status]}.`); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Durum güncellenemedi.'); }
    finally { setBusy(false); }
  }

  function openReschedule(appointment: Appointment) {
    setRescheduleTarget(appointment);
    setRescheduleDate(dateInZone(appointment.starts_at, appointment.timezone));
    setRescheduleStaff(appointment.staff_id);
    setRescheduleSlots([]); setSelectedRescheduleSlot(null); setNotice('');
  }

  async function previewReschedule() {
    if (!rescheduleTarget) return;
    setBusy(true); setNotice(''); setRescheduleSlots([]); setSelectedRescheduleSlot(null);
    const params = new URLSearchParams({ date: rescheduleDate, staffId: rescheduleStaff, step: '15' });
    try {
      const result = await api<{ slots: Slot[] }>(`/api/bookings/${rescheduleTarget.id}/reschedule-slots?${params}`);
      setRescheduleSlots(result.slots);
      setNotice(result.slots.length ? `${result.slots.length} taşıma seçeneği bulundu.` : 'Taşıma için boş saat yok.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Taşıma saatleri hesaplanamadı.'); }
    finally { setBusy(false); }
  }

  async function commitReschedule() {
    if (!rescheduleTarget || !selectedRescheduleSlot) return;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/${rescheduleTarget.id}/reschedule`, {
        method: 'POST', headers: { 'Idempotency-Key': commandKey() },
        body: JSON.stringify({ staffId: selectedRescheduleSlot.staff_id, startsAt: selectedRescheduleSlot.starts_at }),
      });
      setNotice('Randevu yeni saate taşındı.');
      setRescheduleTarget(null); setRescheduleSlots([]); setSelectedRescheduleSlot(null); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Randevu taşınamadı.'); }
    finally { setBusy(false); }
  }

  async function showHistory(appointment: Appointment) {
    setBusy(true); setNotice('');
    try {
      const result = await api<{ events: AppointmentEvent[] }>(`/api/bookings/${appointment.id}/events`);
      setEventsFor(appointment); setEvents(result.events);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Randevu geçmişi okunamadı.'); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="booking-page"><section className="booking-card"><p>Booking motoru hazırlanıyor…</p></section></main>;
  if (!session?.user || !session.activeBusinessId || !catalog) {
    return <main className="booking-page"><section className="booking-card"><p className="eyebrow">RANDEVU</p><h1>Önce çalışma alanını seçin.</h1><p className="muted">Giriş ve işletme seçimi ana çalışma alanında yapılır.</p><a className="primary-link" href="/">Çalışma alanına dön</a></section></main>;
  }

  return <div className="booking-page">
    <header className="booking-hero">
      <div><p className="eyebrow">FAZ 5 · BOOKING ÇEKİRDEĞİ</p><h1>Boş saati gerçek randevuya çevir</h1><p className="muted">{timezone} · çakışma koruması ve audit aktif.</p></div>
      <span className="role-badge">{catalog.membership.role}</span>
    </header>

    {notice && <div className="notice" role="status">{notice}</div>}

    <div className="booking-grid">
      <section className="booking-card booking-composer">
        <div className="section-head"><h2>Yeni randevu</h2><span>{slots.length ? `${slots.length} slot` : '1 · müşteri'}</span></div>
        <div className="booking-fields">
          <label>Müşteri<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ad soyad" maxLength={120} /></label>
          <label>Telefon<input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="+90…" maxLength={40} /></label>
          <label>E-posta<input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} type="email" placeholder="mail@…" maxLength={254} /></label>
          <label>Hizmet<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setStaffId('any'); setSlots([]); setSelectedSlot(null); }}>
            {activeServices.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.duration_minutes} dk · {money(service.price_minor, service.currency)}</option>)}
          </select></label>
          <label>Personel<select value={staffId} onChange={(event) => { setStaffId(event.target.value); setSlots([]); setSelectedSlot(null); }}>
            <option value="any">Fark etmez</option>{eligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          <label>Tarih<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSlots([]); setSelectedSlot(null); }} /></label>
          <label className="wide-field">Not<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="İsteğe bağlı not" /></label>
        </div>
        <div className="booking-actions"><button className="secondary-button" disabled={busy || !serviceId} onClick={() => void previewSlots()}>Boş saatleri getir</button></div>

        <div className="slot-cloud">
          {slots.map((slot) => <button type="button" className={selectedSlot?.starts_at === slot.starts_at && selectedSlot.staff_id === slot.staff_id ? 'slot-button selected' : 'slot-button'} key={`${slot.staff_id}-${slot.starts_at}`} onClick={() => setSelectedSlot(slot)}>
            <strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{slot.staff_name}</span>
          </button>)}
        </div>
        {selectedSlot && <div className="booking-confirm"><div><strong>{formatDateTime(selectedSlot.starts_at, selectedSlot.timezone)}</strong><span>{selectedSlot.staff_name}</span></div><button className="primary-button" disabled={busy || customerName.trim().length < 2} onClick={() => void createBooking()}>Randevuyu oluştur</button></div>}
      </section>

      <section className="booking-card booking-list-card">
        <div className="section-head"><h2>Randevular</h2><span>{appointments.length}</span></div>
        <div className="appointment-list">
          {appointments.map((appointment) => <article className={`appointment-row status-${appointment.status}`} key={appointment.id}>
            <div className="appointment-time"><strong>{formatDateTime(appointment.starts_at, appointment.timezone)}</strong><span>{appointment.staff_name_snapshot}</span></div>
            <div className="appointment-main"><div><strong>{appointment.customer_name_snapshot}</strong><span>{appointment.service_name_snapshot} · {money(appointment.price_minor_snapshot, appointment.currency_snapshot)}</span></div><span className="status-pill">{statusText[appointment.status]}</span></div>
            <div className="appointment-actions">
              {appointment.status === 'scheduled' && <button disabled={busy} onClick={() => void changeStatus(appointment, 'confirmed')}>Onayla</button>}
              {(appointment.status === 'scheduled' || appointment.status === 'confirmed') && <button disabled={busy} onClick={() => openReschedule(appointment)}>Taşı</button>}
              {(appointment.status === 'scheduled' || appointment.status === 'confirmed') && <button disabled={busy} onClick={() => void changeStatus(appointment, 'cancelled')}>İptal</button>}
              {appointment.status === 'confirmed' && <button disabled={busy} onClick={() => void changeStatus(appointment, 'completed')}>Tamamlandı</button>}
              {appointment.status === 'confirmed' && <button disabled={busy} onClick={() => void changeStatus(appointment, 'no_show')}>Gelmedi</button>}
              <button disabled={busy} onClick={() => void showHistory(appointment)}>Geçmiş</button>
            </div>
          </article>)}
          {!appointments.length && <p className="empty">Henüz randevu yok. İlk slotu soldan kilitle.</p>}
        </div>
      </section>
    </div>

    {rescheduleTarget && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">TAŞI</p><h2>{rescheduleTarget.customer_name_snapshot} · {rescheduleTarget.service_name_snapshot}</h2></div><button onClick={() => setRescheduleTarget(null)}>Kapat</button></div>
      <div className="reschedule-controls">
        <input type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} />
        <select value={rescheduleStaff} onChange={(event) => setRescheduleStaff(event.target.value)}><option value="any">Fark etmez</option>{rescheduleEligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        <button className="secondary-button" disabled={busy} onClick={() => void previewReschedule()}>Saatleri getir</button>
      </div>
      <div className="slot-cloud">{rescheduleSlots.map((slot) => <button type="button" className={selectedRescheduleSlot?.starts_at === slot.starts_at && selectedRescheduleSlot.staff_id === slot.staff_id ? 'slot-button selected' : 'slot-button'} key={`${slot.staff_id}-${slot.starts_at}`} onClick={() => setSelectedRescheduleSlot(slot)}><strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{slot.staff_name}</span></button>)}</div>
      {selectedRescheduleSlot && <div className="booking-confirm"><div><strong>{formatDateTime(selectedRescheduleSlot.starts_at, selectedRescheduleSlot.timezone)}</strong><span>{selectedRescheduleSlot.staff_name}</span></div><button className="primary-button" disabled={busy} onClick={() => void commitReschedule()}>Yeni saate taşı</button></div>}
    </section>}

    {eventsFor && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">AUDIT</p><h2>{eventsFor.customer_name_snapshot} · geçmiş</h2></div><button onClick={() => { setEventsFor(null); setEvents([]); }}>Kapat</button></div>
      <div className="event-list">{events.map((event) => <div className="event-row" key={event.id}><strong>{event.event_type}</strong><span>{formatDateTime(event.created_at, timezone)}</span><small>{event.from_status ?? '∅'} → {event.to_status ?? '∅'}</small></div>)}</div>
    </section>}
  </div>;
}
