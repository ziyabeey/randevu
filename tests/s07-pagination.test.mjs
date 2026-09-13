import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodePageCursor,
  encodePageCursor,
  pageResult,
  parsePageLimit,
} from '../worker/pagination.ts';

const ID1 = '81000000-0000-4000-8000-000000000001';
const ID2 = '81000000-0000-4000-8000-000000000002';
const AT1 = '2027-01-15T09:00:00.000Z';
const AT2 = '2027-01-15T09:05:00.000Z';

test('S07 pagination enforces K03 default 25 and max 100', () => {
  assert.equal(parsePageLimit(undefined), 25);
  assert.equal(parsePageLimit(''), 25);
  assert.equal(parsePageLimit('1'), 1);
  assert.equal(parsePageLimit('25'), 25);
  assert.equal(parsePageLimit('100'), 100);
  for (const invalid of ['0', '101', '-1', '1.5', 'abc', '0000', '1000']) {
    assert.equal(parsePageLimit(invalid), null, invalid);
  }
});

test('S07 opaque cursors are versioned, scoped by endpoint and round-trip stable keys', () => {
  const encoded = encodePageCursor('bookings', { at: AT1, id: ID1 });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePageCursor(encoded, 'bookings'), { at: AT1, id: ID1 });
  assert.equal(decodePageCursor(encoded, 'events'), undefined, 'cursor cannot cross endpoint kinds');
  assert.equal(decodePageCursor(undefined, 'bookings'), null);
  assert.equal(decodePageCursor('', 'bookings'), null);
});

test('S07 malformed or semantically invalid cursors fail closed', () => {
  for (const cursor of ['***', 'e30', 'a'.repeat(513)]) {
    assert.equal(decodePageCursor(cursor, 'bookings'), undefined, cursor.slice(0, 20));
  }

  const wrongVersion = btoa(JSON.stringify({ v: 2, k: 'bookings', at: AT1, id: ID1 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const badTime = btoa(JSON.stringify({ v: 1, k: 'bookings', at: 'not-a-time', id: ID1 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const badId = btoa(JSON.stringify({ v: 1, k: 'bookings', at: AT1, id: 'nope' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  assert.equal(decodePageCursor(wrongVersion, 'bookings'), undefined);
  assert.equal(decodePageCursor(badTime, 'bookings'), undefined);
  assert.equal(decodePageCursor(badId, 'bookings'), undefined);
});

test('S07 limit+1 response exposes continuation without silently returning the probe row', () => {
  const rows = [
    { id: ID1, starts_at: AT1 },
    { id: ID2, starts_at: AT2 },
  ];
  const result = pageResult(rows, 1, 'bookings', (row) => ({ at: row.starts_at, id: row.id }));
  assert.deepEqual(result.items, [rows[0]]);
  assert.equal(result.page.limit, 1);
  assert.equal(result.page.hasMore, true);
  assert.ok(result.page.nextCursor);
  assert.deepEqual(decodePageCursor(result.page.nextCursor, 'bookings'), { at: AT1, id: ID1 });
});

test('S07 final page has no continuation cursor', () => {
  const rows = [{ id: ID1, created_at: AT1 }];
  const result = pageResult(rows, 25, 'events', (row) => ({ at: row.created_at, id: row.id }));
  assert.deepEqual(result.items, rows);
  assert.deepEqual(result.page, { limit: 25, hasMore: false, nextCursor: null });
});
