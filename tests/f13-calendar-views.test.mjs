import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const calendar = await readFile(new URL('../src/CalendarPage.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/calendar.css', import.meta.url), 'utf8');
const bookings = await readFile(new URL('../worker/bookings.ts', import.meta.url), 'utf8');
const pagination = await readFile(new URL('../worker/pagination.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260921013000_f13_booking_date_range.sql', import.meta.url), 'utf8');
const browser = await readFile(new URL('../scripts/browser-f11-group-consumers.mjs', import.meta.url), 'utf8');

test('F13-02 calendar exposes day week list, direct date and explicit list range controls', () => {
  assert.match(calendar, /type ViewMode = 'day' \| 'week' \| 'list'/);
  assert.match(calendar, /className="calendar-date-filter"/);
  assert.match(calendar, />Liste<\/button>/);
  assert.match(calendar, /calendar-range-toggle/);
  assert.match(calendar, />1 gün<\/button>/);
  assert.match(calendar, />7 gün<\/button>/);
  assert.match(calendar, /calendar-list-view/);
  assert.match(calendar, /new Map<string, CalendarAppointment\[\]>/);
});

test('F13-02 person identity and status remain separate visual channels with a business-day now line', () => {
  assert.match(calendar, /function staffAccent/);
  assert.match(calendar, /borderLeftColor: staffAccent\(appointment\.staff_id\)/);
  assert.match(calendar, /statusLabel\(root\.group_status\)/);
  assert.match(calendar, /className="calendar-now-line"/);
  assert.match(calendar, /nowParts\.date === \(payload\?\.date \?\? date\)/);
  assert.match(css, /\.calendar-now-line/);
  assert.match(css, /\.status-partial/);
  assert.match(css, /\.calendar-list-staff i/);
});

test('F13-02 booking pagination binds cursor and RPC to one explicit local-date range', () => {
  assert.match(pagination, /v: 3/);
  assert.match(pagination, /rangeStart: string \| null/);
  assert.match(pagination, /rangeEnd: string \| null/);
  assert.match(bookings, /list_appointments_page_v3/);
  assert.match(bookings, /p_start_date: range\.from/);
  assert.match(bookings, /p_end_date: range\.to/);
  assert.match(migration, /p_start_date date default null/);
  assert.match(migration, /p_end_date date default null/);
  assert.match(migration, /a\.starts_at >= v_from and a\.starts_at < v_to/);
  assert.match(migration, /revoke all on function public\.list_appointments_page_v2/);
});

test('F13-02 real Chrome acceptance covers logical list identity and range transitions', () => {
  assert.match(browser, /calendar day\/week\/list share range identity and list keeps native groups atomic/);
  assert.match(browser, /staff columns lost distinct person colors/);
  assert.match(browser, /query\.get\('days'\), '7'/);
});
