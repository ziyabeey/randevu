import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiRequestError, api } from './api';
import {
  PUBLIC_BOOKING_RECOVERY_TTL_MS,
  PUBLIC_BOOKING_SETTLE_MS,
  acquirePublicBookingIntent,
  blockingPublicBookingRecord,
  completePublicBookingIntent,
  dismissPublicBookingRecord,
  forgetLegacyBookingRecord,
  loadPublicBookingRecords,
  markPublicBookingUnresolved,
  watchPublicBookingRecords,
} from './public-booking-pending';
import type { LegacyPendingRecord, PublicBookingGroupPlan, PublicBookingRecord, V2PendingRecord } from './public-booking-pending';
import { randomBase64Url } from '../shared/base64.ts';
import { derivePublicBookingIntentV2, sha256Hex } from '../shared/public-booking-intent';
import type { PublicMultiServiceSelectionState } from './PublicMultiServiceSelection';

type PublicBusiness = { name: string; slug: string; timezone: string; local_date: string; max_date: string; step_minutes: number; min_notice_minutes: number; horizon_days: number };
type PublicService = { service_id: string; name: string; duration_minutes: number; price_minor: number; currency: string };
type PublicStaff = { staff_id: string; staff_name: string };
type PublicSlot = { staff_id: string; staff_name: string; starts_at: string; ends_at: string; timezone: string };
type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
type GroupStatus = AppointmentStatus | 'partial';
type Confirmation = { appointment_id: string; business_name?: string; status: AppointmentStatus; starts_at: string; ends_at: string; timezone: string; service_name: string; staff_name: string; price_minor: number | null; currency: string };
type GroupLine = {
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
type GroupConfirmation = {
  groupId: string;
  status: GroupStatus;
  source: 'public';
  version: number;
  customerId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  currency: string;
  estimateMinMinor: number;
  estimateMaxMinor: number;
  lines: GroupLine[];
};
type ConfirmedResult = { appointment: Confirmation; group?: GroupConfirmation; manageUrl: string };
type BookingClock = { serverNowEpochSeconds: number; submitWindowSeconds: number };
type PagePayload = { business: PublicBusiness; services: PublicService[]; bookingClock: BookingClock };
type ClockSample = BookingClock & { sampledAtMonotonicMs: number };
type ResolveResponse = { resolution: 'committed' | 'exists_nolink' | 'closed_absent'; recoveryId: string; appointment?: Confirmation; group?: GroupConfirmation; management?: { url: string }; recovery?: { expiresAt: string } };
type UnpersistedConfirmation = { id: string; expectedStatuses: readonly ('submitting' | 'unresolved' | 'legacy_pending')[] };
type Props = {
  slug: string;
  groupMode?: boolean;
  multiServiceSelection?: PublicMultiServiceSelectionState | null;
  onPlanNeedsRefresh?: () => void;
  onResultVisibilityChange?: (visible: boolean) => void;
};

const HTTP_TIMEOUT_MS = 10_000;
const CLOCK_MAX_AGE_MS = 30_000;

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: timezone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(value));
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function estimateMoney(minorMin: number, minorMax: number, currency: string) {
  return minorMin === minorMax
    ? `Tahmini ${money(minorMin, currency)}`
    : `Tahmini ${money(minorMin, currency)} – ${money(minorMax, currency)}`;
}

function createSecret() {
  return randomBase64Url(32);
}

function validClock(value: unknown): value is BookingClock {
  if (!value || typeof value !== 'object') return false;
  const clock = value as Partial<BookingClock>;
  return Number.isInteger(clock.serverNowEpochSeconds)
    && Number.isInteger(clock.submitWindowSeconds)
    && clock.submitWindowSeconds === 300;
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('tr-TR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validAppointmentStatus(value: unknown): value is AppointmentStatus {
  return value === 'scheduled' || value === 'confirmed' || value === 'completed'
    || value === 'no_show' || value === 'cancelled';
}

function validGroupStatus(value: unknown): value is GroupStatus {
  return validAppointmentStatus(value) || value === 'partial';
}

function validConfirmation(value: unknown, allowNullPrice = false): value is Confirmation {
  if (!value || typeof value !== 'object') return false;
  const appointment = value as Partial<Confirmation>;
  if (typeof appointment.appointment_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(appointment.appointment_id)
      || !validAppointmentStatus(appointment.status)
      || typeof appointment.starts_at !== 'string'
      || typeof appointment.ends_at !== 'string'
      || !validTimeZone(appointment.timezone)
      || typeof appointment.service_name !== 'string' || !appointment.service_name
      || typeof appointment.staff_name !== 'string' || !appointment.staff_name
      || (appointment.price_minor === null ? !allowNullPrice
        : typeof appointment.price_minor !== 'number'
          || !Number.isInteger(appointment.price_minor) || appointment.price_minor < 0)
      || typeof appointment.currency !== 'string' || !/^[A-Z]{3}$/.test(appointment.currency)
      || (appointment.business_name !== undefined && typeof appointment.business_name !== 'string')) return false;
  const startsAt = Date.parse(appointment.starts_at);
  const endsAt = Date.parse(appointment.ends_at);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return false;
  try {
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: appointment.currency }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validAmount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000;
}

function validGroupConfirmation(value: unknown, appointment?: Confirmation): value is GroupConfirmation {
  if (!isRecord(value)
      || !validUuid(value.groupId)
      || !validGroupStatus(value.status)
      || value.source !== 'public'
      || !Number.isInteger(value.version)
      || !validUuid(value.customerId)
      || !validTimestamp(value.startsAt)
      || !validTimestamp(value.endsAt)
      || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
      || !validTimeZone(value.timezone)
      || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)
      || !validAmount(value.estimateMinMinor)
      || !validAmount(value.estimateMaxMinor)
      || (value.estimateMaxMinor as number) < (value.estimateMinMinor as number)
      || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 10) return false;
  let estimateMin = 0;
  let estimateMax = 0;
  for (let index = 0; index < value.lines.length; index += 1) {
    const line = value.lines[index];
    if (!isRecord(line)
        || !validUuid(line.appointmentId)
        || line.lineOrdinal !== index + 1
        || !validUuid(line.serviceId)
        || typeof line.serviceName !== 'string' || !line.serviceName
        || !validUuid(line.staffId)
        || typeof line.staffName !== 'string' || !line.staffName
        || !validAppointmentStatus(line.status)
        || !validTimestamp(line.startsAt) || !validTimestamp(line.endsAt)
        || Date.parse(line.endsAt) <= Date.parse(line.startsAt)
        || !validTimestamp(line.occupiedStartsAt) || !validTimestamp(line.occupiedEndsAt)
        || (line.processingCapacityPolicy !== 'HOLD' && line.processingCapacityPolicy !== 'RELEASE')
        || !Number.isInteger(line.passiveWaitMinutes)
        || !Number.isInteger(line.processingPolicyVersion)
        || (line.priceType !== 'fixed' && line.priceType !== 'range')
        || !validAmount(line.priceMinMinor) || !validAmount(line.priceMaxMinor)
        || (line.priceMaxMinor as number) < (line.priceMinMinor as number)
        || typeof line.currency !== 'string' || line.currency !== value.currency
        || !Number.isInteger(line.pricePolicyVersion)) return false;
    if (line.priceType === 'fixed') {
      if (line.priceMinMinor !== line.priceMaxMinor || line.priceMinor !== line.priceMinMinor) return false;
    } else if (line.priceMinor !== null) return false;
    estimateMin += line.priceMinMinor as number;
    estimateMax += line.priceMaxMinor as number;
  }
  const statuses = new Set(value.lines.map((line) => line.status));
  const aggregateStatus = statuses.size === 1 ? value.lines[0]!.status : 'partial';
  if (value.status !== aggregateStatus) return false;
  if (estimateMin !== value.estimateMinMinor || estimateMax !== value.estimateMaxMinor) return false;
  if (appointment) {
    const anchor = value.lines[0] as Record<string, unknown>;
    if (anchor.appointmentId !== appointment.appointment_id
        || anchor.status !== appointment.status
        || anchor.startsAt !== appointment.starts_at
        || anchor.endsAt !== appointment.ends_at
        || anchor.serviceName !== appointment.service_name
        || anchor.staffName !== appointment.staff_name
        || anchor.priceMinor !== appointment.price_minor
        || value.timezone !== appointment.timezone
        || value.currency !== appointment.currency) return false;
  }
  return true;
}

function groupMatchesSelection(group: GroupConfirmation, selection: PublicBookingGroupPlan) {
  if (group.lines.length !== selection.lines.length
      || group.startsAt !== selection.slot.startsAt
      || group.endsAt !== selection.slot.endsAt
      || group.timezone !== selection.slot.timezone
      || group.currency !== selection.slot.currency
      || group.estimateMinMinor !== selection.slot.estimateMinMinor
      || group.estimateMaxMinor !== selection.slot.estimateMaxMinor) return false;
  return selection.lines.every((line, index) => {
    const created = group.lines[index];
    const planned = selection.slot.lines[index];
    if (!created || !planned
        || created.serviceId !== line.serviceId
        || created.serviceId !== planned.serviceId
        || created.startsAt !== planned.startsAt
        || created.endsAt !== planned.endsAt
        || created.priceType !== planned.priceType
        || created.priceMinMinor !== planned.priceMinMinor
        || created.priceMaxMinor !== planned.priceMaxMinor) return false;
    return line.staffId === null
      || (planned.staffId === line.staffId && created.staffId === line.staffId);
  });
}

function confirmationOutcome(appointment: Confirmation, group?: GroupConfirmation) {
  const status = group?.status ?? appointment.status;
  switch (status) {
    case 'scheduled': return { active: true, tone: 'active', symbol: '✓', kicker: 'RANDEVU OLUŞTURULDU', state: 'Randevunuz işletmenin paneline kaydedildi.', groupTail: 'kaydedildi.' };
    case 'confirmed': return { active: true, tone: 'active', symbol: '✓', kicker: 'RANDEVU ONAYLANDI', state: 'Randevunuz işletme tarafından onaylandı.', groupTail: 'işletme tarafından onaylandı.' };
    case 'completed': return { active: false, tone: 'neutral', symbol: '✓', kicker: 'RANDEVU TAMAMLANDI', state: 'Randevunuz tamamlandı.', groupTail: 'tamamlandı.' };
    case 'no_show': return { active: false, tone: 'attention', symbol: '!', kicker: 'RANDEVUYA GELİNMEDİ', state: 'Randevu gelinmedi olarak işaretlendi.', groupTail: 'gelinmedi olarak işaretlendi.' };
    case 'cancelled': return { active: false, tone: 'attention', symbol: '×', kicker: 'RANDEVU İPTAL EDİLDİ', state: 'Randevunuz iptal edilmiş.', groupTail: 'iptal edilmiş.' };
    case 'partial': return { active: false, tone: 'attention', symbol: '!', kicker: 'RANDEVU PLANI KISMEN DEĞİŞTİ', state: 'Grup randevunuzun hizmet durumları birbirinden farklı.', groupTail: 'kısmen değişmiş.' };
  }
}

function appointmentStatusLabel(status: AppointmentStatus) {
  const labels: Record<AppointmentStatus, string> = {
    scheduled: 'Planlandı', confirmed: 'Onaylandı', completed: 'Tamamlandı',
    no_show: 'Gelinmedi', cancelled: 'İptal edildi',
  };
  return labels[status];
}

function validManagementUrl(value: unknown, legacy = false) {
  return typeof value === 'string'
    && (legacy ? /^\/m#[A-Za-z0-9_-]{43,128}$/ : /^\/m#[A-Za-z0-9_-]{43}$/).test(value);
}

function messageFor(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error instanceof ApiRequestError && error.retryAfter !== undefined) {
    return error.message.includes(String(error.retryAfter))
      ? error.message
      : `${error.message} Lütfen ${error.retryAfter} saniye sonra tekrar deneyin.`;
  }
  return error.message || fallback;
}

function isRecoverableRecord(record: PublicBookingRecord): record is V2PendingRecord | LegacyPendingRecord {
  return record.status === 'submitting' || record.status === 'unresolved' || record.status === 'legacy_pending';
}

export default function PublicBookingPage({ slug, groupMode = false, multiServiceSelection, onPlanNeedsRefresh, onResultVisibilityChange }: Props) {
  const isGroupMode = groupMode;
  const [page, setPage] = useState<PagePayload | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState('');
  const [staff, setStaff] = useState<PublicStaff[]>([]);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmedResult | null>(null);
  const [confirmationRecordId, setConfirmationRecordId] = useState<string | null>(null);
  const [unpersistedConfirmation, setUnpersistedConfirmation] = useState<UnpersistedConfirmation | null>(null);
  const [confirmationStorageError, setConfirmationStorageError] = useState('');
  const [bookingRecords, setBookingRecords] = useState<PublicBookingRecord[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [settleTick, setSettleTick] = useState(0);
  const [notice, setNotice] = useState('');
  const [contactError, setContactError] = useState('');
  const clockSample = useRef<ClockSample | null>(null);
  const storageRequest = useRef(0);
  const resolvingIds = useRef(new Set<string>());
  const automaticResolveIds = useRef(new Set<string>());
  const recoveryCooldowns = useRef(new Map<string, number>());

  const blockingRecord = useMemo(() => blockingPublicBookingRecord(bookingRecords), [bookingRecords]);
  const closedReceipt = useMemo(() => bookingRecords.find((record) => record.status === 'closed_absent') ?? null, [bookingRecords]);

  async function refreshBookingRecords() {
    const request = ++storageRequest.current;
    try {
      const records = await loadPublicBookingRecords(slug);
      if (request !== storageRequest.current) return records;
      setBookingRecords(records);
      setStorageReady(true);
      setStorageError('');
      return records;
    } catch (error) {
      if (request === storageRequest.current) {
        setStorageReady(false);
        setStorageError(messageFor(error, 'Randevu işlemi bu tarayıcıda güvenli olarak saklanamadı.'));
      }
      return null;
    }
  }

  function rememberClock(payload: PagePayload) {
    if (!validClock(payload.bookingClock)) {
      clockSample.current = null;
      return false;
    }
    clockSample.current = { ...payload.bookingClock, sampledAtMonotonicMs: performance.now() };
    return true;
  }

  async function refreshPageForClock() {
    const next = await api<PagePayload>(`/api/public/business/${encodeURIComponent(slug)}`, { timeoutMs: HTTP_TIMEOUT_MS });
    if (!validClock(next.bookingClock)) throw new Error('Rezervasyon saati doğrulanamadı. Lütfen tekrar deneyin.');
    rememberClock(next);
    setPage(next);
    if (!serviceId) setServiceId(next.services[0]?.service_id ?? '');
    if (!date) setDate(next.business.local_date);
    return clockSample.current!;
  }

  async function currentClock() {
    const sample = clockSample.current;
    const monotonicNow = performance.now();
    if (sample && monotonicNow >= sample.sampledAtMonotonicMs
        && monotonicNow - sample.sampledAtMonotonicMs <= CLOCK_MAX_AGE_MS) return sample;
    return refreshPageForClock();
  }

  useEffect(() => {
    storageRequest.current += 1;
    setBookingRecords([]);
    setStorageReady(false);
    setStorageError('');
    setConfirmation(null);
    setConfirmationRecordId(null);
    setUnpersistedConfirmation(null);
    setConfirmationStorageError('');
    automaticResolveIds.current.clear();
    resolvingIds.current.clear();
    recoveryCooldowns.current.clear();
    void refreshBookingRecords();
    return watchPublicBookingRecords(slug, () => { void refreshBookingRecords(); });
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const next = await api<PagePayload>(`/api/public/business/${encodeURIComponent(slug)}`, { timeoutMs: HTTP_TIMEOUT_MS });
        if (cancelled) return;
        setPage(next);
        rememberClock(next);
        setServiceId(next.services[0]?.service_id ?? '');
        setDate(next.business.local_date);
      } catch (error) {
        if (!cancelled && !confirmation) setNotice(messageFor(error, 'Rezervasyon sayfası yüklenemedi.'));
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
    if (isGroupMode || !serviceId) return () => { cancelled = true; };
    async function loadStaff() {
      try {
        const result = await api<{ staff: PublicStaff[] }>(`/api/public/business/${encodeURIComponent(slug)}/staff?serviceId=${encodeURIComponent(serviceId)}`);
        if (!cancelled) setStaff(result.staff);
      } catch (error) {
        if (!cancelled) setNotice(messageFor(error, 'Personel bilgileri yüklenemedi.'));
      }
    }
    void loadStaff();
    return () => { cancelled = true; };
  }, [isGroupMode, serviceId, slug]);

  useEffect(() => {
    if (!blockingRecord) return undefined;
    const settleAfter = blockingRecord.status === 'submitting' ? blockingRecord.settleAfterEpochMs : 0;
    const retryAfter = recoveryCooldowns.current.get(blockingRecord.id) ?? 0;
    const wait = Math.max(settleAfter, retryAfter) - Date.now();
    if (wait <= 0) return undefined;
    const timer = window.setTimeout(() => setSettleTick((value) => value + 1), wait);
    return () => window.clearTimeout(timer);
  }, [blockingRecord, settleTick]);

  const resultVisible = Boolean(confirmation
    || (blockingRecord && ['committed', 'exists_nolink', 'legacy_unknown', 'expired_unverified'].includes(blockingRecord.status)));

  useEffect(() => {
    onResultVisibilityChange?.(resultVisible);
    return () => onResultVisibilityChange?.(false);
  }, [onResultVisibilityChange, resultVisible]);

  const selectedService = useMemo(() => page?.services.find((service) => service.service_id === serviceId) ?? null, [page, serviceId]);

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
      setNotice(messageFor(error, 'Uygun saatler getirilemedi.'));
    } finally {
      setBusy(false);
    }
  }

  async function keepConfirmedResult(
    record: V2PendingRecord | LegacyPendingRecord,
    expectedStatuses: readonly ('submitting' | 'unresolved' | 'legacy_pending')[],
    appointment: Confirmation,
    managementUrl: string,
    businessName?: string,
    group?: GroupConfirmation,
  ) {
    setConfirmation({
      appointment: { ...appointment, business_name: appointment.business_name ?? businessName },
      ...(group ? { group } : {}),
      manageUrl: managementUrl,
    });
    setConfirmationRecordId(null);
    setUnpersistedConfirmation({ id: record.id, expectedStatuses });
    setConfirmationStorageError('');
    try {
      const completed = await completePublicBookingIntent(record.id, expectedStatuses, 'committed');
      if (completed.applied || completed.record?.status === 'committed') {
        setConfirmationRecordId(record.id);
        setUnpersistedConfirmation(null);
        recoveryCooldowns.current.delete(record.id);
        if (completed.record) {
          setBookingRecords((records) => [
            completed.record!,
            ...records.filter((candidate) => candidate.id !== completed.record!.id),
          ]);
        }
      } else {
        setConfirmationStorageError('Randevu alındı ancak güvenli cihaz kaydı henüz tamamlanamadı.');
      }
    } catch {
      setConfirmationStorageError('Randevu alındı ancak güvenli cihaz kaydı henüz tamamlanamadı.');
    }
    await refreshBookingRecords();
  }

  async function retryConfirmationPersistence() {
    if (!unpersistedConfirmation) return;
    try {
      const completed = await completePublicBookingIntent(
        unpersistedConfirmation.id,
        unpersistedConfirmation.expectedStatuses,
        'committed',
      );
      if (!completed.applied && completed.record?.status !== 'committed') {
        setConfirmationStorageError('Güvenli cihaz kaydı tamamlanamadı. Lütfen tekrar deneyin.');
        return;
      }
      setConfirmationRecordId(unpersistedConfirmation.id);
      setUnpersistedConfirmation(null);
      setConfirmationStorageError('');
      if (completed.record) {
        setBookingRecords((records) => [
          completed.record!,
          ...records.filter((candidate) => candidate.id !== completed.record!.id),
        ]);
      }
      await refreshBookingRecords();
    } catch {
      setConfirmationStorageError('Güvenli cihaz kaydı tamamlanamadı. Lütfen tekrar deneyin.');
    }
  }

  async function resolveStoredResult(
    record: V2PendingRecord | LegacyPendingRecord,
    automatic = false,
  ) {
    if (automatic) {
      if (automaticResolveIds.current.has(record.id)) return;
      automaticResolveIds.current.add(record.id);
    }
    if (record.status === 'submitting' && Date.now() < record.settleAfterEpochMs) {
      if (automatic) automaticResolveIds.current.delete(record.id);
      setNotice('İlk randevu isteği hâlâ tamamlanıyor. Birkaç saniye sonra sonucu kontrol edin.');
      return;
    }
    const retryAt = recoveryCooldowns.current.get(record.id) ?? 0;
    if (Date.now() < retryAt) {
      setNotice(`Çok fazla istek yapıldı. ${Math.ceil((retryAt - Date.now()) / 1000)} saniye sonra tekrar deneyin.`);
      return;
    }
    if (resolvingIds.current.has(record.id)) return;
    resolvingIds.current.add(record.id);
    setRecoveryBusy(true);
    try {
      if (record.source === 'legacy_v1') {
        const result = await api<{ appointment: Confirmation; management: { url: string }; recovery: { expiresAt: string } }>('/api/public/booking/recover', {
          method: 'POST', csrf: 'skip', timeoutMs: HTTP_TIMEOUT_MS,
          body: JSON.stringify({ recoveryId: record.recoveryId, idempotencyKey: record.idempotencyKey, recoverySecret: record.recoverySecret }),
        });
        if (!validConfirmation(result.appointment) || !validManagementUrl(result.management?.url, true)) throw new Error('Randevu sonucu doğrulanamadı.');
        await keepConfirmedResult(record, ['legacy_pending'], result.appointment, result.management.url);
        setNotice('');
      } else {
        const expectsGroup = record.bookingKind === 'group';
        const expectedGroupPlan = expectsGroup ? record.groupPlan : undefined;
        const result = await api<ResolveResponse>('/api/public/booking/resolve', {
          method: 'POST', csrf: 'skip', timeoutMs: HTTP_TIMEOUT_MS,
          body: JSON.stringify({ recoveryId: record.recoveryId, idempotencyKey: record.idempotencyKey, recoverySecret: record.recoverySecret }),
        });
        if (result.recoveryId !== record.recoveryId || !['committed', 'exists_nolink', 'closed_absent'].includes(result.resolution)) throw new Error('Randevu sonucu doğrulanamadı.');
        if (result.resolution === 'committed'
            && (expectsGroup !== (result.group !== undefined)
              || !validConfirmation(result.appointment, expectsGroup)
              || (result.group !== undefined && !validGroupConfirmation(result.group, result.appointment))
              || (expectsGroup
                && (expectedGroupPlan === undefined || result.group === undefined || !groupMatchesSelection(result.group, expectedGroupPlan)))
              || (result.group === undefined && result.appointment?.price_minor === null)
              || !validManagementUrl(result.management?.url)
              || typeof result.recovery?.expiresAt !== 'string'
              || !Number.isFinite(Date.parse(result.recovery.expiresAt)))) throw new Error('Randevu sonucu doğrulanamadı.');
        if (result.resolution !== 'committed'
            && (result.appointment !== undefined || result.group !== undefined || result.management !== undefined || result.recovery !== undefined)) {
          throw new Error('Randevu sonucu doğrulanamadı.');
        }
        if (result.resolution === 'committed') {
          await keepConfirmedResult(record, ['submitting', 'unresolved'], result.appointment!, result.management!.url, undefined, result.group);
          setNotice('');
        } else {
          const completed = await completePublicBookingIntent(record.id, ['submitting', 'unresolved'], result.resolution);
          if (result.resolution === 'exists_nolink' && completed.applied) {
            setNotice('Randevunuz alınmış. Yönetim bağlantısı artık bu cihazdan açılamıyor.');
          } else if (result.resolution === 'closed_absent' && completed.applied) {
            setNotice('Önceki randevu isteği oluşturulmadan güvenli olarak kapatıldı. Yeni bir saat seçerek yeniden deneyebilirsiniz.');
            if (expectsGroup) onPlanNeedsRefresh?.();
            else {
              setSelectedSlot(null);
              void loadSlots();
            }
          }
        }
      }
      await refreshBookingRecords();
    } catch (error) {
      if (error instanceof ApiRequestError && error.retryAfter !== undefined) {
        recoveryCooldowns.current.set(record.id, Date.now() + error.retryAfter * 1000);
        setSettleTick((value) => value + 1);
      }
      setNotice(messageFor(error, 'Önceki randevu işleminizin sonucu henüz doğrulanamadı. Yeni randevu oluşturmadan önce tekrar kontrol edin.'));
      await refreshBookingRecords();
    } finally {
      resolvingIds.current.delete(record.id);
      setRecoveryBusy(false);
    }
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockingRecord || !storageReady
        || (isGroupMode ? !multiServiceSelection : !selectedSlot || !selectedService)) return;
    const formData = new FormData(event.currentTarget);
    const customerName = String(formData.get('customerName') ?? '').trim();
    const customerPhone = String(formData.get('customerPhone') ?? '').trim();
    const customerEmail = String(formData.get('customerEmail') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim();
    if (!customerPhone) {
      setContactError('Telefon bilgisi zorunlu. E-posta isteğe bağlıdır.');
      return;
    }
    setContactError('');
    const payload = isGroupMode
      ? {
          customerName,
          customerPhone: customerPhone || null,
          customerEmail: customerEmail || null,
          notes: notes || null,
          startsAt: multiServiceSelection!.slot.startsAt,
          lines: multiServiceSelection!.lines,
        }
      : {
          customerName,
          customerPhone: customerPhone || null,
          customerEmail: customerEmail || null,
          notes: notes || null,
          serviceId: selectedService!.service_id,
          staffId: selectedSlot!.staff_id,
          startsAt: selectedSlot!.starts_at,
        };
    setBusy(true);
    setNotice('');
    let pending: V2PendingRecord | null = null;
    try {
      const clock = await currentClock();
      const recoveryId = crypto.randomUUID();
      const recoverySecret = createSecret();
      const managementToken = createSecret();
      const deadline = clock.serverNowEpochSeconds + clock.submitWindowSeconds;
      const intent = await derivePublicBookingIntentV2(recoveryId, deadline, recoverySecret);
      if (!intent) throw new Error('Rezervasyon işlemi güvenli olarak hazırlanamadı.');
      const sampledAtEpochMs = Date.now();
      const acquired = await acquirePublicBookingIntent({
        slug, bookingKind: isGroupMode ? 'group' : 'single', groupPlan: isGroupMode ? multiServiceSelection! : undefined,
        idempotencyKey: intent.idempotencyKey, recoveryId, recoverySecret,
        requestFingerprint: await sha256Hex(JSON.stringify(payload)), sampledAtEpochMs,
        expiresAtEpochMs: sampledAtEpochMs + PUBLIC_BOOKING_RECOVERY_TTL_MS,
        submitDeadlineEpochSeconds: deadline, settleAfterEpochMs: Date.now() + PUBLIC_BOOKING_SETTLE_MS,
        ownerId: crypto.randomUUID(),
      });
      await refreshBookingRecords();
      if (!acquired.created) {
        setNotice('Önceki randevu işleminizin sonucu netleşmeden yeni randevu oluşturmayacağız.');
        return;
      }
      pending = acquired.record;
      const endpoint = `/api/public/business/${encodeURIComponent(slug)}/${isGroupMode ? 'group-book' : 'book'}`;
      const result = await api<{
        appointment?: Confirmation;
        appointmentId?: string;
        group?: GroupConfirmation;
        management: { url: string };
        recovery: { expiresAt: string };
      }>(endpoint, {
        method: 'POST', csrf: 'skip', timeoutMs: HTTP_TIMEOUT_MS,
        headers: { 'Idempotency-Key': pending.idempotencyKey },
        body: JSON.stringify({ ...payload, managementToken, recoveryId: pending.recoveryId, recoverySecret: pending.recoverySecret }),
      });
      if (result.management?.url !== `/m#${managementToken}`
          || typeof result.recovery?.expiresAt !== 'string'
          || !Number.isFinite(Date.parse(result.recovery.expiresAt))) throw new Error('Randevu sonucu doğrulanamadı.');
      if (isGroupMode) {
        if (!validUuid(result.appointmentId)
            || !validGroupConfirmation(result.group)
            || result.group.lines[0]?.appointmentId !== result.appointmentId
            || !groupMatchesSelection(result.group, multiServiceSelection!)) throw new Error('Grup rezervasyonu sonucu seçili planla eşleşmedi.');
        const anchor = result.group.lines[0]!;
        const appointment: Confirmation = {
          appointment_id: result.appointmentId,
          business_name: page?.business.name,
          status: anchor.status,
          starts_at: anchor.startsAt,
          ends_at: anchor.endsAt,
          timezone: result.group.timezone,
          service_name: anchor.serviceName,
          staff_name: anchor.staffName,
          price_minor: anchor.priceMinor,
          currency: result.group.currency,
        };
        await keepConfirmedResult(pending, ['submitting', 'unresolved'], appointment, result.management.url, page?.business.name, result.group);
      } else {
        if (!validConfirmation(result.appointment) || result.group !== undefined || result.appointmentId !== undefined) throw new Error('Randevu sonucu doğrulanamadı.');
        await keepConfirmedResult(pending, ['submitting', 'unresolved'], result.appointment, result.management.url, page?.business.name);
      }
      setNotice('');
    } catch (error) {
      if (!pending) {
        setNotice(messageFor(error, 'Randevu işlemi bu tarayıcıda güvenli olarak hazırlanamadı.'));
      } else {
        const unresolved = await markPublicBookingUnresolved(pending.id, pending.ownerId).catch(() => null);
        await refreshBookingRecords();
        if (error instanceof ApiRequestError && error.retryAfter !== undefined) {
          recoveryCooldowns.current.set(pending.id, Date.now() + error.retryAfter * 1000);
          setSettleTick((value) => value + 1);
          setNotice(messageFor(error, 'Çok fazla istek yapıldı. Daha sonra sonucu tekrar kontrol edin.'));
        } else {
          setNotice('Randevu isteğinin sonucu belirsiz kaldı. Aynı işlemin sonucunu bir kez kontrol ediyoruz…');
          if (unresolved && isRecoverableRecord(unresolved)) {
            await resolveStoredResult(unresolved, true);
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeReminder(record: PublicBookingRecord) {
    try {
      const removed = record.source === 'legacy_v1' ? await forgetLegacyBookingRecord(record.id) : await dismissPublicBookingRecord(record.id);
      if (!removed) {
        setNotice('Bu işlem devam ederken cihazdaki kayıt kaldırılamaz. Önce sonucu kontrol edin.');
        return;
      }
      setConfirmation(null);
      setConfirmationRecordId(null);
      setNotice('');
      await refreshBookingRecords();
    } catch (error) {
      setNotice(messageFor(error, 'Cihazdaki randevu hatırlatıcısı kaldırılamadı.'));
    }
  }

  if (loading && !confirmation) return <main className="public-booking-shell"><section className="public-booking-card"><p>Uygun saatler hazırlanıyor…</p></section></main>;

  const waitingForCreate = blockingRecord?.status === 'submitting' && Date.now() < blockingRecord.settleAfterEpochMs;
  const activeRetryAt = blockingRecord ? recoveryCooldowns.current.get(blockingRecord.id) ?? 0 : 0;
  const waitingForRetry = Date.now() < activeRetryAt;
  const retryWaitSeconds = waitingForRetry ? Math.max(1, Math.ceil((activeRetryAt - Date.now()) / 1000)) : 0;

  if (confirmation) {
    const receipt = confirmationRecordId ? bookingRecords.find((record) => record.id === confirmationRecordId) ?? null : null;
    const appointment = confirmation.appointment;
    const outcome = confirmationOutcome(appointment, confirmation.group);
    return <main className="public-booking-shell"><section className="public-booking-card public-confirmation">
      <div className={`public-result-mark is-${outcome.tone}`}>{outcome.symbol}</div><p className="public-kicker">{outcome.kicker}</p>
      <h1>{appointment.business_name ?? page?.business.name ?? 'Randevu'}</h1>
      {confirmation.group ? <>
        <p className="public-confirmation-lead">{confirmation.group.lines.length} hizmetlik planınız {outcome.groupTail}</p>
        <ol className="public-confirmation-services">{confirmation.group.lines.map((line) => <li key={line.appointmentId}>
          <span><strong>{line.serviceName}</strong><small>{line.staffName} · {formatTime(line.startsAt, confirmation.group!.timezone)}–{formatTime(line.endsAt, confirmation.group!.timezone)}</small><small>Durum: {appointmentStatusLabel(line.status)}</small></span>
          <span>{line.priceMinMinor === line.priceMaxMinor ? money(line.priceMinMinor, line.currency) : `${money(line.priceMinMinor, line.currency)} – ${money(line.priceMaxMinor, line.currency)}`}</span>
        </li>)}</ol>
        <dl className="public-confirmation-list"><div><dt>Başlangıç</dt><dd>{formatDateTime(confirmation.group.startsAt, confirmation.group.timezone)}</dd></div><div><dt>Fiyat</dt><dd>{estimateMoney(confirmation.group.estimateMinMinor, confirmation.group.estimateMaxMinor, confirmation.group.currency)}</dd></div></dl>
        <p className="public-confirmation-note">Bu tutar rezervasyon tahminidir. Kesin tahsilat tutarı değildir.</p>
      </> : <dl className="public-confirmation-list"><div><dt>Hizmet</dt><dd>{appointment.service_name}</dd></div><div><dt>Personel</dt><dd>{appointment.staff_name}</dd></div><div><dt>Tarih</dt><dd>{formatDateTime(appointment.starts_at, appointment.timezone)}</dd></div><div><dt>Ücret</dt><dd>{appointment.price_minor === null ? 'İşletmede netleşecek' : money(appointment.price_minor, appointment.currency)}</dd></div></dl>}
      <div className={`public-result-status is-${outcome.tone}`} aria-label="Rezervasyon ve mesaj durumu"><p><strong>Kayıt durumu:</strong> {outcome.state}</p><p><strong>Mesaj durumu:</strong> Bu ekran SMS veya e-posta teslimini doğrulamaz.</p></div>
      <p className="public-confirmation-note">{outcome.active ? 'Yönetim bağlantınızı kaybetmeyin; bu bağlantı randevuyu taşıma ve iptal etme yetkisi verir.' : 'Randevu ayrıntılarınızı yönetim bağlantısından görüntüleyebilirsiniz.'}</p>
      <a className="public-primary" href={confirmation.manageUrl}>{outcome.active ? 'Randevumu yönet' : 'Randevu ayrıntılarını aç'}</a>
      {confirmationStorageError && <div className="public-booking-notice" role="alert">{confirmationStorageError} Bu kayıt tamamlanana kadar yeni randevu başlatmayın.</div>}
      {unpersistedConfirmation && <button className="public-secondary" type="button" onClick={() => void retryConfirmationPersistence()}>Güvenli kaydı yeniden dene</button>}
      <button className="public-secondary" type="button" disabled={!receipt} onClick={() => { if (receipt) void removeReminder(receipt); }}>Yeni randevu oluştur</button>
    </section></main>;
  }

  if (blockingRecord && (blockingRecord.status === 'committed' || blockingRecord.status === 'exists_nolink')) {
    return <main className="public-booking-shell"><section className="public-booking-card public-confirmation">
      <div className="public-success-mark">✓</div><p className="public-kicker">RANDEVU KAYDI BULUNDU</p><h1>Önceki randevunuz alındı.</h1>
      <p className="public-confirmation-note">Yönetim bağlantısı güvenlik nedeniyle bu cihazda saklanmadı. Bağlantıyı kaybettiyseniz randevu bilgilerinizi işletmeyle kontrol edin.</p>
      <button className="public-secondary" type="button" onClick={() => void removeReminder(blockingRecord)}>Yeni randevu oluştur</button>
    </section></main>;
  }

  if (blockingRecord && (blockingRecord.status === 'legacy_unknown' || blockingRecord.status === 'expired_unverified')) {
    return <main className="public-booking-shell"><section className="public-booking-card public-empty-state">
      <p className="public-kicker">ÖNCEKİ İŞLEM BELİRSİZ</p><h1>Önceki randevunuzu kontrol edin.</h1>
      <p>Bu cihazdaki kayıt sonucu doğrulamaya yetmiyor. E-posta veya yönetim bağlantınızı kontrol edin ya da işletmeyle görüşün.</p>
      <p>Cihazdaki hatırlatıcıyı kaldırmak randevuyu iptal etmez ve işlemin yapılmadığını kanıtlamaz.</p>
      <button className="public-secondary" type="button" onClick={() => void removeReminder(blockingRecord)}>Cihazdaki hatırlatıcıyı kaldır</button>
    </section></main>;
  }

  if (!page) return <main className="public-booking-shell"><section className="public-booking-card public-empty-state">
    <p className="public-kicker">YZT RANDEVU</p><h1>Bu rezervasyon bağlantısı şu anda aktif değil.</h1><p>{notice || 'İşletme bağlantıyı kapatmış veya adres geçersiz olabilir.'}</p>
    {blockingRecord && isRecoverableRecord(blockingRecord) && <button className="public-primary" type="button" disabled={recoveryBusy || waitingForCreate || waitingForRetry} onClick={() => void resolveStoredResult(blockingRecord)}>{recoveryBusy ? 'Randevu sonucu kontrol ediliyor…' : waitingForRetry ? `${retryWaitSeconds} saniye sonra tekrar deneyin` : 'Önceki randevu sonucunu kontrol et'}</button>}
  </section></main>;

  if (isGroupMode) return <div className="public-booking-shell public-booking-checkout-shell">
    {notice && <div className="public-booking-notice" role="status">{notice}</div>}
    {storageError && <div className="public-booking-notice" role="alert">{storageError} Tarayıcı depolamasını açıp tekrar deneyin. <button className="public-secondary" type="button" onClick={() => void refreshBookingRecords()}>Depolamayı yeniden dene</button></div>}
    {closedReceipt && !blockingRecord && <div className="public-booking-notice" role="status">Önceki randevu isteği oluşturulmadan güvenli olarak kapatıldı. Hizmet seçiminiz korundu; yeni uygunluk getiriliyor.</div>}
    {blockingRecord && isRecoverableRecord(blockingRecord) && <div className="public-booking-notice" role="status">
      <span>Önceki randevu işleminizin sonucu netleşmeden yeni randevu oluşturmayacağız.</span>{' '}
      <button className="public-secondary" type="button" disabled={recoveryBusy || waitingForCreate || waitingForRetry} onClick={() => void resolveStoredResult(blockingRecord)}>{recoveryBusy ? 'Kontrol ediliyor…' : waitingForCreate ? 'İlk istek tamamlanıyor…' : waitingForRetry ? `${retryWaitSeconds} saniye sonra tekrar deneyin` : 'Sonucu tekrar kontrol et'}</button>
      {blockingRecord.source === 'legacy_v1' && <><span>Cihazdaki hatırlatıcıyı kaldırmak randevuyu iptal etmez ve işlemin yapılmadığını kanıtlamaz.</span> <button className="public-secondary" type="button" disabled={recoveryBusy} onClick={() => void removeReminder(blockingRecord)}>Cihazdaki hatırlatıcıyı kaldır</button></>}
    </div>}
    <section className={`public-booking-card public-customer-card public-group-customer-card ${multiServiceSelection ? 'is-ready' : ''}`} aria-labelledby="public-group-customer-title">
      <span className="public-step">B</span><h2 id="public-group-customer-title">İletişim ve onay</h2>
      {multiServiceSelection ? <>
        <div className="public-selection-summary public-group-selection-summary">
          <span><strong>{multiServiceSelection.slot.lines.length} hizmet</strong><small>{formatDateTime(multiServiceSelection.slot.startsAt, multiServiceSelection.slot.timezone)}</small></span>
          <span><strong>{estimateMoney(multiServiceSelection.slot.estimateMinMinor, multiServiceSelection.slot.estimateMaxMinor, multiServiceSelection.slot.currency)}</strong><small>Kesin tahsilat tutarı değildir.</small></span>
        </div>
        <form className="public-customer-form" onSubmit={(event) => void book(event)}>
          <label><span>Ad soyad</span><input name="customerName" minLength={2} maxLength={120} autoComplete="name" required aria-describedby="public-contact-help" /></label>
          <div className="public-two-columns"><label><span>Telefon <small>(zorunlu)</small></span><input name="customerPhone" maxLength={40} autoComplete="tel" placeholder="05xx…" aria-required="true" aria-describedby={`public-contact-help${contactError ? ' public-contact-error' : ''}`} aria-invalid={Boolean(contactError)} onInput={() => setContactError('')} /></label><label><span>E-posta <small>(isteğe bağlı)</small></span><input name="customerEmail" maxLength={254} type="email" autoComplete="email" placeholder="ornek@eposta.com" aria-describedby="public-contact-help" /></label></div>
          <small id="public-contact-help" className="public-field-hint">Telefon zorunlu. E-posta isteğe bağlıdır.</small>
          {contactError && <div id="public-contact-error" className="public-field-error" role="alert">{contactError}</div>}
          <label><span>Not <small>(isteğe bağlı)</small></span><textarea name="notes" maxLength={1000} rows={3} /></label>
          <button className="public-primary public-book-button" disabled={busy || Boolean(blockingRecord) || !storageReady}>{blockingRecord ? 'Önceki randevu kontrol ediliyor…' : !storageReady ? 'Güvenli kayıt hazırlanıyor…' : busy ? 'Randevu oluşturuluyor…' : 'Planı onayla ve randevuyu oluştur'}</button>
        </form>
      </> : <p className="public-muted">İletişim formunu açmak için yukarıdan hizmetlerinizi ve birlikte uygun bir saati seçin.</p>}
    </section>
    <footer className="public-booking-footer">Saatler {page.business.timezone} saat dilimine göre gösterilir. Randevu kaydı ile mesaj teslimi ayrı durumlardır.</footer>
  </div>;

  return <main className="public-booking-shell">
    <header className="public-booking-header"><p className="public-kicker">ONLINE RANDEVU</p><h1>{page.business.name}</h1><p>Hizmeti ve günü seçin, gerçek boş saatlerden birini ayırın.</p></header>
    {notice && <div className="public-booking-notice" role="status">{notice}</div>}
    {storageError && <div className="public-booking-notice" role="alert">{storageError} Tarayıcı depolamasını açıp tekrar deneyin. <button className="public-secondary" type="button" onClick={() => void refreshBookingRecords()}>Depolamayı yeniden dene</button></div>}
    {closedReceipt && !blockingRecord && <div className="public-booking-notice" role="status">Önceki randevu isteği oluşturulmadan güvenli olarak kapatıldı. Yeni bir saat seçerek yeniden deneyebilirsiniz.</div>}
    {blockingRecord && isRecoverableRecord(blockingRecord) && <div className="public-booking-notice" role="status">
      <span>Önceki randevu işleminizin sonucu netleşmeden yeni randevu oluşturmayacağız.</span>{' '}
      <button className="public-secondary" type="button" disabled={recoveryBusy || waitingForCreate || waitingForRetry} onClick={() => void resolveStoredResult(blockingRecord)}>{recoveryBusy ? 'Kontrol ediliyor…' : waitingForCreate ? 'İlk istek tamamlanıyor…' : waitingForRetry ? `${retryWaitSeconds} saniye sonra tekrar deneyin` : 'Sonucu tekrar kontrol et'}</button>
      {blockingRecord.source === 'legacy_v1' && <><span>Cihazdaki hatırlatıcıyı kaldırmak randevuyu iptal etmez ve işlemin yapılmadığını kanıtlamaz.</span> <button className="public-secondary" type="button" disabled={recoveryBusy} onClick={() => void removeReminder(blockingRecord)}>Cihazdaki hatırlatıcıyı kaldır</button></>}
    </div>}
    <div className="public-booking-layout">
      <section className="public-booking-card"><span className="public-step">1</span><h2>Hizmet ve tarih</h2>
        {page.services.length ? <form className="public-picker-form" onSubmit={(event) => void loadSlots(event)}>
          <label><span>Hizmet</span><select value={serviceId} onChange={(event) => { setServiceId(event.target.value); resetSlotSelection(); }}>{page.services.map((service) => <option key={service.service_id} value={service.service_id}>{service.name} · {service.duration_minutes} dk · {money(service.price_minor, service.currency)}</option>)}</select></label>
          <label><span>Personel</span><select value={staffId} onChange={(event) => { setStaffId(event.target.value); resetSlotSelection(); }}><option value="any">Fark etmez</option>{staff.map((person) => <option key={person.staff_id} value={person.staff_id}>{person.staff_name}</option>)}</select></label>
          <label><span>Tarih</span><input type="date" value={date} min={page.business.local_date} max={page.business.max_date} onChange={(event) => { setDate(event.target.value); resetSlotSelection(); }} required /></label>
          <button className="public-primary" disabled={busy || !serviceId}>{busy ? 'Bakılıyor…' : 'Uygun saatleri göster'}</button>
        </form> : <p className="public-muted">Şu anda online randevuya açık hizmet bulunmuyor.</p>}
      </section>
      <section className="public-booking-card"><span className="public-step">2</span><h2>Uygun saat</h2>
        {slots.length ? <div className="public-slot-grid">{slots.map((slot) => { const active = selectedSlot?.staff_id === slot.staff_id && selectedSlot.starts_at === slot.starts_at; return <button className={`public-slot ${active ? 'is-selected' : ''}`} type="button" key={`${slot.staff_id}-${slot.starts_at}`} onClick={() => { setSelectedSlot(slot); setNotice(''); }}><strong>{formatTime(slot.starts_at, slot.timezone)}</strong><span>{slot.staff_name}</span></button>; })}</div> : <p className="public-muted">Önce hizmet ve tarih seçip uygun saatleri getirin.</p>}
      </section>
      <section className={`public-booking-card public-customer-card ${selectedSlot ? 'is-ready' : ''}`}><span className="public-step">3</span><h2>İletişim bilgileri</h2>
        {selectedSlot && selectedService ? <><div className="public-selection-summary"><strong>{selectedService.name}</strong><span>{formatDateTime(selectedSlot.starts_at, selectedSlot.timezone)} · {selectedSlot.staff_name}</span></div>
          <form className="public-customer-form" onSubmit={(event) => void book(event)}><label><span>Ad soyad</span><input name="customerName" minLength={2} maxLength={120} autoComplete="name" required aria-describedby="public-contact-help" /></label><div className="public-two-columns"><label><span>Telefon <small>(zorunlu)</small></span><input name="customerPhone" maxLength={40} autoComplete="tel" placeholder="05xx…" aria-required="true" aria-describedby={`public-contact-help${contactError ? ' public-contact-error' : ''}`} aria-invalid={Boolean(contactError)} onInput={() => setContactError('')} /></label><label><span>E-posta <small>(isteğe bağlı)</small></span><input name="customerEmail" maxLength={254} type="email" autoComplete="email" placeholder="ornek@eposta.com" aria-describedby="public-contact-help" /></label></div><small id="public-contact-help" className="public-field-hint">Telefon zorunlu. E-posta isteğe bağlıdır.</small>{contactError && <div id="public-contact-error" className="public-field-error" role="alert">{contactError}</div>}<label><span>Not <small>(isteğe bağlı)</small></span><textarea name="notes" maxLength={500} rows={3} /></label>
            <button className="public-primary public-book-button" disabled={busy || Boolean(blockingRecord) || !storageReady}>{blockingRecord ? 'Önceki randevu kontrol ediliyor…' : !storageReady ? 'Güvenli kayıt hazırlanıyor…' : busy ? 'Randevu oluşturuluyor…' : 'Randevuyu oluştur'}</button>
          </form></> : <p className="public-muted">Bir saat seçtiğinizde iletişim formu burada açılır.</p>}
      </section>
    </div>
    <footer className="public-booking-footer">Saatler {page.business.timezone} saat dilimine göre gösterilir.</footer>
  </main>;
}
