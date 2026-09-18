import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

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
  membership: { role: 'owner' | 'manager' | 'staff' };
  business: { id: string; name: string; timezone: string };
  localDate: string;
  date: string;
  days: 1 | 7;
  staff: Staff[];
  appointments: CalendarAppointment[];
};
type CalendarViewAppointment = CalendarAppointment & {
  startParts: ReturnType<typeof instantParts>;
  endParts: ReturnType<typeof instantParts>;
};
type ViewMode = 'day' | 'week';

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

export default function CalendarPage() {
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [view, setView] = useState<ViewMode>('day');
  const [date, setDate] = useState('');
  const [staffId, setStaffId] = useState('all');
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<CalendarGroupDetail | null>(null);
  const [selectedGroupLoading, setSelectedGroupLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const mutationKeys = useRef(new Map<string, string>());
  const selectionGeneration = useRef(0);

  const load = useCallback(async (requestedDate?: string, requestedView?: ViewMode, requestedStaff?: string) => {
    const nextView = requestedView ?? view;
    const nextStaff = requestedStaff ?? staffId;
    const nextDate = requestedDate || date;
    const params = new URLSearchParams({ days: nextView === 'week' ? '7' : '1' });
    if (nextDate) params.set('date', nextView === 'week' ? mondayOf(nextDate) : nextDate);
    if (nextStaff !== 'all') params.set('staffId', nextStaff);

    setLoading(true);
    setNotice('');
    try {
      const result = await api<CalendarPayload>(`/api/calendar?${params}`);
      setPayload(result);
      setDate((current) => current || result.date);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Takvim yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [date, staffId, view]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const timezone = payload?.business.timezone ?? 'Europe/Istanbul';
  const visibleAppointments = useMemo(
    () => (payload?.appointments ?? []).filter((appointment) => showCancelled || appointment.group_status !== 'cancelled'),
    [payload, showCancelled],
  );
  const viewAppointments = useMemo<CalendarViewAppointment[]>(
    () => visibleAppointments.map((appointment) => ({
      ...appointment,
      startParts: instantParts(appointment.starts_at, timezone),
      endParts: instantParts(appointment.ends_at, timezone),
    })),
    [timezone, visibleAppointments],
  );
  const logicalGroups = useMemo(() => {
    const groups = new Map<string, CalendarViewAppointment>();
    for (const appointment of viewAppointments) {
      if (!groups.has(appointment.group_id) || appointment.line_ordinal === 1) groups.set(appointment.group_id, appointment);
    }
    return [...groups.values()];
  }, [viewAppointments]);
  const selectedLines = useMemo(
    () => viewAppointments
      .filter((appointment) => appointment.group_id === selectedGroupId)
      .sort((a, b) => a.line_ordinal - b.line_ordinal),
    [selectedGroupId, viewAppointments],
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
  const dayAppointments = viewAppointments.filter((appointment) => appointment.startParts.date === (payload?.date ?? date));
  const appointmentMinutes = dayAppointments.flatMap((appointment) => {
    const start = appointment.startParts.minutes;
    const end = appointment.endParts.minutes;
    return [start, end];
  });
  const startHour = appointmentMinutes.length ? Math.max(0, Math.min(8, Math.floor(Math.min(...appointmentMinutes) / 60))) : 8;
  const endHour = appointmentMinutes.length ? Math.min(24, Math.max(20, Math.ceil(Math.max(...appointmentMinutes) / 60))) : 20;
  const hourHeight = 72;
  const gridHeight = (endHour - startHour) * hourHeight;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);

  const stats = useMemo(() => ({
    total: logicalGroups.length,
    pending: logicalGroups.filter((item) => item.group_status === 'scheduled').length,
    confirmed: logicalGroups.filter((item) => item.group_status === 'confirmed').length,
    done: logicalGroups.filter((item) => item.group_status === 'completed').length,
  }), [logicalGroups]);

  function clearSelection() {
    selectionGeneration.current += 1;
    setSelectedGroupId(null);
    setSelectedGroup(null);
    setSelectedGroupLoading(false);
    setCancelReason('');
  }

  function selectAppointment(appointment: CalendarAppointment) {
    const generation = ++selectionGeneration.current;
    setSelectedGroupId(appointment.group_id);
    setSelectedGroup(null);
    setCancelReason('');
    if (appointment.group_legacy_appointment_id) {
      setSelectedGroupLoading(false);
      return;
    }

    setSelectedGroupLoading(true);
    void api<{ group: CalendarGroupDetail }>(`/api/bookings/groups/${appointment.group_id}`)
      .then((result) => {
        if (generation !== selectionGeneration.current) return;
        setSelectedGroup(result.group);
      })
      .catch((error) => {
        if (generation !== selectionGeneration.current) return;
        setNotice(error instanceof Error ? error.message : 'Rezervasyon grubunun tam detayı yüklenemedi.');
      })
      .finally(() => {
        if (generation === selectionGeneration.current) setSelectedGroupLoading(false);
      });
  }

  function navigate(amount: number) {
    const base = date || payload?.date || payload?.localDate;
    if (!base) return;
    const step = view === 'week' ? 7 * amount : amount;
    const next = addDays(base, step);
    setDate(next);
    clearSelection();
    void load(next, view, staffId);
  }

  function changeView(next: ViewMode) {
    const base = date || payload?.date || payload?.localDate || '';
    const nextDate = next === 'week' && base ? mondayOf(base) : base;
    setView(next);
    if (nextDate) setDate(nextDate);
    clearSelection();
    void load(nextDate, next, staffId);
  }

  function changeStaff(next: string) {
    setStaffId(next);
    clearSelection();
    void load(date, view, next);
  }

  function today() {
    if (!payload?.localDate) return;
    const next = view === 'week' ? mondayOf(payload.localDate) : payload.localDate;
    setDate(next);
    clearSelection();
    void load(next, view, staffId);
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
      await load(date, view, staffId);
      setNotice(`Randevu durumu “${statusLabel(status)}” olarak güncellendi.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Randevu güncellenemedi.');
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
      await load(date, view, staffId);
      setNotice('Rezervasyon grubu iptal edildi.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Rezervasyon grubu iptal edilemedi.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !payload) {
    return <main className="calendar-shell"><section className="calendar-empty">Takvim hazırlanıyor…</section></main>;
  }

  if (!payload) {
    return <main className="calendar-shell"><section className="calendar-empty"><h1>Takvim açılamadı</h1><p>{notice}</p><a href="/">İşletmeye dön</a></section></main>;
  }

  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(payload.date, index));
  const title = view === 'day'
    ? formatDate(payload.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${formatDate(payload.date, { day: 'numeric', month: 'short' })} – ${formatDate(addDays(payload.date, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const drawerStatus = selectedGroup?.status ?? selected?.group_status ?? 'scheduled';
  const drawerStartsAt = selectedGroup?.startsAt ?? selected?.group_starts_at ?? '';
  const drawerEndsAt = selectedGroup?.endsAt ?? selected?.group_ends_at ?? '';

  return (
    <main className="calendar-shell">
      <header className="calendar-header">
        <div>
          <p className="calendar-kicker">OPERASYON TAKVİMİ</p>
          <h1>{payload.business.name}</h1>
          <p>{title} · {payload.business.timezone}</p>
        </div>
        <a className="calendar-new" href="/bookings">+ Yeni randevu</a>
      </header>

      <section className="calendar-toolbar" aria-label="Takvim kontrolleri">
        <div className="calendar-nav-buttons">
          <button type="button" onClick={() => navigate(-1)} aria-label="Önceki dönem">‹</button>
          <button type="button" onClick={today}>Bugün</button>
          <button type="button" onClick={() => navigate(1)} aria-label="Sonraki dönem">›</button>
        </div>
        <div className="calendar-view-toggle" role="group" aria-label="Takvim görünümü">
          <button className={view === 'day' ? 'is-active' : ''} type="button" onClick={() => changeView('day')}>Gün</button>
          <button className={view === 'week' ? 'is-active' : ''} type="button" onClick={() => changeView('week')}>Hafta</button>
        </div>
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

      {notice && <div className="calendar-notice" role="status">{notice}</div>}

      {view === 'day' ? (
        <section className="calendar-day-wrap">
          {dayStaff.length ? (
            <div className="calendar-day-grid" style={{ gridTemplateColumns: `72px repeat(${dayStaff.length}, minmax(190px, 1fr))` }}>
              <div className="calendar-corner" />
              {dayStaff.map((person) => <div className="calendar-staff-head" key={person.id}><strong>{person.name}</strong>{!person.active && <small>Pasif</small>}</div>)}
              <div className="calendar-time-axis" style={{ height: gridHeight }}>
                {hours.map((hour) => <span key={hour} style={{ top: (hour - startHour) * hourHeight }}>{String(hour).padStart(2, '0')}:00</span>)}
              </div>
              {dayStaff.map((person) => (
                <div className="calendar-staff-column" key={person.id} style={{ height: gridHeight }}>
                  {hours.map((hour) => <i className="calendar-hour-line" key={hour} style={{ top: (hour - startHour) * hourHeight }} />)}
                  {dayAppointments.filter((appointment) => appointment.staff_id === person.id).map((appointment) => {
                    const start = appointment.startParts.minutes;
                    const end = appointment.endParts.minutes;
                    const top = ((start - startHour * 60) / 60) * hourHeight;
                    const height = Math.max(42, ((end - start) / 60) * hourHeight);
                    return (
                      <button
                        key={appointment.appointment_id}
                        className={`calendar-event status-${appointment.status}`}
                        style={{ top, height }}
                        type="button"
                        onClick={() => selectAppointment(appointment)}
                      >
                        <strong>{appointment.startParts.time} · {appointment.customer_name}</strong>
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
      ) : (
        <section className="calendar-week-grid">
          {weekDates.map((day) => {
            const items = viewAppointments.filter((appointment) => appointment.startParts.date === day);
            const isToday = day === payload.localDate;
            return (
              <div className={`calendar-week-day ${isToday ? 'is-today' : ''}`} key={day}>
                <header><span>{formatDate(day, { weekday: 'short' })}</span><strong>{formatDate(day, { day: 'numeric', month: 'short' })}</strong></header>
                <div className="calendar-week-list">
                  {items.length ? items.map((appointment) => (
                    <button type="button" className={`calendar-week-event status-${appointment.status}`} key={appointment.appointment_id} onClick={() => selectAppointment(appointment)}>
                      <strong>{appointment.startParts.time}</strong>
                      <span>{appointment.customer_name}</span>
                      <small>{appointment.staff_name} · {appointment.service_name}{appointment.group_line_count > 1 ? ` · ${appointment.line_ordinal}/${appointment.group_line_count}` : ''}</small>
                    </button>
                  )) : <p>Boş</p>}
                </div>
              </div>
            );
          })}
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
