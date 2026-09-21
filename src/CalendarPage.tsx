import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiRequestError } from './api';
import { navigateApp } from './workspace-route';
import {
  CALENDAR_HTTP_TIMEOUT_MS,
  CalendarRefreshScheduler,
  LatestCalendarRequest,
} from './calendar-refresh';

type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
type GroupStatus = AppointmentStatus | 'partial';
type CalendarAppointment = {
  appointment_id: string;
  group_id: string;
  line_ordinal: number;
  group_status: GroupStatus;
  group_version: number;
  group_legacy_appointment_id: string | null;
  group_line_count: number;
  group_starts_at: string;
  group_ends_at: string;
  staff_id: string;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  service_name: string;
  staff_name: string;
  price_minor: number | null;
  currency: string;
  notes: string | null;
  cancellation_reason: string | null;
  source: 'operator' | 'public';
};
type CalendarGroupLine = {
  appointmentId: string;
  lineOrdinal: number;
  serviceName: string;
  staffName: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
};
type CalendarGroupDetail = {
  groupId: string;
  status: GroupStatus;
  version: number;
  startsAt: string;
  endsAt: string;
  lineCount: number;
  canCancelGroup: boolean;
  lines: CalendarGroupLine[];
};
type Staff = { id: string; name: string; active: boolean };
type CalendarPayload = {
  membership: { id: string; business_id: string; role: 'owner' | 'manager' | 'staff' };
  business: { id: string; name: string; timezone: string };
  localDate: string;
  date: string;
  days: 1 | 7;
  staff: Staff[];
  appointments: CalendarAppointment[];
};
type ViewMode = 'day' | 'week' | 'list';
type CalendarQuery = { date: string; view: ViewMode; days: 1 | 7; staffId: string };

function abortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function authorityError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (
    error.status === 401
    || error.status === 403
    || (error.status === 409 && error.code === 'WORKSPACE_CONTEXT_CHANGED')
  );
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
}

function instantParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: Number(map.hour) * 60 + Number(map.minute),
    time: `${map.hour}:${map.minute}`,
  };
}

const STAFF_ACCENTS = ['#8b5e4f', '#4f6f8b', '#557a61', '#7b5f92', '#9a733d', '#4e7d7a'];

function staffAccent(staffId: string) {
  let hash = 0;
  for (const char of staffId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STAFF_ACCENTS[hash % STAFF_ACCENTS.length];
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function statusLabel(status: GroupStatus) {
  return {
    scheduled: 'Planlandı',
    confirmed: 'Onaylandı',
    completed: 'Tamamlandı',
    no_show: 'Gelmedi',
    cancelled: 'İptal',
    partial: 'Kısmi',
  }[status];
}

function nextStatuses(status: AppointmentStatus) {
  if (status === 'scheduled') return ['confirmed', 'cancelled'] as const;
  if (status === 'confirmed') return ['completed', 'no_show', 'cancelled'] as const;
  return [] as const;
}

function initialCalendarView(): ViewMode {
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches ? 'list' : 'day';
}

export default function CalendarPage() {
  const initialView = initialCalendarView();
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [view, setView] = useState<ViewMode>(initialView);
  const [days, setDays] = useState<1 | 7>(1);
  const [date, setDate] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const [staffId, setStaffId] = useState('all');
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<CalendarGroupDetail | null>(null);
  const [selectedGroupLoading, setSelectedGroupLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const mutationKeys = useRef(new Map<string, string>());
  const selectionGeneration = useRef(0);
  const selectionController = useRef<AbortController | null>(null);
  const requestGate = useRef(new LatestCalendarRequest());
  const query = useRef<CalendarQuery>({ date: '', view: initialView, days: 1, staffId: 'all' });
  const payloadRef = useRef<CalendarPayload | null>(null);
  const authorityContextRef = useRef<string | null>(null);

  const invalidateCalendarContext = useCallback((message: string) => {
    payloadRef.current = null;
    authorityContextRef.current = null;
    selectionController.current?.abort();
    selectionController.current = null;
    ++selectionGeneration.current;
    setPayload(null);
    setSelectedGroupId(null);
    setSelectedGroup(null);
    setSelectedGroupLoading(false);
    setCancelReason('');
    setLoadError(message);
  }, []);

  const load = useCallback(async (requested: Partial<CalendarQuery> = {}) => {
    const nextQuery = { ...query.current, ...requested };
    const nextStaff = nextQuery.staffId;
    const nextDate = nextQuery.date;
    const nextDays = nextQuery.days;
    const params = new URLSearchParams({ days: String(nextDays) });
    if (nextDate) params.set('date', nextDays === 7 ? mondayOf(nextDate) : nextDate);
    if (nextStaff !== 'all') params.set('staffId', nextStaff);

    const ticket = requestGate.current.begin();
    const hasVerifiedPayload = payloadRef.current !== null;
    if (hasVerifiedPayload) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await api<CalendarPayload>(`/api/calendar?${params}`, {
        signal: ticket.controller.signal,
        timeoutMs: CALENDAR_HTTP_TIMEOUT_MS,
      });
      if (!requestGate.current.isCurrent(ticket)) return false;

      const authorityContext = `${result.membership.id}:${result.business.id}:${result.membership.role}`;
      if (authorityContextRef.current && authorityContextRef.current !== authorityContext) {
        invalidateCalendarContext('İşletme veya oturum bağlamı değişti. Takvim güncel bağlamla yeniden açılıyor.');
        window.location.reload();
        return false;
      }

      authorityContextRef.current = authorityContext;
      payloadRef.current = result;
      setPayload(result);
      if (!nextQuery.date) {
        query.current = { ...nextQuery, date: result.date, days: result.days };
        setDate(result.date);
        setDays(result.days);
      }
      setLoadError('');
      return true;
    } catch (error) {
      if (!requestGate.current.isCurrent(ticket) || abortError(error)) return false;
      const message = error instanceof Error ? error.message : 'Takvim yüklenemedi.';
      if (authorityError(error)) {
        invalidateCalendarContext(message);
      } else {
        setLoadError(hasVerifiedPayload
          ? `${message} Son doğrulanmış takvim gösteriliyor.`
          : message);
      }
      return false;
    } finally {
      if (requestGate.current.isCurrent(ticket)) {
        requestGate.current.complete(ticket);
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [invalidateCalendarContext]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const scheduler = new CalendarRefreshScheduler({
      isVisible: () => document.visibilityState !== 'hidden',
      onRefresh: () => { void load(); },
    });
    scheduler.start();
    void load();

    const onFocus = () => scheduler.focused();
    const onVisibilityChange = () => scheduler.visibilityChanged();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      scheduler.dispose();
      requestGate.current.cancel();
      selectionController.current?.abort();
    };
  }, [load]);

  const timezone = payload?.business.timezone ?? 'Europe/Istanbul';
  const visibleAppointments = useMemo(
    () => (payload?.appointments ?? []).filter((appointment) => showCancelled || appointment.group_status !== 'cancelled'),
    [payload, showCancelled],
  );
  const logicalGroups = useMemo(() => {
    const groups = new Map<string, CalendarAppointment>();
    for (const appointment of visibleAppointments) {
      if (!groups.has(appointment.group_id) || appointment.line_ordinal === 1) groups.set(appointment.group_id, appointment);
    }
    return [...groups.values()];
  }, [visibleAppointments]);
  const listGroups = useMemo(() => {
    const groups = new Map<string, CalendarAppointment[]>();
    for (const appointment of visibleAppointments) {
      const lines = groups.get(appointment.group_id) ?? [];
      lines.push(appointment);
      groups.set(appointment.group_id, lines);
    }
    return [...groups.entries()]
      .map(([groupId, lines]) => {
        const ordered = [...lines].sort((left, right) => left.line_ordinal - right.line_ordinal);
        const root = ordered.find((line) => line.line_ordinal === 1) ?? ordered[0];
        return { groupId, root, lines: ordered };
      })
      .filter((group): group is { groupId: string; root: CalendarAppointment; lines: CalendarAppointment[] } => Boolean(group.root))
      .sort((left, right) => (
        left.root.group_starts_at.localeCompare(right.root.group_starts_at)
        || left.groupId.localeCompare(right.groupId)
      ));
  }, [visibleAppointments]);
  const selectedLines = useMemo(
    () => visibleAppointments
      .filter((appointment) => appointment.group_id === selectedGroupId)
      .sort((a, b) => a.line_ordinal - b.line_ordinal),
    [selectedGroupId, visibleAppointments],
  );
  const selected = selectedLines[0] ?? null;

  const calendarStaff = useMemo(() => {
    const map = new Map<string, Staff>();
    for (const person of payload?.staff ?? []) {
      if (person.active || visibleAppointments.some((appointment) => appointment.staff_id === person.id)) map.set(person.id, person);
    }
    for (const appointment of visibleAppointments) {
      if (!map.has(appointment.staff_id)) map.set(appointment.staff_id, { id: appointment.staff_id, name: appointment.staff_name, active: false });
    }
    return [...map.values()];
  }, [payload, visibleAppointments]);

  const dayStaff = staffId === 'all' ? calendarStaff : calendarStaff.filter((person) => person.id === staffId);
  const dayAppointments = visibleAppointments.filter((appointment) => instantParts(appointment.starts_at, timezone).date === (payload?.date ?? date));
  const appointmentMinutes = dayAppointments.flatMap((appointment) => {
    const start = instantParts(appointment.starts_at, timezone).minutes;
    const end = instantParts(appointment.ends_at, timezone).minutes;
    return [start, end];
  });
  const startHour = appointmentMinutes.length ? Math.max(0, Math.min(8, Math.floor(Math.min(...appointmentMinutes) / 60))) : 8;
  const endHour = appointmentMinutes.length ? Math.min(24, Math.max(20, Math.ceil(Math.max(...appointmentMinutes) / 60))) : 20;
  const hourHeight = 72;
  const gridHeight = (endHour - startHour) * hourHeight;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const nowParts = instantParts(clock.toISOString(), timezone);
  const nowOffset = ((nowParts.minutes - startHour * 60) / 60) * hourHeight;
  const showNowLine = view === 'day'
    && nowParts.date === (payload?.date ?? date)
    && nowParts.minutes >= startHour * 60
    && nowParts.minutes <= endHour * 60;

  const stats = useMemo(() => ({
    total: logicalGroups.length,
    pending: logicalGroups.filter((item) => item.group_status === 'scheduled').length,
    confirmed: logicalGroups.filter((item) => item.group_status === 'confirmed').length,
    done: logicalGroups.filter((item) => item.group_status === 'completed').length,
  }), [logicalGroups]);

  function clearSelection() {
    selectionController.current?.abort();
    selectionController.current = null;
    selectionGeneration.current += 1;
    setSelectedGroupId(null);
    setSelectedGroup(null);
    setSelectedGroupLoading(false);
    setCancelReason('');
  }

  function selectAppointment(appointment: CalendarAppointment) {
    selectionController.current?.abort();
    const generation = ++selectionGeneration.current;
    setSelectedGroupId(appointment.group_id);
    setSelectedGroup(null);
    setCancelReason('');
    if (appointment.group_legacy_appointment_id) {
      setSelectedGroupLoading(false);
      return;
    }

    const controller = new AbortController();
    selectionController.current = controller;
    setSelectedGroupLoading(true);
    void api<{ group: CalendarGroupDetail }>(`/api/bookings/groups/${appointment.group_id}`, {
      signal: controller.signal,
      timeoutMs: CALENDAR_HTTP_TIMEOUT_MS,
    })
      .then((result) => {
        if (controller.signal.aborted || generation !== selectionGeneration.current) return;
        setSelectedGroup(result.group);
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== selectionGeneration.current || abortError(error)) return;
        if (authorityError(error)) {
          invalidateCalendarContext(error.message);
          return;
        }
        setNotice(error instanceof Error ? error.message : 'Rezervasyon grubunun tam detayı yüklenemedi.');
      })
      .finally(() => {
        if (!controller.signal.aborted && generation === selectionGeneration.current) {
          selectionController.current = null;
          setSelectedGroupLoading(false);
        }
      });
  }

  function navigate(amount: number) {
    const base = date || payload?.date || payload?.localDate;
    if (!base) return;
    const next = addDays(base, days * amount);
    query.current = { date: next, view, days, staffId };
    setDate(next);
    clearSelection();
    void load(query.current);
  }

  function changeView(next: ViewMode) {
    const base = date || payload?.date || payload?.localDate || '';
    const nextDays: 1 | 7 = next === 'day' ? 1 : next === 'week' ? 7 : days;
    const nextDate = nextDays === 7 && base ? mondayOf(base) : base;
    query.current = { date: nextDate, view: next, days: nextDays, staffId };
    setView(next);
    setDays(nextDays);
    if (nextDate) setDate(nextDate);
    clearSelection();
    void load(query.current);
  }

  function changeStaff(next: string) {
    query.current = { date, view, days, staffId: next };
    setStaffId(next);
    clearSelection();
    void load(query.current);
  }

  function today() {
    if (!payload?.localDate) return;
    const next = days === 7 ? mondayOf(payload.localDate) : payload.localDate;
    query.current = { date: next, view, days, staffId };
    setDate(next);
    clearSelection();
    void load(query.current);
  }

  function changeDate(next: string) {
    if (!next) return;
    const normalized = days === 7 ? mondayOf(next) : next;
    query.current = { date: normalized, view, days, staffId };
    setDate(normalized);
    clearSelection();
    void load(query.current);
  }

  function changeListRange(nextDays: 1 | 7) {
    const base = date || payload?.date || payload?.localDate;
    if (!base) return;
    const nextDate = nextDays === 7 ? mondayOf(base) : base;
    query.current = { date: nextDate, view: 'list', days: nextDays, staffId };
    setDays(nextDays);
    setDate(nextDate);
    clearSelection();
    void load(query.current);
  }

  function mutationKey(fingerprint: string) {
    let key = mutationKeys.current.get(fingerprint);
    if (!key) {
      key = `cal-${crypto.randomUUID()}`;
      mutationKeys.current.set(fingerprint, key);
    }
    return key;
  }

  async function changeLegacyStatus(appointment: CalendarAppointment, status: 'confirmed' | 'completed' | 'no_show' | 'cancelled') {
    const reason = status === 'cancelled' ? cancelReason.trim() : '';
    const fingerprint = `legacy:${appointment.appointment_id}:${status}:${reason}`;
    const key = mutationKey(fingerprint);

    setBusy(true);
    setNotice('');
    try {
      await api(`/api/bookings/${appointment.appointment_id}/status`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ status, reason: reason || null }),
      });
      mutationKeys.current.delete(fingerprint);
      clearSelection();
      await load();
      setNotice(`Randevu durumu “${statusLabel(status)}” olarak güncellendi.`);
    } catch (error) {
      if (authorityError(error)) invalidateCalendarContext(error.message);
      else setNotice(error instanceof Error ? error.message : 'Randevu güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelNativeGroup(group: CalendarGroupDetail) {
    const reason = cancelReason.trim();
    const fingerprint = `group:${group.groupId}:cancel:${group.version}:${reason}`;
    const key = mutationKey(fingerprint);
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/bookings/groups/${group.groupId}/cancel`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ expectedVersion: group.version, reason: reason || null }),
      });
      mutationKeys.current.delete(fingerprint);
      clearSelection();
      await load();
      setNotice('Rezervasyon grubu iptal edildi.');
    } catch (error) {
      if (authorityError(error)) invalidateCalendarContext(error.message);
      else setNotice(error instanceof Error ? error.message : 'Rezervasyon grubu iptal edilemedi.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !payload) {
    return <main className="calendar-shell"><section className="calendar-empty">Takvim hazırlanıyor…</section></main>;
  }

  if (!payload) {
    return <main className="calendar-shell"><section className="calendar-empty"><h1>Takvim açılamadı</h1><p>{loadError || notice}</p><button className="calendar-retry" type="button" onClick={() => void load()}>Tekrar dene</button><a href="/app">İşletmeye dön</a></section></main>;
  }

  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(payload.date, index));
  const title = days === 1
    ? formatDate(payload.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${formatDate(payload.date, { day: 'numeric', month: 'short' })} – ${formatDate(addDays(payload.date, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const drawerStatus = selectedGroup?.status ?? selected?.group_status ?? 'scheduled';
  const drawerStartsAt = selectedGroup?.startsAt ?? selected?.group_starts_at ?? '';
  const drawerEndsAt = selectedGroup?.endsAt ?? selected?.group_ends_at ?? '';

  return (
    <main className="calendar-shell" aria-busy={refreshing}>
      <header className="calendar-header">
        <div>
          <p className="calendar-kicker">OPERASYON TAKVİMİ</p>
          <h1>{payload.business.name}</h1>
          <p>{title} · {payload.business.timezone}</p>
        </div>
        <button className="calendar-new" type="button" onClick={() => navigateApp("/app/bookings")}>+ Yeni randevu</button>
      </header>

      <section className="calendar-toolbar" aria-label="Takvim kontrolleri">
        <div className="calendar-nav-buttons">
          <button type="button" onClick={() => navigate(-1)} aria-label="Önceki dönem">‹</button>
          <button type="button" onClick={today}>Bugün</button>
          <button type="button" onClick={() => navigate(1)} aria-label="Sonraki dönem">›</button>
        </div>
        <label className="calendar-date-filter">
          <span>Tarih</span>
          <input type="date" value={date} onChange={(event) => changeDate(event.target.value)} />
        </label>
        <div className="calendar-view-toggle" role="group" aria-label="Takvim görünümü">
          <button className={view === 'day' ? 'is-active' : ''} type="button" onClick={() => changeView('day')}>Gün</button>
          <button className={view === 'week' ? 'is-active' : ''} type="button" onClick={() => changeView('week')}>Hafta</button>
          <button className={view === 'list' ? 'is-active' : ''} type="button" onClick={() => changeView('list')}>Liste</button>
        </div>
        {view === 'list' && (
          <div className="calendar-range-toggle" role="group" aria-label="Liste tarih aralığı">
            <button className={days === 1 ? 'is-active' : ''} type="button" onClick={() => changeListRange(1)}>1 gün</button>
            <button className={days === 7 ? 'is-active' : ''} type="button" onClick={() => changeListRange(7)}>7 gün</button>
          </div>
        )}
        <label className="calendar-filter">
          <span>Personel</span>
          <select value={staffId} onChange={(event) => changeStaff(event.target.value)}>
            <option value="all">Tüm ekip</option>
            {payload.staff.filter((person) => person.active).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
          </select>
        </label>
        <label className="calendar-check"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} /> İptalleri göster</label>
      </section>

      <section className="calendar-stats" aria-label="Takvim özeti">
        <div><strong>{stats.total}</strong><span>Rezervasyon</span></div>
        <div><strong>{stats.pending}</strong><span>Planlanan</span></div>
        <div><strong>{stats.confirmed}</strong><span>Onaylı</span></div>
        <div><strong>{stats.done}</strong><span>Tamamlanan</span></div>
      </section>

      {loadError && (
        <div className="calendar-notice calendar-stale" role="alert">
          <span>{loadError}</span>
          <button type="button" disabled={refreshing} onClick={() => void load()}>{refreshing ? 'Yenileniyor…' : 'Yeniden dene'}</button>
        </div>
      )}
      {notice && <div className="calendar-notice" role="status">{notice}</div>}

      {view === 'day' ? (
        <section className="calendar-day-wrap">
          {dayStaff.length ? (
            <div className="calendar-day-grid" style={{ gridTemplateColumns: `72px repeat(${dayStaff.length}, minmax(190px, 1fr))` }}>
              <div className="calendar-corner" />
              {dayStaff.map((person) => <div className="calendar-staff-head" style={{ borderTopColor: staffAccent(person.id) }} key={person.id}><strong>{person.name}</strong>{!person.active && <small>Pasif</small>}</div>)}
              <div className="calendar-time-axis" style={{ height: gridHeight }}>
                {hours.map((hour) => <span key={hour} style={{ top: (hour - startHour) * hourHeight }}>{String(hour).padStart(2, '0')}:00</span>)}
              </div>
              {dayStaff.map((person) => (
                <div className="calendar-staff-column" key={person.id} style={{ height: gridHeight }}>
                  {hours.map((hour) => <i className="calendar-hour-line" key={hour} style={{ top: (hour - startHour) * hourHeight }} />)}
                  {showNowLine && <i className="calendar-now-line" aria-label={`Şimdi ${nowParts.time}`} style={{ top: nowOffset }} />}
                  {dayAppointments.filter((appointment) => appointment.staff_id === person.id).map((appointment) => {
                    const start = instantParts(appointment.starts_at, timezone).minutes;
                    const end = instantParts(appointment.ends_at, timezone).minutes;
                    const top = ((start - startHour * 60) / 60) * hourHeight;
                    const height = Math.max(42, ((end - start) / 60) * hourHeight);
                    return (
                      <button
                        key={appointment.appointment_id}
                        className={`calendar-event status-${appointment.status}`}
                        style={{ top, height, borderLeftColor: staffAccent(appointment.staff_id) }}
                        type="button"
                        onClick={() => selectAppointment(appointment)}
                      >
                        <strong>{instantParts(appointment.starts_at, timezone).time} · {appointment.customer_name}</strong>
                        <span>{appointment.service_name}{appointment.group_line_count > 1 ? ` · ${appointment.line_ordinal}/${appointment.group_line_count}` : ''}</span>
                        <small>{statusLabel(appointment.group_status)}</small>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : <div className="calendar-empty">Takvimde gösterecek personel bulunmuyor.</div>}
        </section>
      ) : view === 'week' ? (
        <section className="calendar-week-grid">
          {weekDates.map((day) => {
            const items = visibleAppointments.filter((appointment) => instantParts(appointment.starts_at, timezone).date === day);
            const isToday = day === payload.localDate;
            return (
              <div className={`calendar-week-day ${isToday ? 'is-today' : ''}`} key={day}>
                <header><span>{formatDate(day, { weekday: 'short' })}</span><strong>{formatDate(day, { day: 'numeric', month: 'short' })}</strong></header>
                <div className="calendar-week-list">
                  {items.length ? items.map((appointment) => (
                    <button type="button" style={{ borderLeftColor: staffAccent(appointment.staff_id) }} className={`calendar-week-event status-${appointment.status}`} key={appointment.appointment_id} onClick={() => selectAppointment(appointment)}>
                      <strong>{instantParts(appointment.starts_at, timezone).time}</strong>
                      <span>{appointment.customer_name}</span>
                      <small>{appointment.staff_name} · {appointment.service_name}{appointment.group_line_count > 1 ? ` · ${appointment.line_ordinal}/${appointment.group_line_count}` : ''} · {statusLabel(appointment.group_status)}</small>
                    </button>
                  )) : <p>Boş</p>}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="calendar-list-view" aria-label="Randevu listesi">
          <header className="calendar-list-head">
            <span>Saat</span><span>Müşteri</span><span>Hizmetler</span><span>Personel</span><span>Durum</span>
          </header>
          {listGroups.length ? listGroups.map(({ groupId, root, lines }) => {
            const services = [...new Set(lines.map((line) => line.service_name))];
            const staff = [...new Map(lines.map((line) => [line.staff_id, line])).values()];
            const dateParts = instantParts(root.group_starts_at, timezone);
            return (
              <button className="calendar-list-event" type="button" key={groupId} onClick={() => selectAppointment(root)}>
                <span className="calendar-list-time">
                  {days === 7 && <small>{formatDate(dateParts.date, { weekday: 'short', day: 'numeric', month: 'short' })}</small>}
                  <strong>{dateParts.time}</strong>
                </span>
                <span className="calendar-list-customer"><strong>{root.customer_name}</strong><small>{root.source === 'public' ? 'Online' : 'Operatör'}</small></span>
                <span className="calendar-list-services">{services.join(' + ')}{root.group_line_count > 1 && <small>{root.group_line_count} hizmet</small>}</span>
                <span className="calendar-list-staff">{staff.map((line) => <span key={line.staff_id}><i style={{ backgroundColor: staffAccent(line.staff_id) }} />{line.staff_name}</span>)}</span>
                <span><b className={`calendar-status status-${root.group_status}`}>{statusLabel(root.group_status)}</b></span>
              </button>
            );
          }) : <div className="calendar-list-empty">Bu aralıkta randevu yok.</div>}
        </section>
      )}

      {selected && (
        <div className="calendar-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) clearSelection(); }}>
          <aside className="calendar-drawer" aria-label="Rezervasyon detayı">
            <button className="calendar-drawer-close" type="button" onClick={clearSelection} aria-label="Kapat">×</button>
            <p className="calendar-kicker">REZERVASYON DETAYI</p>
            <h2>{selected.customer_name}</h2>
            <span className={`calendar-status status-${drawerStatus}`}>{statusLabel(drawerStatus)}</span>
            <dl>
              <div><dt>Tarih</dt><dd>{new Intl.DateTimeFormat('tr-TR', { timeZone: timezone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(drawerStartsAt))} – {new Intl.DateTimeFormat('tr-TR', { timeZone: timezone, timeStyle: 'short' }).format(new Date(drawerEndsAt))}</dd></div>
              <div><dt>Hizmetler</dt><dd>
                {selected.group_legacy_appointment_id
                  ? selectedLines.map((line) => <div key={line.appointment_id}>{line.line_ordinal}. {line.service_name} · {line.staff_name} · {statusLabel(line.status)}</div>)
                  : selectedGroupLoading
                    ? <span>Rezervasyonun tüm hizmetleri yükleniyor…</span>
                    : selectedGroup
                      ? selectedGroup.lines.map((line) => <div key={line.appointmentId}>{line.lineOrdinal}. {line.serviceName} · {line.staffName} · {statusLabel(line.status)}</div>)
                      : <span>Rezervasyonun tam hizmet listesi doğrulanamadı.</span>}
              </dd></div>
              {selected.group_legacy_appointment_id && selected.price_minor !== null && <div><dt>Ücret</dt><dd>{money(selected.price_minor, selected.currency)}</dd></div>}
              <div><dt>Kaynak</dt><dd>{selected.source === 'public' ? 'Online rezervasyon' : 'Operatör'}</dd></div>
              {selected.customer_phone && <div><dt>Telefon</dt><dd>{selected.customer_phone}</dd></div>}
              {selected.customer_email && <div><dt>E-posta</dt><dd>{selected.customer_email}</dd></div>}
              {selected.notes && <div><dt>Not</dt><dd>{selected.notes}</dd></div>}
            </dl>

            {selected.group_legacy_appointment_id ? (
              nextStatuses(selected.status).length > 0 && (
                <div className="calendar-actions">
                  {selected.status === 'confirmed' && (
                    <>
                      <button type="button" disabled={busy} onClick={() => void changeLegacyStatus(selected, 'completed')}>Tamamlandı</button>
                      <button type="button" disabled={busy} onClick={() => void changeLegacyStatus(selected, 'no_show')}>Gelmedi</button>
                    </>
                  )}
                  {selected.status === 'scheduled' && <button type="button" disabled={busy} onClick={() => void changeLegacyStatus(selected, 'confirmed')}>Onayla</button>}
                  {(selected.status === 'scheduled' || selected.status === 'confirmed') && (
                    <div className="calendar-cancel-box">
                      <textarea value={cancelReason} maxLength={240} rows={2} placeholder="İptal nedeni (isteğe bağlı)" onChange={(event) => setCancelReason(event.target.value)} />
                      <button className="is-danger" type="button" disabled={busy} onClick={() => void changeLegacyStatus(selected, 'cancelled')}>İptal et</button>
                    </div>
                  )}
                </div>
              )
            ) : selectedGroup && selectedGroup.canCancelGroup && selectedGroup.lines.some((line) => line.status === 'scheduled' || line.status === 'confirmed') ? (
              <div className="calendar-actions">
                <p>Çok hizmetli rezervasyon tek birim olarak yönetilir. Satır düzenleme ve taşıma Randevular ekranındadır.</p>
                <div className="calendar-cancel-box">
                  <textarea value={cancelReason} maxLength={500} rows={2} placeholder="Grup iptal nedeni (isteğe bağlı)" onChange={(event) => setCancelReason(event.target.value)} />
                  <button className="is-danger" type="button" disabled={busy || selectedGroupLoading} onClick={() => void cancelNativeGroup(selectedGroup)}>Tüm rezervasyonu iptal et</button>
                </div>
              </div>
            ) : null}

            <a className="calendar-secondary-link" href="/bookings">Gelişmiş randevu işlemlerine git</a>
          </aside>
        </div>
      )}
    </main>
  );
}
