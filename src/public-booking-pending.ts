import {
  isCanonicalPublicBookingRecoveryId,
  isCanonicalPublicBookingSecret,
  verifyPublicBookingIntentV2,
} from '../shared/public-booking-intent.ts';

export const PUBLIC_BOOKING_RECOVERY_TTL_MS = 72 * 60 * 60 * 1000;
export const PUBLIC_BOOKING_SETTLE_MS = 12_000;

const DATABASE_NAME = 'yzt-public-booking-pending-v2';
const DATABASE_VERSION = 1;
const STORE_NAME = 'booking-intents';
const SLUG_INDEX = 'by-slug';
const CHANNEL_NAME = 'yzt-public-booking-pending-events-v2';
const LEGACY_PREFIX = 'yzt-public-booking-pending-v1:';
const OPEN_TIMEOUT_MS = 5_000;

export type PendingBookingStatus = 'submitting' | 'unresolved' | 'legacy_pending';
export type BookingTerminalStatus =
  | 'committed'
  | 'exists_nolink'
  | 'closed_absent'
  | 'expired_unverified'
  | 'legacy_unknown';

type BookingRecordBase = {
  id: string;
  slug: string;
  version: 1 | 2;
  source: 'v2' | 'legacy_v1';
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
};

export type V2PendingRecord = BookingRecordBase & {
  version: 2;
  source: 'v2';
  status: 'submitting' | 'unresolved';
  /** Missing only on pre-F12-05 records, which were necessarily single-service. */
  bookingKind?: 'single' | 'group';
  idempotencyKey: string;
  recoveryId: string;
  recoverySecret: string;
  requestFingerprint: string;
  sampledAtEpochMs: number;
  expiresAtEpochMs: number;
  submitDeadlineEpochSeconds: number;
  settleAfterEpochMs: number;
  ownerId: string;
};

export type LegacyPendingRecord = BookingRecordBase & {
  version: 1;
  source: 'legacy_v1';
  status: 'legacy_pending';
  idempotencyKey: string;
  recoveryId: string;
  recoverySecret: string;
  requestFingerprint: string;
  expiresAtEpochMs: number;
};

export type TerminalBookingRecord = BookingRecordBase & {
  status: BookingTerminalStatus;
  resolvedAtEpochMs: number;
};

export type PublicBookingRecord = V2PendingRecord | LegacyPendingRecord | TerminalBookingRecord;

export type NewPublicBookingIntent = {
  slug: string;
  bookingKind?: 'single' | 'group';
  idempotencyKey: string;
  recoveryId: string;
  recoverySecret: string;
  requestFingerprint: string;
  sampledAtEpochMs: number;
  expiresAtEpochMs: number;
  submitDeadlineEpochSeconds: number;
  settleAfterEpochMs: number;
  ownerId: string;
};

export type AcquirePublicBookingIntentResult =
  | { created: true; record: V2PendingRecord }
  | { created: false; record: PublicBookingRecord };

export class PublicBookingStorageError extends Error {
  constructor(message = 'Randevu işlemi bu tarayıcıda güvenli olarak saklanamadı.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'PublicBookingStorageError';
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;

function validSlug(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 60
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

function storageSlug(value: string) {
  return value.toLocaleLowerCase('en-US');
}

function validEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')), { once: true });
  });
  // Request failure often precedes the transaction's abort event. Keep that
  // later rejection observed even when the request await exits first.
  void result.catch(() => undefined);
  return result;
}

async function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') throw new PublicBookingStorageError();

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let finished = false;
    let request: IDBOpenDBRequest;
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      fail(error);
      return;
    }
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store.indexNames.contains(SLUG_INDEX)) store.createIndex(SLUG_INDEX, 'slug', { unique: false });
    });
    request.addEventListener('success', () => {
      const database = request.result;
      if (finished) {
        database.close();
        return;
      }
      finished = true;
      clearTimeout(timer);
      database.addEventListener('versionchange', () => {
        database.close();
        databasePromise = null;
      });
      resolve(database);
    }, { once: true });
    request.addEventListener('blocked', () => fail(new Error('IndexedDB upgrade blocked')), { once: true });
    request.addEventListener('error', () => fail(request.error ?? new Error('IndexedDB open failed')), { once: true });
  }).catch((error) => {
    databasePromise = null;
    throw error instanceof PublicBookingStorageError ? error : new PublicBookingStorageError();
  });
  databasePromise = opening;
  return opening;
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function terminalFrom(record: BookingRecordBase, status: BookingTerminalStatus, now: number): TerminalBookingRecord {
  return {
    id: record.id,
    slug: record.slug,
    version: record.version,
    source: record.source,
    status,
    createdAtEpochMs: record.createdAtEpochMs,
    updatedAtEpochMs: now,
    resolvedAtEpochMs: now,
  };
}

function isPending(record: PublicBookingRecord): record is V2PendingRecord | LegacyPendingRecord {
  return record.status === 'submitting' || record.status === 'unresolved' || record.status === 'legacy_pending';
}

function isStoredRecord(value: unknown, slug: string): value is PublicBookingRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PublicBookingRecord>;
  if (typeof record.id !== 'string' || record.slug !== slug
      || !validEpoch(record.createdAtEpochMs) || !validEpoch(record.updatedAtEpochMs)) return false;
  if (record.status === 'submitting' || record.status === 'unresolved') {
    const pending = record as Partial<V2PendingRecord>;
    return pending.version === 2 && pending.source === 'v2'
      && (pending.bookingKind === undefined || pending.bookingKind === 'single' || pending.bookingKind === 'group')
      && typeof pending.idempotencyKey === 'string'
      && isCanonicalPublicBookingRecoveryId(pending.recoveryId)
      && isCanonicalPublicBookingSecret(pending.recoverySecret)
      && typeof pending.requestFingerprint === 'string' && /^[0-9a-f]{64}$/.test(pending.requestFingerprint)
      && validEpoch(pending.sampledAtEpochMs) && validEpoch(pending.expiresAtEpochMs)
      && Number.isInteger(pending.submitDeadlineEpochSeconds)
      && validEpoch(pending.settleAfterEpochMs)
      && typeof pending.ownerId === 'string' && pending.ownerId.length > 0;
  }
  if (record.status === 'legacy_pending') {
    const pending = record as Partial<LegacyPendingRecord>;
    return pending.version === 1 && pending.source === 'legacy_v1'
      && typeof pending.idempotencyKey === 'string' && pending.idempotencyKey.length >= 8 && pending.idempotencyKey.length <= 128
      && typeof pending.recoveryId === 'string'
      && typeof pending.recoverySecret === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(pending.recoverySecret)
      && typeof pending.requestFingerprint === 'string' && /^[0-9a-f]{64}$/.test(pending.requestFingerprint)
      && validEpoch(pending.expiresAtEpochMs);
  }
  return ['committed', 'exists_nolink', 'closed_absent', 'expired_unverified', 'legacy_unknown'].includes(record.status ?? '')
    && ((record.version === 1 && record.source === 'legacy_v1')
      || (record.version === 2 && record.source === 'v2'))
    && validEpoch((record as Partial<TerminalBookingRecord>).resolvedAtEpochMs);
}

function recordPriority(record: PublicBookingRecord) {
  switch (record.status) {
    case 'submitting': return 0;
    case 'unresolved': return 1;
    case 'legacy_pending': return 2;
    case 'committed': return 3;
    case 'exists_nolink': return 4;
    case 'expired_unverified': return 5;
    case 'legacy_unknown': return 6;
    case 'closed_absent': return 7;
  }
}

function sorted(records: PublicBookingRecord[]) {
  return [...records].sort((left, right) => {
    const priority = recordPriority(left) - recordPriority(right);
    return priority || right.updatedAtEpochMs - left.updatedAtEpochMs || left.id.localeCompare(right.id);
  });
}

function notifyOtherTabs(slug: string) {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ slug });
    channel.close();
  } catch {
    // The committed IndexedDB record remains authoritative without a nudge.
  }
}

async function legacyRecord(raw: string, slug: string, now: number): Promise<PublicBookingRecord> {
  const digest = await sha256Hex(raw);
  const base: BookingRecordBase = {
    id: `legacy-v1:${digest}`,
    slug,
    version: 1,
    source: 'legacy_v1',
    createdAtEpochMs: now,
    updatedAtEpochMs: now,
  };
  let value: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>;
  } catch {
    // The opaque source is represented by a proofless marker below.
  }
  const createdAt = typeof value?.createdAt === 'string' ? Date.parse(value.createdAt) : NaN;
  const valid = typeof value?.slug === 'string' && validSlug(value.slug) && storageSlug(value.slug) === slug
    && typeof value?.idempotencyKey === 'string' && value.idempotencyKey.length >= 8 && value.idempotencyKey.length <= 128
    && typeof value?.recoveryId === 'string'
    && typeof value?.recoverySecret === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value.recoverySecret)
    && typeof value?.requestFingerprint === 'string' && /^[0-9a-f]{64}$/.test(value.requestFingerprint)
    && Number.isFinite(createdAt)
    && createdAt <= now;

  if (!valid) return terminalFrom(base, 'legacy_unknown', now);
  if (now - createdAt >= PUBLIC_BOOKING_RECOVERY_TTL_MS) {
    return terminalFrom({ ...base, createdAtEpochMs: createdAt }, 'expired_unverified', now);
  }
  const legacy = value!;
  return {
    id: base.id,
    slug: base.slug,
    version: 1,
    source: 'legacy_v1',
    createdAtEpochMs: createdAt,
    updatedAtEpochMs: now,
    status: 'legacy_pending',
    idempotencyKey: legacy.idempotencyKey as string,
    recoveryId: legacy.recoveryId as string,
    recoverySecret: legacy.recoverySecret as string,
    requestFingerprint: legacy.requestFingerprint as string,
    expiresAtEpochMs: createdAt + PUBLIC_BOOKING_RECOVERY_TTL_MS,
  };
}

async function importLegacyRecords(originalSlug: string, slug: string, now: number) {
  if (typeof sessionStorage === 'undefined') return false;
  const candidates: Array<{ key: string; raw: string }> = [];
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(LEGACY_PREFIX)) continue;
      const legacySlug = key.slice(LEGACY_PREFIX.length);
      if (storageSlug(legacySlug) !== slug) continue;
      const raw = sessionStorage.getItem(key);
      if (raw !== null) candidates.push({ key, raw });
    }
    const exactKey = `${LEGACY_PREFIX}${originalSlug}`;
    if (!candidates.some((candidate) => candidate.key === exactKey)) {
      const raw = sessionStorage.getItem(exactKey);
      if (raw !== null) candidates.push({ key: exactKey, raw });
    }
  } catch (error) {
    throw new PublicBookingStorageError(undefined, { cause: error });
  }
  if (candidates.length === 0) return false;

  let inserted = false;
  for (const candidate of candidates) {
    const record = await legacyRecord(candidate.raw, slug, now);
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const existing = await requestResult(store.get(record.id));
      if (existing === undefined) {
        store.add(record);
        inserted = true;
      }
      await done;
    } catch {
      throw new PublicBookingStorageError();
    }
    try {
      sessionStorage.removeItem(candidate.key);
    } catch {
      // A later deterministic import reads the existing record and cannot replace it.
    }
  }
  if (inserted) notifyOtherTabs(slug);
  return inserted;
}

export async function loadPublicBookingRecords(slug: string): Promise<PublicBookingRecord[]> {
  if (!validSlug(slug)) throw new PublicBookingStorageError();
  const normalizedSlug = storageSlug(slug);
  const now = Date.now();
  await importLegacyRecords(slug, normalizedSlug, now);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const values = await requestResult(store.index(SLUG_INDEX).getAll(normalizedSlug)) as unknown[];
    const records: PublicBookingRecord[] = [];
    let changed = false;
    for (const value of values) {
      if (!isStoredRecord(value, normalizedSlug)) {
        const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
        const id = typeof raw?.id === 'string' ? raw.id : `legacy-v1:invalid:${crypto.randomUUID()}`;
        const createdAtEpochMs = validEpoch(raw?.createdAtEpochMs) ? raw.createdAtEpochMs : now;
        const marker = terminalFrom({
          id, slug: normalizedSlug, version: raw?.version === 2 ? 2 : 1,
          source: raw?.source === 'v2' ? 'v2' : 'legacy_v1',
          createdAtEpochMs, updatedAtEpochMs: now,
        }, 'legacy_unknown', now);
        store.put(marker);
        records.push(marker);
        changed = true;
        continue;
      }
      if (isPending(value) && now >= value.expiresAtEpochMs) {
        const marker = terminalFrom(value, 'expired_unverified', now);
        store.put(marker);
        records.push(marker);
        changed = true;
      } else {
        records.push(value);
      }
    }
    await done;
    if (changed) notifyOtherTabs(normalizedSlug);
    return sorted(records);
  } catch (error) {
    if (error instanceof PublicBookingStorageError) throw error;
    throw new PublicBookingStorageError(undefined, { cause: error });
  }
}

export function blockingPublicBookingRecord(records: PublicBookingRecord[]): PublicBookingRecord | null {
  return sorted(records).find((record) => record.status !== 'closed_absent') ?? null;
}

export async function acquirePublicBookingIntent(
  candidate: NewPublicBookingIntent,
): Promise<AcquirePublicBookingIntentResult> {
  const proof = await verifyPublicBookingIntentV2(
    candidate.idempotencyKey,
    candidate.recoveryId,
    candidate.recoverySecret,
  );
  if (!validSlug(candidate.slug) || !proof
      || proof.deadlineEpochSeconds !== candidate.submitDeadlineEpochSeconds
      || !/^[0-9a-f]{64}$/.test(candidate.requestFingerprint)
      || !validEpoch(candidate.sampledAtEpochMs)
      || !validEpoch(candidate.expiresAtEpochMs)
      || candidate.expiresAtEpochMs <= candidate.sampledAtEpochMs
      || !validEpoch(candidate.settleAfterEpochMs)
      || typeof candidate.ownerId !== 'string' || candidate.ownerId.length === 0) {
    throw new PublicBookingStorageError();
  }

  const now = Date.now();
  const normalizedSlug = storageSlug(candidate.slug);
  const record: V2PendingRecord = {
    id: `v2:${candidate.idempotencyKey}`,
    slug: normalizedSlug,
    version: 2,
    source: 'v2',
    status: 'submitting',
    bookingKind: candidate.bookingKind ?? 'single',
    idempotencyKey: candidate.idempotencyKey,
    recoveryId: candidate.recoveryId,
    recoverySecret: candidate.recoverySecret,
    requestFingerprint: candidate.requestFingerprint,
    sampledAtEpochMs: candidate.sampledAtEpochMs,
    expiresAtEpochMs: candidate.expiresAtEpochMs,
    submitDeadlineEpochSeconds: candidate.submitDeadlineEpochSeconds,
    settleAfterEpochMs: candidate.settleAfterEpochMs,
    ownerId: candidate.ownerId,
    createdAtEpochMs: now,
    updatedAtEpochMs: now,
  };

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const values = await requestResult(store.index(SLUG_INDEX).getAll(normalizedSlug)) as unknown[];
    const candidates: PublicBookingRecord[] = [];
    let changed = false;
    for (const value of values) {
      if (!isStoredRecord(value, normalizedSlug)) {
        const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
        const marker = terminalFrom({
          id: typeof raw?.id === 'string' ? raw.id : `legacy-v1:invalid:${crypto.randomUUID()}`,
          slug: normalizedSlug,
          version: raw?.version === 2 ? 2 : 1,
          source: raw?.source === 'v2' ? 'v2' : 'legacy_v1',
          createdAtEpochMs: validEpoch(raw?.createdAtEpochMs) ? raw.createdAtEpochMs : now,
          updatedAtEpochMs: now,
        }, 'legacy_unknown', now);
        store.put(marker);
        candidates.push(marker);
        changed = true;
        continue;
      }
      if (isPending(value) && now >= value.expiresAtEpochMs) {
        const marker = terminalFrom(value, 'expired_unverified', now);
        store.put(marker);
        candidates.push(marker);
        changed = true;
      } else {
        candidates.push(value);
      }
    }
    const existing = sorted(candidates).find((value) => value.status !== 'closed_absent');
    if (existing) {
      await done;
      if (changed) notifyOtherTabs(normalizedSlug);
      return { created: false, record: existing };
    }
    store.put(record);
    await done;
    notifyOtherTabs(normalizedSlug);
    return { created: true, record };
  } catch (error) {
    throw new PublicBookingStorageError(undefined, { cause: error });
  }
}

export async function markPublicBookingUnresolved(
  id: string,
  ownerId: string,
): Promise<PublicBookingRecord | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const current = await requestResult(store.get(id)) as unknown;
    if (!current || typeof current !== 'object') {
      await done;
      return null;
    }
    const slug = (current as { slug?: unknown }).slug;
    if (typeof slug !== 'string' || !isStoredRecord(current, slug)
        || current.status !== 'submitting' || current.ownerId !== ownerId) {
      await done;
      return isStoredRecord(current, typeof slug === 'string' ? slug : '') ? current : null;
    }
    const next: V2PendingRecord = {
      ...current,
      status: 'unresolved',
      settleAfterEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
    };
    store.put(next);
    await done;
    notifyOtherTabs(next.slug);
    return next;
  } catch {
    throw new PublicBookingStorageError();
  }
}

export async function completePublicBookingIntent(
  id: string,
  expectedStatuses: readonly PendingBookingStatus[],
  resolution: Extract<BookingTerminalStatus, 'committed' | 'exists_nolink' | 'closed_absent'>,
): Promise<{ applied: boolean; record: PublicBookingRecord | null }> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const current = await requestResult(store.get(id)) as unknown;
    const slug = current && typeof current === 'object' ? (current as { slug?: unknown }).slug : null;
    if (typeof slug !== 'string' || !isStoredRecord(current, slug) || !expectedStatuses.includes(current.status as PendingBookingStatus)) {
      await done;
      return { applied: false, record: typeof slug === 'string' && isStoredRecord(current, slug) ? current : null };
    }
    const next = terminalFrom(current, resolution, Date.now());
    store.put(next);
    await done;
    notifyOtherTabs(next.slug);
    return { applied: true, record: next };
  } catch {
    throw new PublicBookingStorageError();
  }
}

export async function dismissPublicBookingRecord(id: string): Promise<boolean> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const current = await requestResult(store.get(id)) as unknown;
    const slug = current && typeof current === 'object' ? (current as { slug?: unknown }).slug : null;
    if (typeof slug !== 'string' || !isStoredRecord(current, slug) || isPending(current)
        || current.source !== 'v2') {
      await done;
      return false;
    }
    store.delete(id);
    await done;
    notifyOtherTabs(slug);
    return true;
  } catch {
    throw new PublicBookingStorageError();
  }
}

export async function forgetLegacyBookingRecord(id: string): Promise<boolean> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const current = await requestResult(store.get(id)) as unknown;
    const slug = current && typeof current === 'object' ? (current as { slug?: unknown }).slug : null;
    if (typeof slug !== 'string' || !isStoredRecord(current, slug) || current.source !== 'legacy_v1') {
      await done;
      return false;
    }
    store.delete(id);
    await done;
    notifyOtherTabs(slug);
    return true;
  } catch {
    throw new PublicBookingStorageError();
  }
}

export function watchPublicBookingRecords(slug: string, listener: () => void): () => void {
  const normalizedSlug = validSlug(slug) ? storageSlug(slug) : slug;
  let channel: BroadcastChannel | null = null;
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  const onMessage = (event: MessageEvent) => {
    if (event.data && typeof event.data === 'object' && event.data.slug === normalizedSlug) listener();
  };
  const onVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') listener();
  };
  try { channel?.addEventListener('message', onMessage); } catch { channel = null; }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', listener);
    window.addEventListener('pageshow', listener);
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    try {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
    } catch {
      // Optional cross-tab notification cleanup cannot affect persisted state.
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', listener);
      window.removeEventListener('pageshow', listener);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}
