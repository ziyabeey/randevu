import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeBookingPageCursor, decodeBookingPageCursor, bookingPageResult,
  BOOKING_CURSOR_RESTART_REQUIRED } from '../worker/pagination.ts';

// Agent-authored development validation. Behavioral expectations come from
// pinned S07-C2 and F13-02 documents; these are not independent relation labels.
// r/s/e are wire-schema characterization from the existing helper type, not a
// claim that the product documents prescribe those abbreviated field names.
const first = { at: '2028-02-29T09:00:00.000Z', id: '81000000-0000-4000-8000-000000000001',
  revision: '82000000-0000-4000-8000-000000000001', rangeStart: '2028-02-29', rangeEnd: '2028-03-01' };
const second = { ...first, at: '2028-02-29T10:00:00.000Z', id: '81000000-0000-4000-8000-000000000002' };
const third = { ...first, at: '2028-02-29T11:00:00.000Z', id: '81000000-0000-4000-8000-000000000003' };
const wire = (record) => Buffer.from(JSON.stringify(record)).toString('base64url');
const envelope = { v: 3, k: 'bookings', at: first.at, id: first.id,
  r: first.revision, s: first.rangeStart, e: first.rangeEnd };

test('V01 bounded cursor preserves the leap-day range and revision', () => {
  // Standard JSON/base64 primitives inspect encoding without using the target
  // decoder as the encoder's sole oracle. Decoder input is separately built.
  assert.deepEqual(JSON.parse(Buffer.from(encodeBookingPageCursor(first), 'base64url').toString()), envelope);
  assert.deepEqual(decodeBookingPageCursor(wire(envelope)), first);
});

test('V02 unbounded compatibility preserves both null range endpoints', () => {
  const expected = { ...first, rangeStart: null, rangeEnd: null };
  const input = { ...envelope, s: null, e: null };
  assert.deepEqual(decodeBookingPageCursor(wire(input)), expected);
  assert.deepEqual(JSON.parse(Buffer.from(encodeBookingPageCursor(expected), 'base64url').toString()), input);
  assert.equal(decodeBookingPageCursor(undefined), null);
  assert.equal(decodeBookingPageCursor(''), null);
});

test('V03 legacy booking cursor versions request restart', () => {
  assert.equal(decodeBookingPageCursor(wire({ v: 1, k: 'bookings', at: first.at, id: first.id })), BOOKING_CURSOR_RESTART_REQUIRED);
  assert.equal(decodeBookingPageCursor(wire({ v: 2, k: 'bookings', at: first.at, id: first.id, r: first.revision })), BOOKING_CURSOR_RESTART_REQUIRED);
});

test('V04 date ranges require two valid ordered calendar dates', () => {
  for (const [s, e] of [[null, '2028-03-01'], ['2028-02-29', null], ['2028-03-01', '2028-02-29'],
    ['2028-02-29', '2028-02-29'], ['2027-02-29', '2027-03-01']]) {
    assert.equal(decodeBookingPageCursor(wire({ ...envelope, s, e })), undefined, `${s} to ${e}`);
  }
});

test('V05 continuation uses the last visible row and excludes the probe row', () => {
  const result = bookingPageResult([first, second, third], 2, (row) => row);
  assert.deepEqual(result.items, [first, second]);
  assert.equal(result.page.limit, 2);
  assert.equal(result.page.hasMore, true);
  assert.deepEqual(decodeBookingPageCursor(result.page.nextCursor), second);
  assert.deepEqual(JSON.parse(Buffer.from(result.page.nextCursor, 'base64url').toString()),
    { ...envelope, at: second.at, id: second.id });
});

test('V06 empty short and exact-limit final pages have no continuation', () => {
  for (const rows of [[], [first], [first, second]]) {
    const result = bookingPageResult(rows, 2, () => { throw Error('final page must not request a cursor'); });
    assert.deepEqual(result.items, rows);
    assert.deepEqual(result.page, { limit: 2, hasMore: false, nextCursor: null });
  }
});

test('V07 multi-page traversal preserves the fixed record sequence and range', () => {
  const rows = Object.freeze([Object.freeze({ ...first }), Object.freeze({ ...second }), Object.freeze({ ...third })]);
  const before = structuredClone(rows), visited = [];
  for (let index = 0; index < rows.length; index += 2) {
    const result = bookingPageResult(rows.slice(index, index + 3), 2, (row) => row);
    visited.push(...result.items);
    if (result.page.hasMore) {
      const cursor = decodeBookingPageCursor(result.page.nextCursor);
      assert.equal(cursor.id, second.id);
      assert.equal(cursor.revision, first.revision);
      assert.equal(cursor.rangeStart, '2028-02-29');
      assert.equal(cursor.rangeEnd, '2028-03-01');
    }
  }
  assert.deepEqual(visited, before);
  assert.deepEqual(rows, before);
});
