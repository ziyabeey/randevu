import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import PublicBookingInformation from './PublicBookingInformation';

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
  support_slug: string;
  support_phone?: string | null;
  support_email?: string | null;
  support_website?: string | null;
  support_whatsapp?: string | null;
  support_address?: string | null;
  kvkk_notice_text?: string | null;
  kvkk_notice_url?: string | null;
  privacy_policy_url?: string | null;
  booking_terms_text?: string | null;
  booking_terms_url?: string | null;
};
type ManagedSlot = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
};
type GroupLine = {
  appointmentId: string;
  lineOrdinal: number;
  serviceName: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  priceType: 'fixed' | 'range';
  priceMinMinor: number;
  priceMaxMinor: number;
  priceMinor: number | null;
  currency: string;
};
type ManagedGroup = {
  groupId: string;
  status: string;
  version: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  currency: string;
  estimateMinMinor: number;
  estimateMaxMinor: number;
  lineCount: number;
  canRescheduleGroup: boolean;
  canCancelGroup: boolean;
  lines: GroupLine[];
};
type GroupManagedSlot = {
  starts_at: string;
  ends_at: string;
  timezone: string;
  total_duration_minutes: number;
  lines: Array<Record<string, unknown>>;
};
type SlotChoice =
  | { mode: 'legacy'; slot: ManagedSlot }
  | { mode: 'group'; slot: GroupManagedSlot };

type ViewResponse = { appointment: ManagedAppointment; group?: ManagedGroup };

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

function moneyRange(min: number, max: number, currency: string) {
  return min === max ? money(min, currency) : `${money(min, currency)} – ${money(max, currency)}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    scheduled: 'Planlandı',
    confirmed: 'Onaylandı',
    completed: 'Tamamlandı',
    no_show: 'Gelmedi',
    cancelled: 'İptal edildi',
    partial: 'Kısmen değişti',
  };
  return labels[status] ?? status;
}

export default function ManageAppointmentPage({ token }: { token: string }) {
  const [appointment, setAppointment] = useState<ManagedAppointment | null>(null);
  const [group, setGroup] = useState<ManagedGroup | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<ManagedSlot[]>([]);
  const [groupSlots, setGroupSlots] = useState<GroupManagedSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotChoice | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const rescheduleCommand = useRef<{ fingerprint: string; key: string } | null>(null);
  const cancelCommand = useRef<{ fingerprint: string; key: string } | null>(null);

  async function loadAppointment() {
    const result = await api<ViewResponse>('/api/manage/view', {
      method: 'POST',
      csrf: 'skip',
      body: JSON.stringify({ token }),
    });
    setAppointment(result.appointment);
    setGroup(result.group ?? null);
    setDate((current) => current || result.appointment.local_date);
    return result;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotice('');
      if (!token) {
        setNotice('Bu randevu yönetim bağlantısı geçerli değil.');
        setLoading(false);
        return;
      }
      try {
        const result = await api<ViewResponse>('/api/manage/view', {
          method: 'POST',
          csrf: 'skip',
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        setAppointment(result.appointment);
        setGroup(result.group ?? null);
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

  const canReschedule = group ? group.canRescheduleGroup : Boolean(appointment?.can_reschedule);
  const canCancel = group ? group.canCancelGroup : Boolean(appointment?.can_cancel);

  // A refresh that follows a failed mutation must not talk over the reason it
  // failed: the conflict notice is what tells the customer to look at the new
  // times before choosing again.
  async function loadSlots({ preserveNotice = false }: { preserveNotice?: boolean } = {}) {
    if (!date || !canReschedule) return;
    setBusy(true);
    if (!preserveNotice) setNotice('');
    setSelectedSlot(null);
    try {
      if (group) {
        const result = await api<{ slots: GroupManagedSlot[] }>('/api/manage/slots', {
          method: 'POST',
          csrf: 'skip',
          body: JSON.stringify({ token, date, group: true }),
        });
        setGroupSlots(result.slots);
        setSlots([]);
        if (!preserveNotice) {
          setNotice(result.slots.length ? `${result.slots.length} uygun grup saati bulundu.` : 'Bu gün için grubun tamamına uygun saat bulunamadı.');
        }
      } else {
        const result = await api<{ slots: ManagedSlot[] }>('/api/manage/slots', {
          method: 'POST',
          csrf: 'skip',
          body: JSON.stringify({ token, date, staffId: 'any' }),
        });
        setSlots(result.slots);
        setGroupSlots([]);
        if (!preserveNotice) {
          setNotice(result.slots.length ? `${result.slots.length} uygun saat bulundu.` : 'Bu gün için uygun saat bulunamadı.');
        }
      }
    } catch (error) {
      setSlots([]);
      setGroupSlots([]);
      setNotice(error instanceof Error ? error.message : 'Uygun saatler yüklenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!selectedSlot) return;
    const startsAt = selectedSlot.slot.starts_at;
    const legacyStaffId = selectedSlot.mode === 'legacy' ? selectedSlot.slot.staff_id : null;
    const fingerprint = group
      ? `${group.version}:${startsAt}`
      : `${legacyStaffId}:${startsAt}`;
    if (!rescheduleCommand.current || rescheduleCommand.current.fingerprint !== fingerprint) {
      rescheduleCommand.current = { fingerprint, key: `manage-res-${crypto.randomUUID()}` };
    }

    setBusy(true);
    setNotice('');
    try {
      await api('/api/manage/reschedule', {
        method: 'POST',
        csrf: 'skip',
        headers: { 'Idempotency-Key': rescheduleCommand.current.key },
        body: JSON.stringify(group
          ? { token, expectedVersion: group.version, startsAt }
          : { token, staffId: legacyStaffId, startsAt }),
      });
      rescheduleCommand.current = null;
      setSlots([]);
      setGroupSlots([]);
      setSelectedSlot(null);
      const next = await loadAppointment();
      const nextStart = next.group?.startsAt ?? next.appointment.starts_at;
      const nextTimezone = next.group?.timezone ?? next.appointment.timezone;
      setNotice(`Randevu ${formatDateTime(nextStart, nextTimezone)} tarihine taşındı.`);
    } catch (error) {
      const coded = error as Error & { code?: string };
      setNotice(coded.message);
      if (coded.code === 'SLOT_UNAVAILABLE' || coded.code === 'BOOKING_GROUP_VERSION_CONFLICT') {
        setSelectedSlot(null);
        if (coded.code === 'BOOKING_GROUP_VERSION_CONFLICT') {
          try { await loadAppointment(); } catch { /* retain the conflict notice */ }
        }
        void loadSlots({ preserveNotice: true });
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelAppointment() {
    if (!canCancel || !appointment) return;
    const cleanReason = reason.trim();
    const fingerprint = group ? `${group.version}:${cleanReason || 'no-reason'}` : (cleanReason || 'no-reason');
    if (!cancelCommand.current || cancelCommand.current.fingerprint !== fingerprint) {
      cancelCommand.current = { fingerprint, key: `manage-cancel-${crypto.randomUUID()}` };
    }
    const prompt = group
      ? 'Bu rezervasyondaki aktif hizmetlerin tamamını iptal etmek istediğinize emin misiniz?'
      : 'Bu randevuyu iptal etmek istediğinize emin misiniz?';
    if (!window.confirm(prompt)) return;

    setBusy(true);
    setNotice('');
    try {
      await api('/api/manage/cancel', {
        method: 'POST',
        csrf: 'skip',
        headers: { 'Idempotency-Key': cancelCommand.current.key },
        body: JSON.stringify(group
          ? { token, expectedVersion: group.version, reason: cleanReason || null }
          : { token, reason: cleanReason || null }),
      });
      cancelCommand.current = null;
      setSlots([]);
      setGroupSlots([]);
      setSelectedSlot(null);
      await loadAppointment();
      setNotice(group ? 'Rezervasyondaki aktif hizmetler iptal edildi.' : 'Randevu iptal edildi. Ayrılan saat yeniden müsait hale geldi.');
    } catch (error) {
      const coded = error as Error & { code?: string };
      setNotice(coded.message || 'Randevu iptal edilemedi.');
      if (coded.code === 'BOOKING_GROUP_VERSION_CONFLICT') {
        try { await loadAppointment(); } catch { /* retain the conflict notice */ }
      }
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

  const displayStatus = group?.status ?? appointment.status;
  const displayTimezone = group?.timezone ?? appointment.timezone;
  const slotCount = group ? groupSlots.length : slots.length;

  return (
    <main className="manage-shell">
      <header className="manage-header">
        <p className="public-kicker">RANDEVUMU YÖNET</p>
        <h1>{appointment.business_name}</h1>
        <span className={`manage-status status-${displayStatus}`}>{statusLabel(displayStatus)}</span>
      </header>

      {notice && <div className="public-booking-notice" role="status">{notice}</div>}

      <div className="manage-grid">
        <section className="manage-card manage-summary">
          <h2>{group ? 'Rezervasyon bilgileri' : 'Randevu bilgileri'}</h2>
          {group ? (
            <>
              <dl className="public-confirmation-list">
                <div><dt>Başlangıç</dt><dd>{formatDateTime(group.startsAt, group.timezone)}</dd></div>
                <div><dt>Hizmet sayısı</dt><dd>{group.lineCount}</dd></div>
                <div><dt>Tahmini toplam</dt><dd>{moneyRange(group.estimateMinMinor, group.estimateMaxMinor, group.currency)}</dd></div>
              </dl>
              <div className="manage-group-lines" aria-label="Rezervasyon hizmetleri">
                {group.lines.map((line) => (
                  <article className="manage-group-line" key={line.appointmentId}>
                    <div>
                      <strong>{line.lineOrdinal}. {line.serviceName}</strong>
                      <span>{line.staffName} · {formatTime(line.startsAt, group.timezone)}–{formatTime(line.endsAt, group.timezone)}</span>
                    </div>
                    <div>
                      <span>{moneyRange(line.priceMinMinor, line.priceMaxMinor, line.currency)}</span>
                      <small>{statusLabel(line.status)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <dl className="public-confirmation-list">
              <div><dt>Hizmet</dt><dd>{appointment.service_name}</dd></div>
              <div><dt>Personel</dt><dd>{appointment.staff_name}</dd></div>
              <div><dt>Tarih</dt><dd>{formatDateTime(appointment.starts_at, appointment.timezone)}</dd></div>
              <div><dt>Ücret</dt><dd>{money(appointment.price_minor, appointment.currency)}</dd></div>
            </dl>
          )}
          <p className="manage-security-note">Bu sayfanın bağlantısı randevunuzu değiştirme yetkisi verir. Bağlantıyı yalnız güvendiğiniz kişilerle paylaşın.</p>
        </section>

        <section className="manage-card">
          <h2>{group ? 'Rezervasyonu başka saate taşı' : 'Başka saate taşı'}</h2>
          {canReschedule ? (
            <>
              <div className="manage-date-row">
                <input type="date" value={date} min={appointment.local_date} max={appointment.max_date} onChange={(event) => { setDate(event.target.value); setSlots([]); setGroupSlots([]); setSelectedSlot(null); }} />
                <button className="public-primary" type="button" disabled={busy} onClick={() => void loadSlots()}>{busy ? 'Bakılıyor…' : 'Saatleri göster'}</button>
              </div>
              {slotCount > 0 && (
                <div className="public-slot-grid manage-slots">
                  {group ? groupSlots.map((slot) => {
                    const selected = selectedSlot?.mode === 'group' && selectedSlot.slot.starts_at === slot.starts_at;
                    return (
                      <button className={`public-slot ${selected ? 'is-selected' : ''}`} type="button" key={slot.starts_at} onClick={() => setSelectedSlot({ mode: 'group', slot })}>
                        <strong>{formatTime(slot.starts_at, slot.timezone)}</strong>
                        <span>{slot.total_duration_minutes} dk · {slot.lines.length} hizmet</span>
                      </button>
                    );
                  }) : slots.map((slot) => {
                    const selected = selectedSlot?.mode === 'legacy'
                      && selectedSlot.slot.staff_id === slot.staff_id
                      && selectedSlot.slot.starts_at === slot.starts_at;
                    return (
                      <button className={`public-slot ${selected ? 'is-selected' : ''}`} type="button" key={`${slot.staff_id}-${slot.starts_at}`} onClick={() => setSelectedSlot({ mode: 'legacy', slot })}>
                        <strong>{formatTime(slot.starts_at, slot.timezone)}</strong>
                        <span>{slot.staff_name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedSlot && <button className="public-primary manage-confirm" type="button" disabled={busy} onClick={() => void reschedule()}>Seçilen saate taşı</button>}
            </>
          ) : <p className="public-muted">Bu {group ? 'rezervasyon' : 'randevu'} artık taşınamaz.</p>}
        </section>

        <section className="manage-card manage-danger">
          <h2>{group ? 'Rezervasyonu iptal et' : 'Randevuyu iptal et'}</h2>
          {canCancel ? (
            <>
              <label>
                <span>İptal nedeni <small>(isteğe bağlı)</small></span>
                <textarea value={reason} maxLength={240} rows={3} onChange={(event) => setReason(event.target.value)} />
              </label>
              <button className="manage-cancel-button" type="button" disabled={busy} onClick={() => void cancelAppointment()}>{group ? 'Aktif hizmetlerin tamamını iptal et' : 'Randevuyu iptal et'}</button>
            </>
          ) : <p className="public-muted">Bu {group ? 'rezervasyon' : 'randevu'} artık iptal edilemez.</p>}
        </section>
      </div>

      <PublicBookingInformation
        slug={appointment.support_slug}
        contact={{
          businessName: appointment.business_name,
          phone: appointment.support_phone,
          email: appointment.support_email,
          website: appointment.support_website,
          whatsapp: appointment.support_whatsapp,
          address: appointment.support_address,
          kvkkNoticeText: appointment.kvkk_notice_text,
          kvkkNoticeUrl: appointment.kvkk_notice_url,
          privacyPolicyUrl: appointment.privacy_policy_url,
          bookingTermsText: appointment.booking_terms_text,
          bookingTermsUrl: appointment.booking_terms_url,
        }}
        prefix="manage"
        className="manage-information"
      />
      <footer className="public-booking-footer">Saatler {displayTimezone} saat dilimine göre gösterilir.</footer>
    </main>
  );
}
