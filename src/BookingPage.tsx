import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  price_type?: 'fixed' | 'range'; price_min_minor?: number; price_max_minor?: number;
  price_policy_version?: number; category?: string; sort_order?: number;
};
type Staff = { id: string; name: string; active: boolean };
type Assignment = { staff_id: string; service_id: string; active: boolean };
type Catalog = {
  membership: { id: string; business_id: string; role: Role; active: boolean };
  services: Service[]; staff: Staff[]; assignments: Assignment[];
};
type Setup = { timezone: string };
type Slot = { staff_id: string; staff_name: string; starts_at: string; ends_at: string; timezone: string };
type GroupSlot = { starts_at: string; ends_at: string; timezone: string; total_duration_minutes: number; lines: unknown[] };
type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
type GroupStatus = AppointmentStatus | 'partial';
type BookingLine = {
  appointmentId: string;
  lineOrdinal: number;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  occupiedStartsAt: string;
  occupiedEndsAt: string;
  processingCapacityPolicy: 'HOLD' | 'RELEASE';
  passiveWaitMinutes: number;
  processingPolicyVersion: number;
  priceType: 'fixed' | 'range';
  priceMinMinor: number;
  priceMaxMinor: number;
  priceMinor: number | null;
  currency: string;
  pricePolicyVersion: number;
};
type BookingGroup = {
  groupId: string;
  status: GroupStatus;
  source: 'operator' | 'public';
  version: number;
  customerId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  currency: string;
  estimateMinMinor: number;
  estimateMaxMinor: number;
  lines: BookingLine[];
  legacyAppointmentId: string | null;
  managementMode: 'legacy_single' | 'group';
  lineCount: number;
  canRescheduleGroup: boolean;
  canCancelGroup: boolean;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
};
type AppointmentEvent = {
  id: string; event_type: string; actor_user_id: string; from_status: string | null;
  to_status: string | null; payload: Record<string, unknown>; created_at: string;
};
type PageInfo = { limit: number; hasMore: boolean; nextCursor: string | null };
type RescheduleTarget = { booking: BookingGroup; key: string };
type LineTarget = { booking: BookingGroup; line: BookingLine; key: string };

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

function timeInZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

function zonedLocalToIso(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('Tarih veya saat geçerli değil.');
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const guess = new Date(desiredUtc);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const observedUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second),
  );
  const offset = observedUtc - desiredUtc;
  const result = new Date(desiredUtc - offset);
  const verify = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(result);
  const verified = Object.fromEntries(verify.map((part) => [part.type, part.value]));
  if (`${verified.year}-${verified.month}-${verified.day}` !== date || `${verified.hour}:${verified.minute}` !== time) {
    throw new Error('Bu yerel saat seçilen zaman diliminde geçerli değil.');
  }
  return result.toISOString();
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

function priceText(line: BookingLine) {
  if (line.priceType === 'fixed') return money(line.priceMinor ?? line.priceMinMinor, line.currency);
  return `${money(line.priceMinMinor, line.currency)} – ${money(line.priceMaxMinor, line.currency)}`;
}

function estimateText(booking: BookingGroup) {
  return booking.estimateMinMinor === booking.estimateMaxMinor
    ? money(booking.estimateMinMinor, booking.currency)
    : `${money(booking.estimateMinMinor, booking.currency)} – ${money(booking.estimateMaxMinor, booking.currency)}`;
}

function legacyCreateBookable(service: Service) {
  return service.active && (service.price_type === undefined || service.price_type === 'fixed');
}

const statusText: Record<GroupStatus, string> = {
  scheduled: 'Planlandı', confirmed: 'Onaylandı', completed: 'Tamamlandı', no_show: 'Gelmedi', cancelled: 'İptal', partial: 'Kısmi',
};

export default function BookingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [timezone, setTimezone] = useState('Europe/Istanbul');
  const [bookings, setBookings] = useState<BookingGroup[]>([]);
  const [bookingsNextCursor, setBookingsNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const mutationKeys = useRef(new Map<string, string>());

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

  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(dateToday());
  const [rescheduleStaff, setRescheduleStaff] = useState('any');
  const [rescheduleSlots, setRescheduleSlots] = useState<Array<Slot | GroupSlot>>([]);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<Slot | GroupSlot | null>(null);

  const [serviceTarget, setServiceTarget] = useState<LineTarget | null>(null);
  const [replacementServiceId, setReplacementServiceId] = useState('');
  const [lineScheduleTarget, setLineScheduleTarget] = useState<LineTarget | null>(null);
  const [lineDate, setLineDate] = useState(dateToday());
  const [lineTime, setLineTime] = useState('09:00');
  const [lineStaff, setLineStaff] = useState('');

  const [eventsFor, setEventsFor] = useState<BookingGroup | null>(null);
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [eventsNextCursor, setEventsNextCursor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextSession = await api<Session>('/api/session');
      setSession(nextSession);
      if (!nextSession.user || !nextSession.activeBusinessId) {
        setCatalog(null); setBookings([]); setBookingsNextCursor(null); return;
      }
      const [nextCatalog, nextSetup, nextBookings] = await Promise.all([
        api<Catalog>('/api/catalog'),
        api<Setup>('/api/availability/setup'),
        api<{ bookings: BookingGroup[]; page: PageInfo }>('/api/bookings/groups?limit=25'),
      ]);
      setCatalog(nextCatalog);
      setTimezone(nextSetup.timezone);
      setBookings(nextBookings.bookings);
      setBookingsNextCursor(nextBookings.page.nextCursor);
      setServiceId((current) => {
        const bookable = nextCatalog.services.filter(legacyCreateBookable);
        if (current && bookable.some((item) => item.id === current)) return current;
        return bookable[0]?.id ?? '';
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Randevu ekranı yüklenemedi.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeServices = useMemo(() => catalog?.services.filter(legacyCreateBookable) ?? [], [catalog]);
  const editableServices = useMemo(() => catalog?.services.filter((item) => item.active) ?? [], [catalog]);
  const hasRangeServices = useMemo(() => catalog?.services.some((item) => item.active && item.price_type === 'range') ?? false, [catalog]);
  const activeStaff = useMemo(() => catalog?.staff.filter((item) => item.active) ?? [], [catalog]);
  const eligibleStaff = useMemo(() => {
    if (!catalog || !serviceId) return [];
    const ids = new Set(catalog.assignments.filter((item) => item.active && item.service_id === serviceId).map((item) => item.staff_id));
    return activeStaff.filter((person) => ids.has(person.id));
  }, [activeStaff, catalog, serviceId]);
  const legacyRescheduleStaff = useMemo(() => {
    const line = rescheduleTarget?.booking.lines[0];
    if (!catalog || !line) return [];
    const ids = new Set(catalog.assignments.filter((item) => item.active && item.service_id === line.serviceId).map((item) => item.staff_id));
    return activeStaff.filter((person) => ids.has(person.id));
  }, [activeStaff, catalog, rescheduleTarget]);
  const lineEligibleStaff = useMemo(() => {
    const line = lineScheduleTarget?.line;
    if (!catalog || !line) return [];
    const ids = new Set(catalog.assignments.filter((item) => item.active && item.service_id === line.serviceId).map((item) => item.staff_id));
    return activeStaff.filter((person) => ids.has(person.id));
  }, [activeStaff, catalog, lineScheduleTarget]);

  function stableMutationKey(fingerprint: string) {
    let key = mutationKeys.current.get(fingerprint);
    if (!key) {
      key = commandKey();
      mutationKeys.current.set(fingerprint, key);
    }
    return key;
  }

  async function reloadAfterMutation(message: string, fingerprint?: string) {
    if (fingerprint) mutationKeys.current.delete(fingerprint);
    await load();
    setNotice(message);
  }

  async function loadMoreBookings() {
    if (!bookingsNextCursor) return;
    setBusy(true); setNotice('');
    try {
      const params = new URLSearchParams({ limit: '25', cursor: bookingsNextCursor });
      const result = await api<{ bookings: BookingGroup[]; page: PageInfo }>(`/api/bookings/groups?${params}`);
      setBookings((current) => {
        const existing = new Set(current.map((item) => item.groupId));
        return [...current, ...result.bookings.filter((item) => !existing.has(item.groupId))];
      });
      setBookingsNextCursor(result.page.nextCursor);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Diğer randevular yüklenemedi.'); }
    finally { setBusy(false); }
  }

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

  async function changeLegacyStatus(booking: BookingGroup, status: 'confirmed' | 'completed' | 'no_show' | 'cancelled') {
    if (!booking.legacyAppointmentId) return;
    const reason = status === 'cancelled' ? (window.prompt('İptal nedeni (isteğe bağlı):') ?? '') : '';
    const fingerprint = `legacy-status:${booking.legacyAppointmentId}:${status}:${reason}`;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/${booking.legacyAppointmentId}/status`, {
        method: 'POST', headers: { 'Idempotency-Key': stableMutationKey(fingerprint) },
        body: JSON.stringify({ status, reason }),
      });
      await reloadAfterMutation(`Randevu: ${statusText[status]}.`, fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Durum güncellenemedi.'); }
    finally { setBusy(false); }
  }

  async function cancelGroup(booking: BookingGroup) {
    const reason = window.prompt('Tüm rezervasyon için iptal nedeni (isteğe bağlı):') ?? '';
    const fingerprint = `group-cancel:${booking.groupId}:${booking.version}:${reason}`;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/groups/${booking.groupId}/cancel`, {
        method: 'POST', headers: { 'Idempotency-Key': stableMutationKey(fingerprint) },
        body: JSON.stringify({ expectedVersion: booking.version, reason }),
      });
      await reloadAfterMutation('Rezervasyon grubu iptal edildi.', fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Rezervasyon grubu iptal edilemedi.'); }
    finally { setBusy(false); }
  }

  async function cancelLine(booking: BookingGroup, line: BookingLine) {
    const reason = window.prompt(`${line.serviceName} için iptal nedeni (isteğe bağlı):`) ?? '';
    const fingerprint = `line-cancel:${booking.groupId}:${line.appointmentId}:${booking.version}:${reason}`;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/groups/${booking.groupId}/lines/${line.appointmentId}/cancel`, {
        method: 'POST', headers: { 'Idempotency-Key': stableMutationKey(fingerprint) },
        body: JSON.stringify({ expectedVersion: booking.version, reason }),
      });
      await reloadAfterMutation(`${line.serviceName} hizmeti iptal edildi.`, fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Hizmet iptal edilemedi.'); }
    finally { setBusy(false); }
  }

  function openReschedule(booking: BookingGroup) {
    setRescheduleTarget({ booking, key: commandKey() });
    setRescheduleDate(dateInZone(booking.startsAt, booking.timezone));
    setRescheduleStaff(booking.lines[0]?.staffId ?? 'any');
    setRescheduleSlots([]); setSelectedRescheduleSlot(null); setNotice('');
  }

  async function previewReschedule() {
    if (!rescheduleTarget) return;
    const { booking } = rescheduleTarget;
    setBusy(true); setNotice(''); setRescheduleSlots([]); setSelectedRescheduleSlot(null);
    try {
      if (booking.managementMode === 'group') {
        const params = new URLSearchParams({ date: rescheduleDate, step: '15' });
        const result = await api<{ slots: GroupSlot[] }>(`/api/bookings/groups/${booking.groupId}/reschedule-slots?${params}`);
        setRescheduleSlots(result.slots);
        setNotice(result.slots.length ? `${result.slots.length} grup taşıma seçeneği bulundu.` : 'Grubu taşımak için boş saat yok.');
      } else if (booking.legacyAppointmentId) {
        const params = new URLSearchParams({ date: rescheduleDate, staffId: rescheduleStaff, step: '15' });
        const result = await api<{ slots: Slot[] }>(`/api/bookings/${booking.legacyAppointmentId}/reschedule-slots?${params}`);
        setRescheduleSlots(result.slots);
        setNotice(result.slots.length ? `${result.slots.length} taşıma seçeneği bulundu.` : 'Taşıma için boş saat yok.');
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Taşıma saatleri hesaplanamadı.'); }
    finally { setBusy(false); }
  }

  async function commitReschedule() {
    if (!rescheduleTarget || !selectedRescheduleSlot) return;
    const { booking, key } = rescheduleTarget;
    setBusy(true); setNotice('');
    try {
      if (booking.managementMode === 'group') {
        await api(`/api/bookings/groups/${booking.groupId}/reschedule`, {
          method: 'POST', headers: { 'Idempotency-Key': key },
          body: JSON.stringify({ expectedVersion: booking.version, startsAt: selectedRescheduleSlot.starts_at }),
        });
      } else if (booking.legacyAppointmentId && 'staff_id' in selectedRescheduleSlot) {
        await api(`/api/bookings/${booking.legacyAppointmentId}/reschedule`, {
          method: 'POST', headers: { 'Idempotency-Key': key },
          body: JSON.stringify({ staffId: selectedRescheduleSlot.staff_id, startsAt: selectedRescheduleSlot.starts_at }),
        });
      }
      setRescheduleTarget(null); setRescheduleSlots([]); setSelectedRescheduleSlot(null);
      await load(); setNotice('Rezervasyon yeni saate taşındı.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Randevu taşınamadı.'); }
    finally { setBusy(false); }
  }

  function openServiceChange(booking: BookingGroup, line: BookingLine) {
    setServiceTarget({ booking, line, key: commandKey() });
    setReplacementServiceId(line.serviceId);
    setNotice('');
  }

  async function commitServiceChange() {
    if (!serviceTarget || !replacementServiceId) return;
    const { booking, line, key } = serviceTarget;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/groups/${booking.groupId}/lines/${line.appointmentId}/service`, {
        method: 'POST', headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ expectedVersion: booking.version, serviceId: replacementServiceId }),
      });
      setServiceTarget(null);
      await load(); setNotice('Hizmet satırı güncellendi.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Hizmet değiştirilemedi.'); }
    finally { setBusy(false); }
  }

  function openLineSchedule(booking: BookingGroup, line: BookingLine) {
    setLineScheduleTarget({ booking, line, key: commandKey() });
    setLineDate(dateInZone(line.startsAt, booking.timezone));
    setLineTime(timeInZone(line.startsAt, booking.timezone));
    setLineStaff(line.staffId);
    setNotice('');
  }

  async function commitLineSchedule() {
    if (!lineScheduleTarget || !lineStaff) return;
    const { booking, line, key } = lineScheduleTarget;
    setBusy(true); setNotice('');
    try {
      const startsAt = zonedLocalToIso(lineDate, lineTime, booking.timezone);
      await api(`/api/bookings/groups/${booking.groupId}/lines/${line.appointmentId}/reschedule`, {
        method: 'POST', headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ expectedVersion: booking.version, staffId: lineStaff, startsAt }),
      });
      setLineScheduleTarget(null);
      await load(); setNotice('Hizmet satırı yeni saate taşındı.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Hizmet satırı taşınamadı.'); }
    finally { setBusy(false); }
  }

  async function showHistory(booking: BookingGroup) {
    if (!booking.legacyAppointmentId) return;
    setBusy(true); setNotice('');
    try {
      const result = await api<{ events: AppointmentEvent[]; page: PageInfo }>(`/api/bookings/${booking.legacyAppointmentId}/events?limit=25`);
      setEventsFor(booking); setEvents(result.events); setEventsNextCursor(result.page.nextCursor);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Randevu geçmişi okunamadı.'); }
    finally { setBusy(false); }
  }

  async function loadMoreEvents() {
    if (!eventsFor?.legacyAppointmentId || !eventsNextCursor) return;
    setBusy(true); setNotice('');
    try {
      const params = new URLSearchParams({ limit: '25', cursor: eventsNextCursor });
      const result = await api<{ events: AppointmentEvent[]; page: PageInfo }>(`/api/bookings/${eventsFor.legacyAppointmentId}/events?${params}`);
      setEvents((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...result.events.filter((item) => !existing.has(item.id))];
      });
      setEventsNextCursor(result.page.nextCursor);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Diğer geçmiş kayıtları yüklenemedi.'); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="booking-page"><section className="booking-card"><p>Booking motoru hazırlanıyor…</p></section></main>;
  if (!session?.user || !session.activeBusinessId || !catalog) {
    return <main className="booking-page"><section className="booking-card"><p className="eyebrow">RANDEVU</p><h1>Önce çalışma alanını seçin.</h1><p className="muted">Giriş ve işletme seçimi ana çalışma alanında yapılır.</p><a className="primary-link" href="/">Çalışma alanına dön</a></section></main>;
  }

  return <div className="booking-page">
    <header className="booking-hero">
      <div><p className="eyebrow">RANDEVU YÖNETİMİ</p><h1>Rezervasyonu tek birim olarak yönet</h1><p className="muted">{timezone} · çok hizmetli rezervasyonlarda grup CAS ve satır otoritesi aktif.</p></div>
      <span className="role-badge">{catalog.membership.role}</span>
    </header>

    {notice && <div className="notice" role="status">{notice}</div>}

    <div className="booking-grid">
      <section className="booking-card booking-composer">
        <div className="section-head"><h2>Yeni tek hizmetli randevu</h2><span>{slots.length ? `${slots.length} slot` : '1 · müşteri'}</span></div>
        <div className="booking-fields">
          <label>Müşteri<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ad soyad" maxLength={120} /></label>
          <label>Telefon<input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="+90…" maxLength={40} /></label>
          <label>E-posta<input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} type="email" placeholder="mail@…" maxLength={254} /></label>
          <label>Hizmet<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setStaffId('any'); setSlots([]); setSelectedSlot(null); }}>
            {activeServices.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.duration_minutes} dk · {money(service.price_minor, service.currency)}</option>)}
          </select></label>
          <label>Personel<select value={staffId} onChange={(event) => { setStaffId(event.target.value); setSlots([]); setSelectedSlot(null); }}>
            <option value="any">Fark etmez</option>{eligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>Tarih<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSlots([]); setSelectedSlot(null); }} /></label>
          <label className="wide-field">Not<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="İsteğe bağlı not" /></label>
        </div>
        {hasRangeServices && <p className="muted">Fiyat aralıklı veya çok hizmetli rezervasyonlar grup motorunda authoritative estimate ile yönetilir.</p>}
        <div className="booking-actions"><button className="secondary-button" disabled={busy || !serviceId} onClick={() => void previewSlots()}>Boş saatleri getir</button></div>

        <div className="slot-cloud">
          {slots.map((slot) => <button type="button" className={selectedSlot?.starts_at === slot.starts_at && selectedSlot.staff_id === slot.staff_id ? 'slot-button selected' : 'slot-button'} key={`${slot.staff_id}-${slot.starts_at}`} onClick={() => setSelectedSlot(slot)}>
            <strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{slot.staff_name}</span>
          </button>)}
        </div>
        {selectedSlot && <div className="booking-confirm"><div><strong>{formatDateTime(selectedSlot.starts_at, selectedSlot.timezone)}</strong><span>{selectedSlot.staff_name}</span></div><button className="primary-button" disabled={busy || customerName.trim().length < 2} onClick={() => void createBooking()}>Randevuyu oluştur</button></div>}
      </section>

      <section className="booking-card booking-list-card">
        <div className="section-head"><h2>Rezervasyonlar</h2><span>{bookings.length}{bookingsNextCursor ? '+' : ''}</span></div>
        <div className="appointment-list">
          {bookings.map((booking) => <article className={`appointment-row status-${booking.status}`} key={booking.groupId}>
            <div className="appointment-time"><strong>{formatDateTime(booking.startsAt, booking.timezone)}</strong><span>{booking.lineCount} hizmet · {formatTime(booking.endsAt, booking.timezone)} bitiş</span></div>
            <div className="appointment-main">
              <div><strong>{booking.customerName}</strong><span>{booking.lines.map((line) => line.serviceName).join(' + ')} · tahmini {estimateText(booking)}</span></div>
              <span className="status-pill">{statusText[booking.status]}</span>
            </div>
            <div className="appointment-list">
              {booking.lines.map((line) => <div className={`appointment-row status-${line.status}`} key={line.appointmentId}>
                <div className="appointment-time"><strong>{line.lineOrdinal}. {formatTime(line.startsAt, booking.timezone)} · {line.staffName}</strong><span>{formatTime(line.endsAt, booking.timezone)} bitiş</span></div>
                <div className="appointment-main"><div><strong>{line.serviceName}</strong><span>{priceText(line)}</span></div><span className="status-pill">{statusText[line.status]}</span></div>
                {booking.managementMode === 'group' && (line.status === 'scheduled' || line.status === 'confirmed') && <div className="appointment-actions">
                  <button disabled={busy} onClick={() => openServiceChange(booking, line)}>Hizmeti değiştir</button>
                  <button disabled={busy} onClick={() => openLineSchedule(booking, line)}>Satırı taşı</button>
                  <button disabled={busy} onClick={() => void cancelLine(booking, line)}>Satırı iptal et</button>
                </div>}
              </div>)}
            </div>
            <div className="appointment-actions">
              {booking.managementMode === 'legacy_single' ? <>
                {booking.status === 'scheduled' && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'confirmed')}>Onayla</button>}
                {(booking.status === 'scheduled' || booking.status === 'confirmed') && <button disabled={busy} onClick={() => openReschedule(booking)}>Taşı</button>}
                {(booking.status === 'scheduled' || booking.status === 'confirmed') && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'cancelled')}>İptal</button>}
                {booking.status === 'confirmed' && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'completed')}>Tamamlandı</button>}
                {booking.status === 'confirmed' && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'no_show')}>Gelmedi</button>}
                <button disabled={busy} onClick={() => void showHistory(booking)}>Geçmiş</button>
              </> : <>
                {booking.canRescheduleGroup && <button disabled={busy} onClick={() => openReschedule(booking)}>Tümünü taşı</button>}
                {booking.canCancelGroup && <button disabled={busy} onClick={() => void cancelGroup(booking)}>Tümünü iptal et</button>}
              </>}
            </div>
          </article>)}
          {!bookings.length && <p className="empty">Henüz randevu yok. İlk slotu soldan kilitle.</p>}
        </div>
        {bookingsNextCursor && <div className="booking-actions"><button className="secondary-button" disabled={busy} onClick={() => void loadMoreBookings()}>Daha fazla randevu yükle</button></div>}
      </section>
    </div>

    {rescheduleTarget && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">TAŞI</p><h2>{rescheduleTarget.booking.customerName} · {rescheduleTarget.booking.lineCount} hizmet</h2></div><button onClick={() => setRescheduleTarget(null)}>Kapat</button></div>
      <div className="reschedule-controls">
        <input type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} />
        {rescheduleTarget.booking.managementMode === 'legacy_single' && <select value={rescheduleStaff} onChange={(event) => setRescheduleStaff(event.target.value)}><option value="any">Fark etmez</option>{legacyRescheduleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
        <button className="secondary-button" disabled={busy} onClick={() => void previewReschedule()}>Saatleri getir</button>
      </div>
      <div className="slot-cloud">{rescheduleSlots.map((slot) => {
        const staff = 'staff_name' in slot ? slot.staff_name : `${rescheduleTarget.booking.lineCount} hizmet birlikte`;
        const selected = selectedRescheduleSlot?.starts_at === slot.starts_at && (!('staff_id' in slot) || !selectedRescheduleSlot || !('staff_id' in selectedRescheduleSlot) || selectedRescheduleSlot.staff_id === slot.staff_id);
        return <button type="button" className={selected ? 'slot-button selected' : 'slot-button'} key={`${'staff_id' in slot ? slot.staff_id : 'group'}-${slot.starts_at}`} onClick={() => setSelectedRescheduleSlot(slot)}><strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{staff}</span></button>;
      })}</div>
      {selectedRescheduleSlot && <div className="booking-confirm"><div><strong>{formatDateTime(selectedRescheduleSlot.starts_at, selectedRescheduleSlot.timezone)}</strong><span>{rescheduleTarget.booking.managementMode === 'group' ? 'Tüm hizmetler birlikte taşınır' : 'Tek hizmetli randevu'}</span></div><button className="primary-button" disabled={busy} onClick={() => void commitReschedule()}>Yeni saate taşı</button></div>}
    </section>}

    {serviceTarget && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">HİZMETİ DEĞİŞTİR</p><h2>{serviceTarget.line.serviceName}</h2></div><button onClick={() => setServiceTarget(null)}>Kapat</button></div>
      <p className="muted">Satırın personel ve saati korunur. Süre/buffer/processing footprint'i farklı bir hizmet seçilirse sunucu grup replani ister.</p>
      <div className="reschedule-controls">
        <select value={replacementServiceId} onChange={(event) => setReplacementServiceId(event.target.value)}>{editableServices.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.duration_minutes} dk</option>)}</select>
        <button className="primary-button" disabled={busy || !replacementServiceId || replacementServiceId === serviceTarget.line.serviceId} onClick={() => void commitServiceChange()}>Hizmeti değiştir</button>
      </div>
    </section>}

    {lineScheduleTarget && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">SATIRI TAŞI</p><h2>{lineScheduleTarget.line.serviceName}</h2></div><button onClick={() => setLineScheduleTarget(null)}>Kapat</button></div>
      <p className="muted">Yalnız bu hizmet satırı taşınır. Sunucu personel yetkisini, çalışma saatini, blokları, sibling çakışmasını ve group version'ı doğrular.</p>
      <div className="reschedule-controls">
        <input type="date" value={lineDate} onChange={(event) => setLineDate(event.target.value)} />
        <input type="time" value={lineTime} onChange={(event) => setLineTime(event.target.value)} />
        <select value={lineStaff} onChange={(event) => setLineStaff(event.target.value)}>{lineEligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        <button className="primary-button" disabled={busy || !lineStaff} onClick={() => void commitLineSchedule()}>Satırı taşı</button>
      </div>
    </section>}

    {eventsFor && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">AUDIT</p><h2>{eventsFor.customerName} · geçmiş</h2></div><button onClick={() => { setEventsFor(null); setEvents([]); setEventsNextCursor(null); }}>Kapat</button></div>
      <div className="event-list">{events.map((event) => <div className="event-row" key={event.id}><strong>{event.event_type}</strong><span>{formatDateTime(event.created_at, timezone)}</span><small>{event.from_status ?? '∅'} → {event.to_status ?? '∅'}</small></div>)}</div>
      {eventsNextCursor && <div className="booking-actions"><button className="secondary-button" disabled={busy} onClick={() => void loadMoreEvents()}>Daha fazla geçmiş yükle</button></div>}
    </section>}
  </div>;
}
