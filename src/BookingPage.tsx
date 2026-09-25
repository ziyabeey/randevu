import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { intlLocale, t } from './i18n';
import { api } from './api';
import { navigateApp } from './workspace-route';
import { useWorkspace } from './workspace-context';

type Role = 'owner' | 'manager' | 'staff';
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
type SeriesPreviewOccurrence = {
  ordinal: number;
  startsAt: string;
  localDate: string;
  localTime: string;
  available: boolean;
};
type SeriesPreview = {
  frequency: 'daily' | 'weekly';
  occurrenceCount: number;
  timezone: string;
  allAvailable: boolean;
  occurrences: SeriesPreviewOccurrence[];
};
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
  seriesId?: string | null;
  seriesOrdinal?: number | null;
};
type AppointmentEvent = {
  id: string; event_type: string; actor_user_id: string; from_status: string | null;
  to_status: string | null; payload: Record<string, unknown>; created_at: string;
};
type SeriesDetail = {
  seriesId: string;
  businessId: string;
  customerId: string;
  frequency: 'daily' | 'weekly';
  occurrenceCount: number;
  timezone: string;
  anchorStartsAt: string;
  version: number;
  status: 'active' | 'cancelled';
  occurrences: BookingGroup[];
  events: Array<{ eventId: string; seriesVersion: number; eventType: string; payload: Record<string, unknown>; createdAt: string }>;
};
type SeriesFutureTarget = {
  groupId: string;
  ordinal: number;
  groupVersion: number;
  startsAt: string;
  targetStartsAt: string | null;
  localDate: string;
  available: boolean;
};
type SeriesFuturePreview = {
  seriesId: string;
  seriesVersion: number;
  action: 'reschedule_future' | 'cancel_future';
  fromOrdinal: number;
  timezone?: string;
  allAvailable: boolean;
  targets: SeriesFutureTarget[];
  conflicts: Array<{ groupId: string; ordinal: number; localDate: string; reason: string }>;
  skipped: Array<{ groupId: string; ordinal: number; startsAt: string; reason: string }>;
};
type PageInfo = { limit: number; hasMore: boolean; nextCursor: string | null };
type RescheduleTarget = { booking: BookingGroup; key: string };
type LineTarget = { booking: BookingGroup; line: BookingLine; key: string };
type DraftLine = { key: string; serviceId: string; staffId: string };

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
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = date.split('-').map(Number);
  const [hour = Number.NaN, minute = Number.NaN] = time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error(t('Tarih veya saat geçerli değil.'));
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
    throw new Error(t('Bu yerel saat seçilen zaman diliminde geçerli değil.'));
  }
  return result.toISOString();
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: timezone, dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: timezone, hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(value / 100);
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

const statusText: Record<GroupStatus, string> = {
  scheduled: 'Planlandı', confirmed: 'Onaylandı', completed: 'Tamamlandı', no_show: 'Gelmedi', cancelled: 'İptal', partial: 'Kısmi',
};

export default function BookingPage() {
  const { activeBusinessId, scopeEpoch } = useWorkspace();
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
  const [date, setDate] = useState(dateToday());
  const [createLines, setCreateLines] = useState<DraftLine[]>([
    { key: commandKey(), serviceId: '', staffId: 'any' },
  ]);
  const [createSlots, setCreateSlots] = useState<GroupSlot[]>([]);
  const [selectedCreateSlot, setSelectedCreateSlot] = useState<GroupSlot | null>(null);
  const [createSlotsBusy, setCreateSlotsBusy] = useState(false);
  const createSlotGeneration = useRef(0);
  const createSlotController = useRef<AbortController | null>(null);
  const loadGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const workspaceGeneration = useRef(0);
  const [createKey, setCreateKey] = useState(commandKey);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<'none' | 'daily' | 'weekly'>('none');
  const [recurrenceCount, setRecurrenceCount] = useState(2);
  const [seriesPreview, setSeriesPreview] = useState<SeriesPreview | null>(null);
  const [seriesPreviewBusy, setSeriesPreviewBusy] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeDate, setCloseDate] = useState(dateToday());
  const [closeStart, setCloseStart] = useState('09:00');
  const [closeEnd, setCloseEnd] = useState('10:00');
  const [closeStaff, setCloseStaff] = useState('all');
  const [closeReason, setCloseReason] = useState('');
  const [detailFor, setDetailFor] = useState<BookingGroup | null>(null);

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

  const [seriesFor, setSeriesFor] = useState<BookingGroup | null>(null);
  const [seriesDetail, setSeriesDetail] = useState<SeriesDetail | null>(null);
  const [seriesAction, setSeriesAction] = useState<'reschedule' | 'cancel'>('reschedule');
  const [seriesFromOrdinal, setSeriesFromOrdinal] = useState(1);
  const [seriesDate, setSeriesDate] = useState(dateToday());
  const [seriesTime, setSeriesTime] = useState('09:00');
  const [seriesReason, setSeriesReason] = useState('');
  const [seriesFuturePreview, setSeriesFuturePreview] = useState<SeriesFuturePreview | null>(null);
  const seriesReadGeneration = useRef(0);
  const seriesReadController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    try {
      const [nextCatalog, nextSetup, nextBookings] = await Promise.all([
        api<Catalog>('/api/catalog', { signal: controller.signal }),
        api<Setup>('/api/availability/setup', { signal: controller.signal }),
        api<{ bookings: BookingGroup[]; page: PageInfo }>('/api/bookings/groups?limit=25', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted || generation !== loadGeneration.current) return;
      if (nextCatalog.membership.business_id !== activeBusinessId) {
        throw new Error(t('Randevu verileri güncel işletme bağlamıyla eşleşmiyor.'));
      }
      setCatalog(nextCatalog);
      setTimezone(nextSetup.timezone);
      setBookings(nextBookings.bookings);
      setBookingsNextCursor(nextBookings.page.nextCursor);
      setCreateLines((current) => {
        const active = nextCatalog.services.filter((item) => item.active);
        const firstService = active[0]?.id ?? '';
        if (!current.length) return [{ key: commandKey(), serviceId: firstService, staffId: 'any' }];
        return current.map((line) => ({
          ...line,
          serviceId: active.some((item) => item.id === line.serviceId) ? line.serviceId : firstService,
          staffId: nextCatalog.assignments.some((item) => item.active && item.service_id === line.serviceId && item.staff_id === line.staffId)
            ? line.staffId : 'any',
        }));
      });
    } catch (error) {
      if (controller.signal.aborted || generation !== loadGeneration.current) return;
      setNotice(error instanceof Error ? error.message : t('Randevu ekranı yüklenemedi.'));
    } finally {
      if (generation === loadGeneration.current) {
        loadController.current = null;
        setLoading(false);
      }
    }
  }, [activeBusinessId]);

  useEffect(() => {
    workspaceGeneration.current += 1;

    createSlotGeneration.current += 1;
    createSlotController.current?.abort();
    createSlotController.current = null;

    seriesReadGeneration.current += 1;
    seriesReadController.current?.abort();
    seriesReadController.current = null;

    mutationKeys.current.clear();
    setCatalog(null);
    setBookings([]);
    setBookingsNextCursor(null);
    setCreateSlots([]);
    setSelectedCreateSlot(null);
    setCreateSlotsBusy(false);
    setSeriesPreview(null);
    setSeriesPreviewBusy(false);
    setDetailFor(null);
    setRescheduleTarget(null);
    setServiceTarget(null);
    setLineScheduleTarget(null);
    setEventsFor(null);
    setEvents([]);
    setSeriesFor(null);
    setSeriesDetail(null);
    setSeriesFuturePreview(null);
    setBusy(false);
    void load();
  }, [load, scopeEpoch]);

  useEffect(() => () => {
    loadGeneration.current += 1;
    loadController.current?.abort();
    createSlotGeneration.current += 1;
    createSlotController.current?.abort();
    seriesReadGeneration.current += 1;
    seriesReadController.current?.abort();
  }, []);

  const activeServices = useMemo(() => catalog?.services.filter((item) => item.active) ?? [], [catalog]);
  const editableServices = activeServices;
  const hasRangeServices = useMemo(() => activeServices.some((item) => item.price_type === 'range'), [activeServices]);
  const activeStaff = useMemo(() => catalog?.staff.filter((item) => item.active) ?? [], [catalog]);

  function eligibleStaffFor(serviceId: string) {
    if (!catalog || !serviceId) return [];
    const ids = new Set(catalog.assignments
      .filter((item) => item.active && item.service_id === serviceId)
      .map((item) => item.staff_id));
    return activeStaff.filter((person) => ids.has(person.id));
  }
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

  function beginSeriesRead() {
    const generation = seriesReadGeneration.current + 1;
    seriesReadGeneration.current = generation;
    seriesReadController.current?.abort();
    const controller = new AbortController();
    seriesReadController.current = controller;
    return { generation, controller };
  }

  function seriesReadIsCurrent(generation: number, controller: AbortController) {
    return !controller.signal.aborted && generation === seriesReadGeneration.current;
  }

  function invalidateSeriesRead() {
    seriesReadGeneration.current += 1;
    seriesReadController.current?.abort();
    seriesReadController.current = null;
    setSeriesPreviewBusy(false);
  }

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
    setDetailFor(null);
    await load();
    setNotice(message);
  }

  async function openTicketForBooking(booking: BookingGroup) {
    const fingerprint = `ticket:${booking.groupId}`;
    const key = stableMutationKey(fingerprint);
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ ticket: { ticketId: string } }>('/api/tickets/from-booking-group', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ bookingGroupId: booking.groupId }),
        timeoutMs: 12_000,
      });
      mutationKeys.current.delete(fingerprint);
      navigateApp(`/app/mobile/tickets?ticketId=${encodeURIComponent(result.ticket.ticketId)}`);
    } catch (error) {
      const ambiguous = error instanceof Error
        && ('code' in error)
        && ((error as { code?: string }).code === 'NETWORK_UNAVAILABLE'
          || (error as { code?: string }).code === 'REQUEST_TIMEOUT');
      if (ambiguous) {
        setNotice(t('Adisyon açma sonucu henüz doğrulanamadı. Tekrar deneyin; aynı işlem anahtarı kullanılacak.'));
      } else {
        mutationKeys.current.delete(fingerprint);
        setNotice(error instanceof Error ? error.message : t('Adisyon açılamadı.'));
      }
    } finally {
      setBusy(false);
    }
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
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Diğer randevular yüklenemedi.')); }
    finally { setBusy(false); }
  }

  function resetCreateAvailability(rotateKey = true) {
    createSlotGeneration.current += 1;
    createSlotController.current?.abort();
    createSlotController.current = null;
    setCreateSlotsBusy(false);
    setCreateSlots([]);
    setSelectedCreateSlot(null);
    invalidateSeriesRead();
    setSeriesPreview(null);
    if (rotateKey) setCreateKey(commandKey());
  }

  function updateCreateLine(key: string, patch: Partial<Pick<DraftLine, 'serviceId' | 'staffId'>>) {
    setCreateLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.serviceId !== undefined) next.staffId = 'any';
      return next;
    }));
    resetCreateAvailability();
  }

  function addCreateLine() {
    const serviceId = activeServices[0]?.id ?? '';
    setCreateLines((current) => current.length >= 10
      ? current
      : [...current, { key: commandKey(), serviceId, staffId: 'any' }]);
    resetCreateAvailability();
  }

  function removeCreateLine(key: string) {
    setCreateLines((current) => current.length <= 1 ? current : current.filter((line) => line.key !== key));
    resetCreateAvailability();
  }

  async function previewCreateSlots() {
    if (!createLines.length || createLines.some((line) => !line.serviceId)) return;
    const generation = createSlotGeneration.current + 1;
    createSlotGeneration.current = generation;
    createSlotController.current?.abort();
    const controller = new AbortController();
    createSlotController.current = controller;
    setCreateSlotsBusy(true); setNotice(''); setCreateSlots([]); setSelectedCreateSlot(null);
    try {
      const result = await api<{ slots: GroupSlot[] }>('/api/availability/group-slots', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          date,
          step: 15,
          lines: createLines.map((line) => ({
            serviceId: line.serviceId,
            staffId: line.staffId === 'any' ? null : line.staffId,
          })),
        }),
      });
      if (controller.signal.aborted || generation !== createSlotGeneration.current) return;
      setCreateSlots(result.slots);
      setNotice(result.slots.length ? t('{count} uygun grup saati bulundu.', { count: result.slots.length }) : t('Bu hizmet planı için boş saat yok.'));
    } catch (error) {
      if (controller.signal.aborted || generation !== createSlotGeneration.current) return;
      setNotice(error instanceof Error ? error.message : t('Saatler hesaplanamadı.'));
    } finally {
      if (generation === createSlotGeneration.current) {
        createSlotController.current = null;
        setCreateSlotsBusy(false);
      }
    }
  }

  async function previewSeriesCreate() {
    if (!selectedCreateSlot || recurrenceFrequency === 'none') return;
    const { generation, controller } = beginSeriesRead();
    setSeriesPreviewBusy(true); setNotice(''); setSeriesPreview(null);
    try {
      const result = await api<{ preview: SeriesPreview }>('/api/bookings/series/preview', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          lines: createLines.map((line) => ({
            serviceId: line.serviceId,
            staffId: line.staffId === 'any' ? null : line.staffId,
          })),
          startsAt: selectedCreateSlot.starts_at,
          frequency: recurrenceFrequency,
          count: recurrenceCount,
        }),
      });
      if (!seriesReadIsCurrent(generation, controller)) return;
      setSeriesPreview(result.preview);
      setNotice(result.preview.allAvailable
        ? t('{count} tekrarın tamamı uygun.', { count: result.preview.occurrenceCount })
        : t('Serideki en az bir tekrar uygun değil. Tarih veya saati değiştirin.'));
    } catch (error) {
      if (!seriesReadIsCurrent(generation, controller)) return;
      setNotice(error instanceof Error ? error.message : t('Seri önizlemesi hazırlanamadı.'));
    } finally {
      if (generation === seriesReadGeneration.current) {
        seriesReadController.current = null;
        setSeriesPreviewBusy(false);
      }
    }
  }

  async function createBooking() {
    if (!selectedCreateSlot || !createLines.length) return;
    const scopeGeneration = workspaceGeneration.current;
    if (recurrenceFrequency !== 'none' && (!seriesPreview || !seriesPreview.allAvailable)) {
      setNotice(t('Seriyi oluşturmadan önce tüm tekrarları önizleyin.'));
      return;
    }
    setBusy(true); setNotice('');
    try {
      const payload = {
        customerName, customerPhone, customerEmail, notes,
        lines: createLines.map((line) => ({
          serviceId: line.serviceId,
          staffId: line.staffId === 'any' ? null : line.staffId,
        })),
        startsAt: selectedCreateSlot.starts_at,
      };
      const successMessage = recurrenceFrequency === 'none'
        ? t('Rezervasyon atomik olarak oluşturuldu.')
        : t('{count} randevuluk seri atomik olarak oluşturuldu.', { count: recurrenceCount });
      if (recurrenceFrequency === 'none') {
        await api('/api/bookings/groups', {
          method: 'POST',
          headers: { 'Idempotency-Key': createKey },
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/bookings/series', {
          method: 'POST',
          headers: { 'Idempotency-Key': createKey },
          body: JSON.stringify({
            ...payload,
            frequency: recurrenceFrequency,
            count: recurrenceCount,
          }),
        });
      }
      if (scopeGeneration !== workspaceGeneration.current) return;
      setNotice(successMessage);
      setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setNotes('');
      const firstService = activeServices[0]?.id ?? '';
      setCreateLines([{ key: commandKey(), serviceId: firstService, staffId: 'any' }]);
      setCreateSlots([]); setSelectedCreateSlot(null); setCreateKey(commandKey());
      setRecurrenceFrequency('none'); setRecurrenceCount(2); setSeriesPreview(null);
      await load();
    } catch (error) {
      if (scopeGeneration !== workspaceGeneration.current) return;
      setNotice(error instanceof Error ? error.message : t('Randevu oluşturulamadı.'));
    } finally {
      if (scopeGeneration === workspaceGeneration.current) setBusy(false);
    }
  }

  async function createCloseBlock() {
    setBusy(true); setNotice('');
    try {
      await api('/api/availability/blocks', {
        method: 'POST',
        body: JSON.stringify({
          date: closeDate,
          start: closeStart,
          end: closeEnd,
          staffId: closeStaff === 'all' ? null : closeStaff,
          reason: closeReason,
        }),
      });
      setCloseOpen(false);
      setCloseReason('');
      resetCreateAvailability();
      setNotice(t('Saat kapatıldı. Yeni müsaitlik araması bu kapanışı dikkate alacak.'));
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Saat kapatılamadı.')); }
    finally { setBusy(false); }
  }

  async function changeGroupStatus(booking: BookingGroup, status: 'confirmed' | 'completed' | 'no_show') {
    const fingerprint = `group-status:${booking.groupId}:${booking.version}:${status}`;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/groups/${booking.groupId}/status`, {
        method: 'POST',
        headers: { 'Idempotency-Key': stableMutationKey(fingerprint) },
        body: JSON.stringify({ expectedVersion: booking.version, status }),
      });
      await reloadAfterMutation(t('Rezervasyon: {status}.', { status: t(statusText[status]) }), fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Rezervasyon durumu güncellenemedi.')); }
    finally { setBusy(false); }
  }

  async function changeLegacyStatus(booking: BookingGroup, status: 'confirmed' | 'completed' | 'no_show' | 'cancelled') {
    if (!booking.legacyAppointmentId) return;
    const reason = status === 'cancelled' ? (window.prompt(t('İptal nedeni (isteğe bağlı):')) ?? '') : '';
    const fingerprint = `legacy-status:${booking.legacyAppointmentId}:${status}:${reason}`;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/${booking.legacyAppointmentId}/status`, {
        method: 'POST', headers: { 'Idempotency-Key': stableMutationKey(fingerprint) },
        body: JSON.stringify({ status, reason }),
      });
      await reloadAfterMutation(t('Randevu: {status}.', { status: t(statusText[status]) }), fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Durum güncellenemedi.')); }
    finally { setBusy(false); }
  }

  async function cancelGroup(booking: BookingGroup) {
    const reason = window.prompt(t('Tüm rezervasyon için iptal nedeni (isteğe bağlı):')) ?? '';
    const fingerprint = `group-cancel:${booking.groupId}:${booking.version}:${reason}`;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/groups/${booking.groupId}/cancel`, {
        method: 'POST', headers: { 'Idempotency-Key': stableMutationKey(fingerprint) },
        body: JSON.stringify({ expectedVersion: booking.version, reason }),
      });
      await reloadAfterMutation(t('Rezervasyon grubu iptal edildi.'), fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Rezervasyon grubu iptal edilemedi.')); }
    finally { setBusy(false); }
  }

  async function cancelLine(booking: BookingGroup, line: BookingLine) {
    const reason = window.prompt(t('{service} için iptal nedeni (isteğe bağlı):', { service: line.serviceName })) ?? '';
    const fingerprint = `line-cancel:${booking.groupId}:${line.appointmentId}:${booking.version}:${reason}`;
    setBusy(true); setNotice('');
    try {
      await api(`/api/bookings/groups/${booking.groupId}/lines/${line.appointmentId}/cancel`, {
        method: 'POST', headers: { 'Idempotency-Key': stableMutationKey(fingerprint) },
        body: JSON.stringify({ expectedVersion: booking.version, reason }),
      });
      await reloadAfterMutation(t('{service} hizmeti iptal edildi.', { service: line.serviceName }), fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Hizmet iptal edilemedi.')); }
    finally { setBusy(false); }
  }

  function openReschedule(booking: BookingGroup) {
    setDetailFor(null);
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
        setNotice(result.slots.length ? t('{count} grup taşıma seçeneği bulundu.', { count: result.slots.length }) : t('Grubu taşımak için boş saat yok.'));
      } else if (booking.legacyAppointmentId) {
        const params = new URLSearchParams({ date: rescheduleDate, staffId: rescheduleStaff, step: '15' });
        const result = await api<{ slots: Slot[] }>(`/api/bookings/${booking.legacyAppointmentId}/reschedule-slots?${params}`);
        setRescheduleSlots(result.slots);
        setNotice(result.slots.length ? t('{count} taşıma seçeneği bulundu.', { count: result.slots.length }) : t('Taşıma için boş saat yok.'));
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Taşıma saatleri hesaplanamadı.')); }
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
      await load(); setNotice(t('Rezervasyon yeni saate taşındı.'));
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Randevu taşınamadı.')); }
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
      await load(); setNotice(t('Hizmet satırı güncellendi.'));
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Hizmet değiştirilemedi.')); }
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
      await load(); setNotice(t('Hizmet satırı yeni saate taşındı.'));
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Hizmet satırı taşınamadı.')); }
    finally { setBusy(false); }
  }

  async function openSeriesScope(booking: BookingGroup) {
    if (!booking.seriesId || !booking.seriesOrdinal) return;
    const { generation, controller } = beginSeriesRead();
    setDetailFor(null);
    setSeriesFor(booking);
    setSeriesDetail(null);
    setSeriesFuturePreview(null);
    setSeriesAction('reschedule');
    setSeriesFromOrdinal(booking.seriesOrdinal);
    setSeriesDate(dateInZone(booking.startsAt, booking.timezone));
    setSeriesTime(timeInZone(booking.startsAt, booking.timezone));
    setSeriesReason('');
    setBusy(true); setNotice('');
    try {
      const result = await api<{ series: SeriesDetail }>(`/api/bookings/series/${booking.seriesId}`, {
        signal: controller.signal,
      });
      if (!seriesReadIsCurrent(generation, controller)) return;
      if (result.series.businessId !== activeBusinessId) {
        throw new Error(t('Seri verileri güncel işletme bağlamıyla eşleşmiyor.'));
      }
      setSeriesDetail(result.series);
      setSeriesFromOrdinal(Math.max(1, booking.seriesOrdinal));
    } catch (error) {
      if (!seriesReadIsCurrent(generation, controller)) return;
      setSeriesFor(null);
      setNotice(error instanceof Error ? error.message : t('Seri bilgisi okunamadı.'));
    } finally {
      if (generation === seriesReadGeneration.current) {
        seriesReadController.current = null;
        setBusy(false);
      }
    }
  }

  function seriesNewStartsAt() {
    if (!seriesDetail || seriesAction !== 'reschedule') return null;
    return zonedLocalToIso(seriesDate, seriesTime, seriesDetail.timezone);
  }

  async function previewSeriesFutureScope() {
    if (!seriesFor?.seriesId || !seriesDetail) return;
    const requestedSeriesId = seriesFor.seriesId;
    const { generation, controller } = beginSeriesRead();
    setBusy(true); setNotice(''); setSeriesFuturePreview(null);
    try {
      const newStartsAt = seriesNewStartsAt();
      const result = await api<{ preview: SeriesFuturePreview }>(
        `/api/bookings/series/${requestedSeriesId}/future/preview`,
        {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            fromOrdinal: seriesFromOrdinal,
            action: seriesAction === 'reschedule' ? 'reschedule_future' : 'cancel_future',
            newStartsAt,
          }),
        },
      );
      if (!seriesReadIsCurrent(generation, controller)) return;
      if (result.preview.seriesId !== requestedSeriesId) {
        throw new Error(t('Seri kapsamı güncel randevu serisiyle eşleşmiyor.'));
      }
      setSeriesFuturePreview(result.preview);
      const mutable = result.preview.targets.length;
      const skipped = result.preview.skipped.length;
      setNotice(result.preview.allAvailable
        ? (skipped ? t('{count} gelecek randevu kapsamda, {skipped} geçmiş/kapalı kayıt korunacak.', { count: mutable, skipped }) : t('{count} gelecek randevu kapsamda.', { count: mutable }))
        : t('Kapsamda {count} çakışma var; işlem uygulanmayacak.', { count: result.preview.conflicts.length }));
    } catch (error) {
      if (!seriesReadIsCurrent(generation, controller)) return;
      setNotice(error instanceof Error ? error.message : t('Seri kapsamı önizlenemedi.'));
    } finally {
      if (generation === seriesReadGeneration.current) {
        seriesReadController.current = null;
        setBusy(false);
      }
    }
  }

  async function commitSeriesFutureScope() {
    if (!seriesFor?.seriesId || !seriesDetail || !seriesFuturePreview
        || !seriesFuturePreview.targets.length || !seriesFuturePreview.allAvailable) return;
    const scopeGeneration = workspaceGeneration.current;
    const requestedSeriesId = seriesFor.seriesId;
    const newStartsAt = seriesAction === 'reschedule' ? seriesNewStartsAt() : null;
    const fingerprint = [
      'series-future',requestedSeriesId,seriesDetail.version,seriesAction,
      seriesFromOrdinal,newStartsAt ?? '',seriesReason.trim(),
    ].join(':');
    const key = stableMutationKey(fingerprint);
    setBusy(true); setNotice('');
    try {
      if (seriesAction === 'reschedule') {
        await api(`/api/bookings/series/${requestedSeriesId}/future/reschedule`, {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify({
            expectedVersion: seriesDetail.version,
            fromOrdinal: seriesFromOrdinal,
            newStartsAt,
          }),
        });
      } else {
        await api(`/api/bookings/series/${requestedSeriesId}/future/cancel`, {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify({
            expectedVersion: seriesDetail.version,
            fromOrdinal: seriesFromOrdinal,
            reason: seriesReason.trim() || null,
          }),
        });
      }
      if (scopeGeneration !== workspaceGeneration.current) return;
      mutationKeys.current.delete(fingerprint);
      setSeriesFor(null); setSeriesDetail(null); setSeriesFuturePreview(null);
      await load();
      if (scopeGeneration !== workspaceGeneration.current) return;
      setNotice(seriesAction === 'reschedule'
        ? t('Seçilen tekrar ve sonraki uygun randevular atomik olarak taşındı.')
        : t('Seçilen tekrar ve sonraki uygun randevular atomik olarak iptal edildi.'));
    } catch (error) {
      if (scopeGeneration !== workspaceGeneration.current) return;
      const coded = error as Error & { code?: string };
      setNotice(coded.message || t('Seri değişikliği uygulanamadı.'));
      if (coded.code === 'APPOINTMENT_SERIES_VERSION_CONFLICT'
          || coded.code === 'BOOKING_GROUP_VERSION_CONFLICT'
          || coded.code === 'SERIES_FUTURE_OCCURRENCE_UNAVAILABLE') {
        setSeriesFuturePreview(null);
        const { generation, controller } = beginSeriesRead();
        try {
          const refreshed = await api<{ series: SeriesDetail }>(`/api/bookings/series/${requestedSeriesId}`, {
            signal: controller.signal,
          });
          if (!seriesReadIsCurrent(generation, controller)
              || scopeGeneration !== workspaceGeneration.current) return;
          if (refreshed.series.businessId !== activeBusinessId) return;
          setSeriesDetail(refreshed.series);
        } catch {
          // Preserve the mutation error; an aborted/stale refresh must not write UI state.
        } finally {
          if (generation === seriesReadGeneration.current) {
            seriesReadController.current = null;
          }
        }
      }
    } finally {
      if (scopeGeneration === workspaceGeneration.current) setBusy(false);
    }
  }

  async function showHistory(booking: BookingGroup) {
    if (!booking.legacyAppointmentId) return;
    setBusy(true); setNotice('');
    try {
      const result = await api<{ events: AppointmentEvent[]; page: PageInfo }>(`/api/bookings/${booking.legacyAppointmentId}/events?limit=25`);
      setEventsFor(booking); setEvents(result.events); setEventsNextCursor(result.page.nextCursor);
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Randevu geçmişi okunamadı.')); }
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
    } catch (error) { setNotice(error instanceof Error ? error.message : t('Diğer geçmiş kayıtları yüklenemedi.')); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="booking-page"><section className="booking-card"><p>{t('Booking motoru hazırlanıyor…')}</p></section></main>;
  if (!catalog) {
    return <main className="booking-page"><section className="booking-card"><p className="eyebrow">{t('RANDEVU')}</p><h1>{t('Randevular doğrulanamadı.')}</h1><p className="muted">{t('Güncel işletme verilerini yeniden yükleyin.')}</p><button className="primary-button" type="button" onClick={() => void load()}>{t('Tekrar yükle')}</button></section></main>;
  }

  return <div className="booking-page">
    <header className="booking-hero">
      <div><p className="eyebrow">{t('RANDEVU YÖNETİMİ')}</p><h1>{t('Rezervasyonu tek birim olarak yönet')}</h1><p className="muted">{t('{timezone} · çok hizmetli rezervasyonlarda grup CAS ve satır otoritesi aktif.', { timezone: timezone })}</p></div>
      <span className="role-badge">{catalog.membership.role}</span>
    </header>

    {notice && <div className="notice" role="status">{notice}</div>}

    <div className="booking-grid">
      <section className="booking-card booking-composer">
        <div className="section-head"><div><p className="eyebrow">{t('YENİ RANDEVU')}</p><h2>{t('Zaman → müşteri → hizmetler → not')}</h2></div><span>{createSlots.length ? t('{count} saat', { count: createSlots.length }) : t('{count} hizmet', { count: createLines.length })}</span></div>

        <div className="booking-step">
          <span className="booking-step-index">1</span>
          <div><strong>{t('Zaman')}</strong><small>{t('Önce günü ve hizmet planını kur, sonra uygun başlangıç saatini seç.')}</small></div>
        </div>
        <div className="booking-fields">
          <label>{t('Tarih')}<input type="date" value={date} onChange={(event) => { setDate(event.target.value); resetCreateAvailability(); }} /></label>
          <div className="booking-inline-action">
            <span>{t('Saat kapatma')}</span>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => { setCloseDate(date); setCloseOpen((current) => !current); }}>{closeOpen ? t('Kapat') : t('Saat kapat')}</button>
          </div>
        </div>

        {closeOpen && <div className="booking-close-panel">
          <label>{t('Gün')}<input type="date" value={closeDate} onChange={(event) => setCloseDate(event.target.value)} /></label>
          <label>{t('Başlangıç')}<input type="time" value={closeStart} onChange={(event) => setCloseStart(event.target.value)} /></label>
          <label>{t('Bitiş')}<input type="time" value={closeEnd} onChange={(event) => setCloseEnd(event.target.value)} /></label>
          <label>{t('Kapsam')}<select value={closeStaff} onChange={(event) => setCloseStaff(event.target.value)}><option value="all">{t('Tüm salon')}</option>{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="wide-field">{t('Neden')}<input value={closeReason} maxLength={240} onChange={(event) => setCloseReason(event.target.value)} placeholder={t('Toplantı, mola, izin…')} /></label>
          <button className="secondary-button wide-field" type="button" disabled={busy || !['owner','manager'].includes(catalog.membership.role)} onClick={() => void createCloseBlock()}>{['owner','manager'].includes(catalog.membership.role) ? t('Kapanışı kaydet') : t('Yönetici yetkisi gerekli')}</button>
        </div>}

        <div className="booking-step">
          <span className="booking-step-index">2</span>
          <div><strong>{t('Müşteri')}</strong><small>{t('İletişim bilgileri yeni rezervasyon snapshot\'ına yazılır; geçmiş kayıtlar değişmez.')}</small></div>
        </div>
        <div className="booking-fields">
          <label>{t('Müşteri')}<input value={customerName} onChange={(event) => { setCustomerName(event.target.value); setCreateKey(commandKey()); }} placeholder={t('Ad soyad')} maxLength={120} /></label>
          <label>{t('Telefon')}<input value={customerPhone} onChange={(event) => { setCustomerPhone(event.target.value); setCreateKey(commandKey()); }} placeholder="+90…" maxLength={40} /></label>
          <label>{t('E-posta')}<input value={customerEmail} onChange={(event) => { setCustomerEmail(event.target.value); setCreateKey(commandKey()); }} type="email" placeholder={t('mail@…')} maxLength={254} /></label>
        </div>

        <div className="booking-step">
          <span className="booking-step-index">3</span>
          <div><strong>{t('Hizmet / personel satırları')}</strong><small>{t('1–10 hizmet tek rezervasyon olarak planlanır; sunucu hepsini birlikte kilitler.')}</small></div>
        </div>
        <div className="booking-line-editor">
          {createLines.map((line, index) => {
            const staff = eligibleStaffFor(line.serviceId);
            const service = activeServices.find((item) => item.id === line.serviceId);
            return <div className="booking-line-draft" key={line.key}>
              <span className="booking-line-number">{index + 1}</span>
              <label>{t('Hizmet')}<select value={line.serviceId} onChange={(event) => updateCreateLine(line.key, { serviceId: event.target.value })}>
                {activeServices.map((item) => <option key={item.id} value={item.id}>{item.price_type === 'range' ? t('{name} · {minutes} dk · fiyat aralığı', { name: item.name, minutes: item.duration_minutes }) : t('{name} · {minutes} dk · {price}', { name: item.name, minutes: item.duration_minutes, price: money(item.price_minor, item.currency) })}</option>)}
              </select></label>
              <label>{t('Personel')}<select value={line.staffId} onChange={(event) => updateCreateLine(line.key, { staffId: event.target.value })}><option value="any">{t('Fark etmez')}</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <span className="booking-line-meta">{service?.price_type === 'range' ? t('Kesin tutar adisyonda belirlenir') : t('Sabit fiyat')}</span>
              <button className="booking-line-remove" type="button" disabled={busy || createLines.length === 1} onClick={() => removeCreateLine(line.key)}>{t('Kaldır')}</button>
            </div>;
          })}
          <button className="secondary-button" type="button" disabled={busy || createLines.length >= 10 || !activeServices.length} onClick={addCreateLine}>{t('+ Hizmet ekle')}</button>
        </div>
        {hasRangeServices && <p className="muted">{t('Fiyat aralıklı hizmetler tahmin olarak gösterilir; kesin tahsilat bu ekranda üretilmez.')}</p>}
        <div className="booking-actions"><button className="secondary-button" type="button" disabled={busy || createSlotsBusy || createLines.some((line) => !line.serviceId)} onClick={() => void previewCreateSlots()}>{createSlotsBusy ? t('Saatler aranıyor…') : t('Uygun saatleri getir')}</button></div>

        <div className="slot-cloud">
          {createSlots.map((slot) => <button type="button" className={selectedCreateSlot?.starts_at === slot.starts_at ? 'slot-button selected' : 'slot-button'} key={slot.starts_at} onClick={() => { invalidateSeriesRead(); setSelectedCreateSlot(slot); setSeriesPreview(null); setCreateKey(commandKey()); }}>
            <strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{t('{length} hizmet · {total_duration_minutes} dk', { length: createLines.length, total_duration_minutes: slot.total_duration_minutes })}</span>
          </button>)}
        </div>

        <div className="booking-step">
          <span className="booking-step-index">4</span>
          <div><strong>{t('Not ve oluştur')}</strong><small>{t('Tek tıklama, tek idempotency anahtarı; grup ya bütünüyle oluşur ya hiç oluşmaz.')}</small></div>
        </div>
        <div className="booking-fields"><label className="wide-field">{t('Not')}<textarea value={notes} onChange={(event) => { setNotes(event.target.value); setCreateKey(commandKey()); }} maxLength={1000} placeholder={t('İsteğe bağlı not')} /></label></div>
        <div className="booking-future-hints" aria-label={t('Tekrarlayan randevu')}>
          <label>
            <strong>{t('Tekrar')}</strong>
            <select value={recurrenceFrequency} onChange={(event) => {
              invalidateSeriesRead();
              setRecurrenceFrequency(event.target.value as 'none' | 'daily' | 'weekly');
              setSeriesPreview(null);
              setCreateKey(commandKey());
            }}>
              <option value="none">{t('Tek sefer')}</option>
              <option value="daily">{t('Her gün')}</option>
              <option value="weekly">{t('Her hafta')}</option>
            </select>
          </label>
          {recurrenceFrequency !== 'none' && <label>
            <strong>{t('Adet')}</strong>
            <input type="number" min={2} max={12} value={recurrenceCount} onChange={(event) => {
              const next = Math.max(2, Math.min(12, Number(event.target.value) || 2));
              invalidateSeriesRead();
              setRecurrenceCount(next);
              setSeriesPreview(null);
              setCreateKey(commandKey());
            }} />
            <small>{t('En fazla 12 randevu')}</small>
          </label>}
          <span><strong>{t('SMS')}</strong><small>{t('F16-02 ile açılacak')}</small></span>
        </div>
        {selectedCreateSlot && recurrenceFrequency !== 'none' && <div className="booking-actions">
          <button className="secondary-button" type="button" disabled={busy || seriesPreviewBusy} onClick={() => void previewSeriesCreate()}>
            {seriesPreviewBusy ? t('Seri kontrol ediliyor…') : t('Tüm tekrarları önizle')}
          </button>
        </div>}
        {seriesPreview && <div className="appointment-list" aria-label={t('Seri önizlemesi')}>
          {seriesPreview.occurrences.map((occurrence) => <div className="appointment-row" key={occurrence.ordinal}>
            <div className="appointment-time">
              <strong>{t('{ordinal}. tekrar', { ordinal: occurrence.ordinal })}</strong>
              <span>{occurrence.localDate} · {occurrence.localTime.slice(0,5)}</span>
            </div>
            <span className="status-pill">{occurrence.available ? t('Uygun') : t('Dolu')}</span>
          </div>)}
        </div>}
        {selectedCreateSlot && <div className="booking-confirm"><div><strong>{formatDateTime(selectedCreateSlot.starts_at, selectedCreateSlot.timezone)}</strong><span>{recurrenceFrequency === 'none' ? t('{count} hizmet tek rezervasyon olarak oluşturulacak.', { count: createLines.length }) : recurrenceFrequency === 'daily' ? t('{count} randevu, günlük seri olarak atomik oluşturulacak.', { count: recurrenceCount }) : t('{count} randevu, haftalık seri olarak atomik oluşturulacak.', { count: recurrenceCount })}</span></div><button className="primary-button" type="button" disabled={busy || createSlotsBusy || seriesPreviewBusy || customerName.trim().length < 2 || (recurrenceFrequency !== 'none' && !seriesPreview?.allAvailable)} onClick={() => void createBooking()}>{busy ? t('Oluşturuluyor…') : recurrenceFrequency === 'none' ? t('Randevuyu oluştur') : t('Seriyi oluştur')}</button></div>}
      </section>

      <section className="booking-card booking-list-card">
        <div className="section-head"><h2>{t('Rezervasyonlar')}</h2><span>{bookings.length}{bookingsNextCursor ? '+' : ''}</span></div>
        <div className="appointment-list">
          {bookings.map((booking) => <article className={`appointment-row status-${booking.status}`} key={booking.groupId}>
            <div className="appointment-time"><strong>{formatDateTime(booking.startsAt, booking.timezone)}</strong><span>{t('{lineCount} hizmet · {endsAt} bitiş', { lineCount: booking.lineCount, endsAt: formatTime(booking.endsAt, booking.timezone) })}</span></div>
            <div className="appointment-main">
              <div><strong>{booking.customerName}</strong><span>{t('{line} · tahmini {booking}', { line: booking.lines.map((line) => line.serviceName).join(' + '), booking: estimateText(booking) })}</span></div>
              <span className="status-pill">{t(statusText[booking.status])}</span>
            </div>
            <div className="appointment-list">
              {booking.lines.map((line) => <div className={`appointment-row status-${line.status}`} key={line.appointmentId}>
                <div className="appointment-time"><strong>{line.lineOrdinal}. {formatTime(line.startsAt, booking.timezone)} · {line.staffName}</strong><span>{t('{endsAt} bitiş', { endsAt: formatTime(line.endsAt, booking.timezone) })}</span></div>
                <div className="appointment-main"><div><strong>{line.serviceName}</strong><span>{priceText(line)}</span></div><span className="status-pill">{t(statusText[line.status])}</span></div>
                {booking.managementMode === 'group' && (line.status === 'scheduled' || line.status === 'confirmed') && <div className="appointment-actions">
                  <button disabled={busy} onClick={() => openServiceChange(booking, line)}>{t('Hizmeti değiştir')}</button>
                  <button disabled={busy} onClick={() => openLineSchedule(booking, line)}>{t('Satırı taşı')}</button>
                  <button disabled={busy} onClick={() => void cancelLine(booking, line)}>{t('Satırı iptal et')}</button>
                </div>}
              </div>)}
            </div>
            <div className="appointment-actions">
              <button disabled={busy} onClick={() => { setDetailFor(booking); setNotice(''); }}>{t('Detay')}</button>
              {booking.seriesId && booking.seriesOrdinal && <button disabled={busy} onClick={() => void openSeriesScope(booking)}>{t('Seri')}</button>}
              {booking.managementMode === 'legacy_single' ? <>
                {booking.status === 'scheduled' && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'confirmed')}>{t('Onayla')}</button>}
                {(booking.status === 'scheduled' || booking.status === 'confirmed') && <button disabled={busy} onClick={() => openReschedule(booking)}>{t('Taşı')}</button>}
                {(booking.status === 'scheduled' || booking.status === 'confirmed') && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'cancelled')}>{t('İptal')}</button>}
                {booking.status === 'confirmed' && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'completed')}>{t('Tamamlandı')}</button>}
                {booking.status === 'confirmed' && <button disabled={busy} onClick={() => void changeLegacyStatus(booking, 'no_show')}>{t('Gelmedi')}</button>}
                <button disabled={busy} onClick={() => void showHistory(booking)}>{t('Geçmiş')}</button>
              </> : <>
                {booking.canRescheduleGroup && <button disabled={busy} onClick={() => openReschedule(booking)}>{t('Tümünü taşı')}</button>}
                {booking.canCancelGroup && <button disabled={busy} onClick={() => void cancelGroup(booking)}>{t('Tümünü iptal et')}</button>}
              </>}
            </div>
          </article>)}
          {!bookings.length && <p className="empty">{t('Henüz randevu yok. İlk slotu soldan kilitle.')}</p>}
        </div>
        {bookingsNextCursor && <div className="booking-actions"><button className="secondary-button" disabled={busy} onClick={() => void loadMoreBookings()}>{t('Daha fazla randevu yükle')}</button></div>}
      </section>
    </div>

    {detailFor && <section className="booking-card booking-modal-card booking-detail-card">
      <div className="section-head"><div><p className="eyebrow">{t('RANDEVU DETAYI')}</p><h2>{detailFor.customerName}</h2></div><button type="button" onClick={() => setDetailFor(null)}>{t('Kapat')}</button></div>
      <div className="booking-detail-tabs" aria-label={t('Randevu bölümleri')}>
        <span className="is-active">{t('Detay')}</span>
        <span aria-disabled="true">{t('Fotoğraf')}</span>
        <button type="button" disabled={busy} onClick={() => void openTicketForBooking(detailFor)}>{t('Adisyon')}</button>
      </div>
      <dl className="booking-detail-grid">
        <div><dt>{t('Zaman')}</dt><dd>{formatDateTime(detailFor.startsAt, detailFor.timezone)} – {formatTime(detailFor.endsAt, detailFor.timezone)}</dd></div>
        <div><dt>{t('Durum')}</dt><dd><span className="status-pill">{t(statusText[detailFor.status])}</span></dd></div>
        <div><dt>{t('İletişim')}</dt><dd>{detailFor.customerPhone || t('Telefon yok')}{detailFor.customerEmail ? ` · ${detailFor.customerEmail}` : ''}</dd></div>
        <div><dt>{t('Not')}</dt><dd>{detailFor.notes || t('Not yok')}</dd></div>
        <div className="wide-field"><dt>{t('Hizmetler')}</dt><dd>{detailFor.lines.map((line) => <div key={line.appointmentId}>{line.lineOrdinal}. {line.serviceName} · {line.staffName} · {formatTime(line.startsAt, detailFor.timezone)} · {t(statusText[line.status])}</div>)}</dd></div>
      </dl>
      <div className="appointment-actions booking-detail-actions">
        {detailFor.seriesId && detailFor.seriesOrdinal && <button disabled={busy} onClick={() => void openSeriesScope(detailFor)}>{t('Seriyi yönet')}</button>}
        {detailFor.managementMode === 'legacy_single' ? <>
          {detailFor.status === 'scheduled' && <button disabled={busy} onClick={() => void changeLegacyStatus(detailFor, 'confirmed')}>{t('Onayla')}</button>}
          {(detailFor.status === 'scheduled' || detailFor.status === 'confirmed') && <button disabled={busy} onClick={() => openReschedule(detailFor)}>{t('Taşı')}</button>}
          {detailFor.status === 'confirmed' && <button disabled={busy} onClick={() => void changeLegacyStatus(detailFor, 'completed')}>{t('Tamamlandı')}</button>}
          {detailFor.status === 'confirmed' && <button disabled={busy} onClick={() => void changeLegacyStatus(detailFor, 'no_show')}>{t('Gelmedi')}</button>}
          {(detailFor.status === 'scheduled' || detailFor.status === 'confirmed') && <button disabled={busy} onClick={() => void changeLegacyStatus(detailFor, 'cancelled')}>{t('İptal')}</button>}
        </> : <>
          {detailFor.status === 'scheduled' && <button disabled={busy} onClick={() => void changeGroupStatus(detailFor, 'confirmed')}>{t('Onayla')}</button>}
          {detailFor.status === 'confirmed' && <button disabled={busy} onClick={() => void changeGroupStatus(detailFor, 'completed')}>{t('Tamamlandı')}</button>}
          {detailFor.status === 'confirmed' && <button disabled={busy} onClick={() => void changeGroupStatus(detailFor, 'no_show')}>{t('Gelmedi')}</button>}
          {detailFor.canRescheduleGroup && <button disabled={busy} onClick={() => openReschedule(detailFor)}>{t('Tümünü taşı')}</button>}
          {detailFor.canCancelGroup && <button disabled={busy} onClick={() => void cancelGroup(detailFor)}>{t('Tümünü iptal et')}</button>}
        </>}
      </div>
      <p className="muted booking-detail-future">{t('Fotoğraf bölümü henüz kullanıma açık değil. Adisyon aynı randevu kaynağından güvenli biçimde açılır veya yeniden kullanılır.')}</p>
    </section>}

    {seriesFor && <section className="booking-card booking-modal-card booking-detail-card">
      <div className="section-head">
        <div><p className="eyebrow">{t('TEKRARLAYAN SERİ')}</p><h2>{seriesFor.customerName}</h2></div>
        <button type="button" onClick={() => { setSeriesFor(null); setSeriesDetail(null); setSeriesFuturePreview(null); }}>{t('Kapat')}</button>
      </div>
      {!seriesDetail ? <p className="muted">{t('Seri hazırlanıyor…')}</p> : <>
        <dl className="booking-detail-grid">
          <div><dt>{t('Sıklık')}</dt><dd>{seriesDetail.frequency === 'daily' ? t('Her gün') : t('Her hafta')}</dd></div>
          <div><dt>{t('Toplam tekrar')}</dt><dd>{seriesDetail.occurrenceCount}</dd></div>
          <div><dt>{t('Seri sürümü')}</dt><dd>{seriesDetail.version}</dd></div>
          <div><dt>{t('Saat dilimi')}</dt><dd>{seriesDetail.timezone}</dd></div>
        </dl>
        <div className="booking-fields">
          <label>
            İşlem
            <select value={seriesAction} onChange={(event) => {
              setSeriesAction(event.target.value as 'reschedule' | 'cancel');
              setSeriesFuturePreview(null);
            }}>
              <option value="reschedule">{t('Bu ve sonrakileri taşı')}</option>
              <option value="cancel">{t('Bu ve sonrakileri iptal et')}</option>
            </select>
          </label>
          <label>
            Başlangıç tekrarı
            <select value={seriesFromOrdinal} onChange={(event) => {
              const ordinal = Number(event.target.value);
              setSeriesFromOrdinal(ordinal);
              const occurrence = seriesDetail.occurrences.find((item) => item.seriesOrdinal === ordinal);
              if (occurrence) {
                setSeriesDate(dateInZone(occurrence.startsAt, seriesDetail.timezone));
                setSeriesTime(timeInZone(occurrence.startsAt, seriesDetail.timezone));
              }
              setSeriesFuturePreview(null);
            }}>
              {Array.from({ length: seriesDetail.occurrenceCount }, (_, index) => index + 1).map((ordinal) =>
                <option value={ordinal} key={ordinal}>{t('{ordinal}. tekrar', { ordinal: ordinal })}</option>)}
            </select>
          </label>
          {seriesAction === 'reschedule' ? <>
            <label>{t('Yeni tarih')}<input type="date" value={seriesDate} onChange={(event) => { setSeriesDate(event.target.value); setSeriesFuturePreview(null); }} /></label>
            <label>{t('Yeni saat')}<input type="time" value={seriesTime} onChange={(event) => { setSeriesTime(event.target.value); setSeriesFuturePreview(null); }} /></label>
          </> : <label className="wide-field">{t('İptal nedeni')}<textarea rows={2} maxLength={500} value={seriesReason} onChange={(event) => { setSeriesReason(event.target.value); setSeriesFuturePreview(null); }} /></label>}
        </div>
        <div className="booking-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void previewSeriesFutureScope()}>
            {busy ? t('Kapsam hesaplanıyor…') : t('Kapsamı önizle')}
          </button>
        </div>
        {seriesFuturePreview && <div className="appointment-list" aria-label={t('Seri değişiklik kapsamı')}>
          {seriesFuturePreview.targets.map((target) => <div className="appointment-row" key={target.groupId}>
            <div className="appointment-time">
              <strong>{t('{ordinal}. tekrar', { ordinal: target.ordinal })}</strong>
              <span>{target.localDate}{target.targetStartsAt ? ` · ${formatTime(target.targetStartsAt, seriesDetail.timezone)}` : ''}</span>
            </div>
            <div className="appointment-main"><small>{target.groupId}</small><span className="status-pill">{target.available ? t('Kapsamda') : t('Çakışıyor')}</span></div>
          </div>)}
          {seriesFuturePreview.skipped.map((target) => <div className="appointment-row" key={`skip-${target.groupId}`}>
            <div className="appointment-time"><strong>{t('{ordinal}. tekrar', { ordinal: target.ordinal })}</strong><span>{formatDateTime(target.startsAt, seriesDetail.timezone)}</span></div>
            <div className="appointment-main"><small>{target.groupId}</small><span className="status-pill">{t('Korunacak')}</span></div>
          </div>)}
          {seriesFuturePreview.conflicts.map((target) => <div className="appointment-row" key={`conflict-${target.groupId}`}>
            <div className="appointment-time"><strong>{t('{ordinal}. tekrar', { ordinal: target.ordinal })}</strong><span>{target.localDate}</span></div>
            <div className="appointment-main"><small>{target.groupId}</small><span className="status-pill">{t('Çakışma')}</span></div>
          </div>)}
          <div className="booking-actions">
            <button className="primary-button" disabled={busy || !seriesFuturePreview.allAvailable || !seriesFuturePreview.targets.length} onClick={() => void commitSeriesFutureScope()}>
              {seriesAction === 'reschedule' ? t('Kapsamdaki randevuları taşı') : t('Kapsamdaki randevuları iptal et')}
            </button>
          </div>
        </div>}
      </>}
    </section>}

    {rescheduleTarget && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">{t('TAŞI')}</p><h2>{t('{customerName} · {lineCount} hizmet', { customerName: rescheduleTarget.booking.customerName, lineCount: rescheduleTarget.booking.lineCount })}</h2></div><button onClick={() => setRescheduleTarget(null)}>{t('Kapat')}</button></div>
      <div className="reschedule-controls">
        <input type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} />
        {rescheduleTarget.booking.managementMode === 'legacy_single' && <select value={rescheduleStaff} onChange={(event) => setRescheduleStaff(event.target.value)}><option value="any">{t('Fark etmez')}</option>{legacyRescheduleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
        <button className="secondary-button" disabled={busy} onClick={() => void previewReschedule()}>{t('Saatleri getir')}</button>
      </div>
      <div className="slot-cloud">{rescheduleSlots.map((slot) => {
        const staff = 'staff_name' in slot ? slot.staff_name : t('{count} hizmet birlikte', { count: rescheduleTarget.booking.lineCount });
        const selected = selectedRescheduleSlot?.starts_at === slot.starts_at && (!('staff_id' in slot) || !selectedRescheduleSlot || !('staff_id' in selectedRescheduleSlot) || selectedRescheduleSlot.staff_id === slot.staff_id);
        return <button type="button" className={selected ? 'slot-button selected' : 'slot-button'} key={`${'staff_id' in slot ? slot.staff_id : 'group'}-${slot.starts_at}`} onClick={() => setSelectedRescheduleSlot(slot)}><strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{staff}</span></button>;
      })}</div>
      {selectedRescheduleSlot && <div className="booking-confirm"><div><strong>{formatDateTime(selectedRescheduleSlot.starts_at, selectedRescheduleSlot.timezone)}</strong><span>{rescheduleTarget.booking.managementMode === 'group' ? t('Tüm hizmetler birlikte taşınır') : t('Tek hizmetli randevu')}</span></div><button className="primary-button" disabled={busy} onClick={() => void commitReschedule()}>{t('Yeni saate taşı')}</button></div>}
    </section>}

    {serviceTarget && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">{t('HİZMETİ DEĞİŞTİR')}</p><h2>{serviceTarget.line.serviceName}</h2></div><button onClick={() => setServiceTarget(null)}>{t('Kapat')}</button></div>
      <p className="muted">{t('Satırın personel ve saati korunur. Süre/buffer/processing footprint\'i farklı bir hizmet seçilirse sunucu grup replani ister.')}</p>
      <div className="reschedule-controls">
        <select value={replacementServiceId} onChange={(event) => setReplacementServiceId(event.target.value)}>{editableServices.map((service) => <option key={service.id} value={service.id}>{t('{name} · {duration_minutes} dk', { name: service.name, duration_minutes: service.duration_minutes })}</option>)}</select>
        <button className="primary-button" disabled={busy || !replacementServiceId || replacementServiceId === serviceTarget.line.serviceId} onClick={() => void commitServiceChange()}>{t('Hizmeti değiştir')}</button>
      </div>
    </section>}

    {lineScheduleTarget && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">{t('SATIRI TAŞI')}</p><h2>{lineScheduleTarget.line.serviceName}</h2></div><button onClick={() => setLineScheduleTarget(null)}>{t('Kapat')}</button></div>
      <p className="muted">{t('Yalnız bu hizmet satırı taşınır. Sunucu personel yetkisini, çalışma saatini, blokları, sibling çakışmasını ve group version\'ı doğrular.')}</p>
      <div className="reschedule-controls">
        <input type="date" value={lineDate} onChange={(event) => setLineDate(event.target.value)} />
        <input type="time" value={lineTime} onChange={(event) => setLineTime(event.target.value)} />
        <select value={lineStaff} onChange={(event) => setLineStaff(event.target.value)}>{lineEligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        <button className="primary-button" disabled={busy || !lineStaff} onClick={() => void commitLineSchedule()}>{t('Satırı taşı')}</button>
      </div>
    </section>}

    {eventsFor && <section className="booking-card booking-modal-card">
      <div className="section-head"><div><p className="eyebrow">{t('AUDIT')}</p><h2>{t('{customerName} · geçmiş', { customerName: eventsFor.customerName })}</h2></div><button onClick={() => { setEventsFor(null); setEvents([]); setEventsNextCursor(null); }}>{t('Kapat')}</button></div>
      <div className="event-list">{events.map((event) => <div className="event-row" key={event.id}><strong>{event.event_type}</strong><span>{formatDateTime(event.created_at, timezone)}</span><small>{event.from_status ?? '∅'} → {event.to_status ?? '∅'}</small></div>)}</div>
      {eventsNextCursor && <div className="booking-actions"><button className="secondary-button" disabled={busy} onClick={() => void loadMoreEvents()}>{t('Daha fazla geçmiş yükle')}</button></div>}
    </section>}
  </div>;
}
