import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePublicBookingIntentV2 } from '../shared/public-booking-intent.ts';

class FakeEvents {
  listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }
  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, { type, target: this });
  }
}

class FakeRequest extends FakeEvents {
  result;
  error = null;
}

class FakeTransaction extends FakeEvents {
  error = null;
  pending = 0;
  revision = 0;
  completed = false;
  constructor(factory) {
    super();
    this.factory = factory;
  }
  objectStore() { return new FakeStore(this); }
  request(operation) {
    const request = new FakeRequest();
    this.pending += 1;
    this.revision += 1;
    queueMicrotask(() => {
      try {
        request.result = operation();
        request.emit('success');
      } catch (error) {
        request.error = error;
        this.error = error;
        request.emit('error');
        this.emit('error');
        this.emit('abort');
      } finally {
        this.pending -= 1;
        this.scheduleCompletion();
      }
    });
    return request;
  }
  scheduleCompletion() {
    const revision = this.revision;
    queueMicrotask(() => {
      if (!this.completed && !this.error && this.pending === 0 && revision === this.revision) {
        this.completed = true;
        this.emit('complete');
      }
    });
  }
}

class FakeStore {
  indexNames = { contains: () => true };
  constructor(transaction) { this.transaction = transaction; }
  createIndex() { return this; }
  index() {
    return {
      getAll: (slug) => this.transaction.request(() => [...this.transaction.factory.records.values()]
        .filter((record) => record.slug === slug).map((record) => structuredClone(record))),
    };
  }
  get(id) {
    return this.transaction.request(() => {
      const value = this.transaction.factory.records.get(id);
      return value === undefined ? undefined : structuredClone(value);
    });
  }
  put(record) {
    return this.transaction.request(() => {
      this.transaction.factory.records.set(record.id, structuredClone(record));
      return record.id;
    });
  }
  add(record) {
    return this.transaction.request(() => {
      if (this.transaction.factory.records.has(record.id)) throw new Error('ConstraintError');
      this.transaction.factory.records.set(record.id, structuredClone(record));
      return record.id;
    });
  }
  delete(id) {
    return this.transaction.request(() => this.transaction.factory.records.delete(id));
  }
}

class FakeDatabase extends FakeEvents {
  objectStoreNames = { contains: () => this.factory.created };
  constructor(factory) { super(); this.factory = factory; }
  createObjectStore() { this.factory.created = true; return new FakeStore(new FakeTransaction(this.factory)); }
  transaction() { return new FakeTransaction(this.factory); }
  close() {}
}

class FakeIndexedDB {
  records = new Map();
  created = false;
  database = new FakeDatabase(this);
  open() {
    const request = new FakeRequest();
    request.transaction = new FakeTransaction(this);
    queueMicrotask(() => {
      request.result = this.database;
      if (!this.created) request.emit('upgradeneeded');
      request.emit('success');
    });
    return request;
  }
}

class FakeSessionStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const fakeIndexedDB = new FakeIndexedDB();
const fakeSessionStorage = new FakeSessionStorage();
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fakeIndexedDB });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: fakeSessionStorage });

const pending = await import('../src/public-booking-pending.ts');

let intentSequence = 0;
async function candidate(slug, now = Date.now()) {
  intentSequence += 1;
  const suffix = String(intentSequence).padStart(12, '0');
  const recoveryId = `8c000000-0000-4000-8000-${suffix}`;
  const recoverySecret = 'A'.repeat(43);
  const submitDeadlineEpochSeconds = Math.floor(now / 1000) + 300;
  const intent = await derivePublicBookingIntentV2(recoveryId, submitDeadlineEpochSeconds, recoverySecret);
  assert.ok(intent);
  return {
    slug,
    idempotencyKey: intent.idempotencyKey,
    recoveryId,
    recoverySecret,
    requestFingerprint: 'f'.repeat(64),
    sampledAtEpochMs: now,
    expiresAtEpochMs: now + pending.PUBLIC_BOOKING_RECOVERY_TTL_MS,
    submitDeadlineEpochSeconds,
    settleAfterEpochMs: now + pending.PUBLIC_BOOKING_SETTLE_MS,
    ownerId: `owner-${intentSequence}`,
  };
}

await test('S07 pending: per-slug acquire, owner transition and terminal replacement use exact intent CAS', async () => {
  const firstCandidate = await candidate('Case-Salon');
  const first = await pending.acquirePublicBookingIntent(firstCandidate);
  assert.equal(first.created, true);
  assert.equal(first.record.slug, 'case-salon');

  const competing = await pending.acquirePublicBookingIntent(await candidate('case-salon'));
  assert.equal(competing.created, false);
  assert.equal(competing.record.id, first.record.id);

  const wrongOwner = await pending.markPublicBookingUnresolved(first.record.id, 'another-owner');
  assert.equal(wrongOwner.status, 'submitting');
  const unresolved = await pending.markPublicBookingUnresolved(first.record.id, first.record.ownerId);
  assert.equal(unresolved.status, 'unresolved');
  const terminal = await pending.completePublicBookingIntent(first.record.id, ['unresolved'], 'closed_absent');
  assert.equal(terminal.applied, true);
  assert.equal('recoverySecret' in terminal.record, false);

  const next = await pending.acquirePublicBookingIntent(await candidate('CASE-SALON'));
  assert.equal(next.created, true, 'closed_absent only permits a new key after this explicit acquire');
  const late = await pending.completePublicBookingIntent(first.record.id, ['unresolved'], 'committed');
  assert.equal(late.applied, false);
  assert.equal((await pending.loadPublicBookingRecords('case-salon')).find((record) => record.id === next.record.id).status, 'submitting');
  assert.equal(await pending.dismissPublicBookingRecord(next.record.id), false, 'ordinary v2 pending cannot be forgotten');
});

await test('S07 pending: legacy import is case-scoped, proof-preserving and cannot resurrect after receipt CAS', async () => {
  const now = Date.now();
  const legacy = {
    slug: 'Legacy-Salon',
    idempotencyKey: 'pub-legacy-command-0001',
    recoveryId: '8c000000-0000-4000-8000-000000000111',
    recoverySecret: 'B'.repeat(43),
    requestFingerprint: 'a'.repeat(64),
    createdAt: new Date(now).toISOString(),
  };
  const raw = JSON.stringify(legacy);
  fakeSessionStorage.setItem('yzt-public-booking-pending-v1:Legacy-Salon', raw);
  let records = await pending.loadPublicBookingRecords('legacy-salon');
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'legacy_pending');
  assert.equal(records[0].recoverySecret, legacy.recoverySecret);
  assert.equal(fakeSessionStorage.length, 0);

  const completed = await pending.completePublicBookingIntent(records[0].id, ['legacy_pending'], 'committed');
  assert.equal(completed.applied, true);
  fakeSessionStorage.setItem('yzt-public-booking-pending-v1:LEGACY-SALON', raw);
  records = await pending.loadPublicBookingRecords('Legacy-Salon');
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'committed');
  assert.equal('recoverySecret' in records[0], false, 'reimport cannot overwrite a proofless receipt');
  assert.equal(await pending.dismissPublicBookingRecord(records[0].id), false, 'generic receipt removal stays v2-only');
  assert.equal(await pending.forgetLegacyBookingRecord(records[0].id), true);
});

await test('S07 pending: expiry and corrupt slug records become blocking proofless markers', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const expiring = await pending.acquirePublicBookingIntent(await candidate('expiry-salon', now));
  assert.equal(expiring.created, true);
  now += pending.PUBLIC_BOOKING_RECOVERY_TTL_MS + 1;
  const expired = pending.blockingPublicBookingRecord(await pending.loadPublicBookingRecords('EXPIRY-SALON'));
  assert.equal(expired.status, 'expired_unverified');
  assert.equal('recoverySecret' in expired, false);

  fakeIndexedDB.records.set('corrupt-row', {
    id: 'corrupt-row', slug: 'corrupt-salon', version: 2, source: 'v2', status: 'submitting',
    createdAtEpochMs: now, updatedAtEpochMs: now,
  });
  const blocked = await pending.acquirePublicBookingIntent(await candidate('CORRUPT-SALON', now));
  assert.equal(blocked.created, false);
  assert.equal(blocked.record.status, 'legacy_unknown');
  assert.equal('recoverySecret' in blocked.record, false);
});
