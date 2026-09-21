import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Actual /calendar, /bookings and /customers React consumers in Chrome. API is
// deterministic, but identity, grouping, paging and mutation decisions are the
// production components. The native reservation spans two different staff so
// the staff-filter case proves the drawer is group-complete, not line-filtered.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f1103-consumers-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TZ = 'Europe/Istanbul';
const BUSINESS_ID = '22000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '32000000-0000-4000-8000-000000000001';
const USER_ID = '12000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '72000000-0000-4000-8000-000000000001';
const NATIVE_GROUP = '62000000-0000-4000-8000-000000000001';
const LINE_1 = '82000000-0000-4000-8000-000000000001';
const LINE_2 = '82000000-0000-4000-8000-000000000002';
const LEGACY = '82000000-0000-4000-8000-000000000003';
const SERVICE_1 = '83000000-0000-4000-8000-000000000001';
const SERVICE_2 = '83000000-0000-4000-8000-000000000002';
const STAFF_1 = '84000000-0000-4000-8000-000000000001';
const STAFF_2 = '84000000-0000-4000-8000-000000000002';
const CSRF = 'R'.repeat(43);

function addDateDays(value, amount) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

async function waitFor(read, message, timeoutMs = 7_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(50);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

function serviceLine(id, lineOrdinal, serviceId, serviceName, staffId, staffName, startsAt, endsAt, priceMinor) {
  return {
    appointmentId: id, lineOrdinal, serviceId, serviceName, staffId, staffName,
    status: 'scheduled', startsAt, endsAt,
    occupiedStartsAt: startsAt, occupiedEndsAt: endsAt,
    processingCapacityPolicy: 'HOLD', passiveWaitMinutes: 0, processingPolicyVersion: 1,
    priceType: 'fixed', priceMinMinor: priceMinor, priceMaxMinor: priceMinor,
    priceMinor, currency: 'TRY', pricePolicyVersion: 1,
  };
}

const nativeLines = [
  serviceLine(LINE_1, 1, SERVICE_1, 'Renk', STAFF_1, 'Ada', '2026-09-24T07:00:00.000Z', '2026-09-24T08:00:00.000Z', 20000),
  serviceLine(LINE_2, 2, SERVICE_2, 'Kesim', STAFF_2, 'Bora', '2026-09-24T08:00:00.000Z', '2026-09-24T08:30:00.000Z', 12000),
];
const legacyLine = serviceLine(LEGACY, 1, SERVICE_2, 'Kesim', STAFF_1, 'Ada', '2026-09-24T10:00:00.000Z', '2026-09-24T10:30:00.000Z', 12000);

function nativeBooking() {
  return {
    groupId: NATIVE_GROUP, status: 'scheduled', source: 'operator', version: 7,
    customerId: CUSTOMER_ID, startsAt: nativeLines[0].startsAt, endsAt: nativeLines[1].endsAt,
    timezone: TZ, currency: 'TRY', estimateMinMinor: 32000, estimateMaxMinor: 32000,
    lines: nativeLines, legacyAppointmentId: null, managementMode: 'group', lineCount: 2,
    canRescheduleGroup: true, canCancelGroup: true,
    customerName: 'Native Customer', customerPhone: '05550000001',
    customerEmail: 'native@example.test', notes: 'native note',
  };
}
function legacyBooking() {
  return {
    groupId: LEGACY, status: 'scheduled', source: 'operator', version: 1,
    customerId: CUSTOMER_ID, startsAt: legacyLine.startsAt, endsAt: legacyLine.endsAt,
    timezone: TZ, currency: 'TRY', estimateMinMinor: 12000, estimateMaxMinor: 12000,
    lines: [legacyLine], legacyAppointmentId: LEGACY, managementMode: 'legacy_single', lineCount: 1,
    canRescheduleGroup: true, canCancelGroup: true,
    customerName: 'Legacy Customer', customerPhone: '05550000001',
    customerEmail: 'legacy@example.test', notes: null,
  };
}
function calendarRow(line, booking, customerName) {
  return {
    appointment_id: line.appointmentId, group_id: booking.groupId, line_ordinal: line.lineOrdinal,
    group_status: booking.status, group_version: booking.version,
    group_legacy_appointment_id: booking.legacyAppointmentId, group_line_count: booking.lineCount,
    group_starts_at: booking.startsAt, group_ends_at: booking.endsAt,
    staff_id: line.staffId, status: line.status, starts_at: line.startsAt, ends_at: line.endsAt,
    timezone: TZ, customer_name: customerName, customer_phone: booking.customerPhone,
    customer_email: booking.customerEmail, service_name: line.serviceName, staff_name: line.staffName,
    price_minor: line.priceMinor, currency: 'TRY', notes: booking.notes,
    cancellation_reason: null, source: 'operator',
  };
}

const membership = {
  id: MEMBERSHIP_ID, business_id: BUSINESS_ID, role: 'owner', active: true,
  businesses: { id: BUSINESS_ID, name: 'F11-03 Salon', slug: 'f1103-salon', timezone: TZ },
};
const fixture = { requests: [] };
const sockets = new Set();
let testJs;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}
function record(request, url, body) {
  fixture.requests.push({ method: request.method, path: url.pathname, search: url.search, body,
    idempotencyKey: request.headers['idempotency-key'] ?? null });
}
function requestsTo(pathname) {
  return fixture.requests.filter((item) => item.path === pathname);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(testJs);
      return;
    }
    if (['/calendar', '/bookings', '/customers'].includes(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/test.js"></script>');
      return;
    }

    const body = ['POST', 'PATCH'].includes(request.method ?? '') ? await readJson(request) : null;
    record(request, url, body);

    if (url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: CSRF });
    if (url.pathname === '/api/session') return sendJson(response, 200, {
      user: { id: USER_ID, email: 'owner@example.test', fullName: 'Owner' }, memberships: [membership],
      activeBusinessId: BUSINESS_ID, passwordRecovery: false, csrfToken: CSRF,
    });
    if (url.pathname === '/api/catalog') return sendJson(response, 200, {
      membership,
      services: [
        { id: SERVICE_1, name: 'Renk', duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 20000, currency: 'TRY', active: true, price_type: 'fixed', price_min_minor: 20000, price_max_minor: 20000, price_policy_version: 1 },
        { id: SERVICE_2, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 12000, currency: 'TRY', active: true, price_type: 'fixed', price_min_minor: 12000, price_max_minor: 12000, price_policy_version: 1 },
      ],
      staff: [{ id: STAFF_1, name: 'Ada', active: true }, { id: STAFF_2, name: 'Bora', active: true }],
      assignments: [
        { staff_id: STAFF_1, service_id: SERVICE_1, active: true }, { staff_id: STAFF_1, service_id: SERVICE_2, active: true },
        { staff_id: STAFF_2, service_id: SERVICE_1, active: true }, { staff_id: STAFF_2, service_id: SERVICE_2, active: true },
      ],
    });
    if (url.pathname === '/api/availability/setup') return sendJson(response, 200, { timezone: TZ });
    if (url.pathname === '/api/availability/group-slots' && request.method === 'POST') {
      return sendJson(response, 200, { slots: [{
        starts_at: '2026-09-24T12:00:00.000Z',
        ends_at: '2026-09-24T13:30:00.000Z',
        timezone: TZ,
        total_duration_minutes: 90,
        lines: [],
      }] });
    }
    if (url.pathname === '/api/availability/blocks' && request.method === 'POST') {
      return sendJson(response, 201, { block: {
        id: '88000000-0000-4000-8000-000000000001',
        staff_id: body?.staffId ?? null,
        starts_at: `${body?.date}T${body?.start}:00+03:00`,
        ends_at: `${body?.date}T${body?.end}:00+03:00`,
        reason: body?.reason ?? null,
        active: true,
      } });
    }
    if (url.pathname === '/api/bookings/groups' && request.method === 'POST') {
      return sendJson(response, 201, { group: {
        ...nativeBooking(),
        groupId: '62000000-0000-4000-8000-000000000099',
        customerName: body?.customerName ?? 'Created Customer',
        startsAt: body?.startsAt,
        version: 1,
      } });
    }
    if (url.pathname === '/api/bookings/groups' && request.method === 'GET') return sendJson(response, 200, {
      membership, bookings: [nativeBooking(), legacyBooking()], page: { limit: 25, hasMore: false, nextCursor: null },
    });
    if (url.pathname === `/api/bookings/groups/${NATIVE_GROUP}` && request.method === 'GET') {
      return sendJson(response, 200, { group: nativeBooking() });
    }
    if (url.pathname === '/api/calendar') {
      const native = nativeBooking();
      const legacy = legacyBooking();
      const allRows = [
        ...native.lines.map((line) => calendarRow(line, native, 'Native Customer')),
        calendarRow(legacy.lines[0], legacy, 'Legacy Customer'),
      ];
      const staff = url.searchParams.get('staffId');
      const requestedDate = url.searchParams.get('date') ?? '2026-09-24';
      const requestedDays = Number(url.searchParams.get('days') ?? '1');
      const rangeEnd = addDateDays(requestedDate, requestedDays);
      const rangedRows = allRows.filter((row) => {
        const rowDate = row.starts_at.slice(0, 10);
        return rowDate >= requestedDate && rowDate < rangeEnd;
      });
      return sendJson(response, 200, {
        membership, business: membership.businesses, localDate: '2026-09-24', date: requestedDate, days: requestedDays,
        staff: [{ id: STAFF_1, name: 'Ada', active: true }, { id: STAFF_2, name: 'Bora', active: true }],
        appointments: staff ? rangedRows.filter((row) => row.staff_id === staff) : rangedRows,
      });
    }
    if (url.pathname === '/api/customers' && request.method === 'GET') return sendJson(response, 200, {
      membership,
      customers: [{ customer_id: CUSTOMER_ID, name: 'History Customer', phone: '05550000001', email: 'history@example.test', notes: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' }],
      page: { limit: 25, hasMore: false, nextCursor: null },
    });
    if (url.pathname === `/api/customers/${CUSTOMER_ID}/group-history`) {
      if (url.searchParams.get('cursor')) {
        const legacy = legacyBooking(); legacy.customerName = 'History Customer';
        return sendJson(response, 200, { bookings: [legacy], page: { limit: 25, hasMore: false, nextCursor: null } });
      }
      const native = nativeBooking(); native.customerName = 'History Customer';
      return sendJson(response, 200, { bookings: [native], page: { limit: 25, hasMore: true, nextCursor: 'logical-page-2' } });
    }
    if (url.pathname === `/api/bookings/groups/${NATIVE_GROUP}/status` && request.method === 'POST') {
      return sendJson(response, 200, { group: { ...nativeBooking(), version: 8, status: body?.status ?? 'confirmed' } });
    }
    if (url.pathname === `/api/bookings/groups/${NATIVE_GROUP}/cancel` && request.method === 'POST') {
      return sendJson(response, 200, { group: { ...nativeBooking(), version: 8, status: 'cancelled' } });
    }
    if (url.pathname === `/api/bookings/groups/${NATIVE_GROUP}/lines/${LINE_1}/cancel` && request.method === 'POST') {
      return sendJson(response, 200, { group: { ...nativeBooking(), version: 8 } });
    }
    if (url.pathname === `/api/bookings/${LEGACY}/status` && request.method === 'POST') {
      return sendJson(response, 200, { appointment: { id: LEGACY, status: body?.status ?? 'confirmed' } });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `unmapped fixture route: ${url.pathname}` } });
  } catch (error) {
    sendJson(response, 500, { error: { code: 'FIXTURE_ERROR', message: String(error) } });
  }
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

class Cdp {
  static async connect(url) {
    const client = new Cdp(url);
    await Promise.race([
      new Promise((resolve, reject) => {
        client.ws.addEventListener('open', resolve, { once: true });
        client.ws.addEventListener('error', () => reject(new Error('CDP WebSocket failed')), { once: true });
      }),
      sleep(5_000).then(() => { throw new Error('CDP WebSocket timed out'); }),
    ]);
    return client;
  }
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 1; this.pending = new Map(); this.diagnostics = [];
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params?.exceptionDetails;
          this.diagnostics.push(String(details?.exception?.description ?? details?.text ?? 'browser exception').slice(0, 2000));
        }
        return;
      }
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  send(method, params = {}, timeoutMs = 7_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, timeoutMs = 7_000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

let chrome; let chromeFd; let page; let chromeStartError;
async function navigate(client, url) {
  await client.evaluate('delete document.documentElement.dataset.f1103ConsumerReady');
  await client.send('Page.navigate', { url });
  await waitFor(() => client.evaluate(`${JSON.stringify(url)} === location.href && document.documentElement.dataset.f1103ConsumerReady === "true"`, 500), `page did not load ${url}`);
}
async function openPage(debugUrl, url) {
  const target = await (await fetch(`${debugUrl}/json/new?about%3Ablank`, { method: 'PUT', signal: AbortSignal.timeout(5000) })).json();
  const client = await Cdp.connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable'); await client.send('Page.enable'); await navigate(client, url); return client;
}
async function call(client, method, ...args) {
  return client.evaluate(`window.__f1103c[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 15_000);
}
async function uiContains(client, text, timeoutMs = 7_000) {
  return waitFor(async () => (await call(client, 'text')).includes(text), `UI did not show ${text}`, timeoutMs);
}
function passed(name) { console.log(`F11-03 consumer browser passed: ${name}`); }

try {
  await build({ configFile: false, root, publicDir: false, logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { outDir: bundleDir, emptyOutDir: true, minify: false,
      lib: { entry: path.join(root, 'tests/browser/f11-group-consumers.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js' } } } });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const chromeBin = process.env.CHROME_BIN; assert.ok(chromeBin, 'CHROME_BIN is required');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${path.join(work, 'profile')}`, 'about:blank'],
  { stdio: ['ignore', chromeFd, chromeFd] });
  chrome.once('error', (error) => { chromeStartError = error; });
  const activePort = path.join(work, 'profile', 'DevToolsActivePort');
  const port = await waitFor(() => {
    if (chromeStartError) throw chromeStartError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}`);
    try { const first = readFileSync(activePort, 'utf8').split(/\r?\n/)[0]; return /^\d+$/.test(first) && first; } catch { return false; }
  }, 'Chrome did not expose a debugging port', 10_000);
  const debugUrl = `http://127.0.0.1:${port}`;

  page = await openPage(debugUrl, `${origin}/calendar`);
  await uiContains(page, 'Native Customer');
  assert.equal(await call(page, 'calendarReservationCount'), '2');
  assert.equal(await call(page, 'calendarEventCount'), 3, 'line geometry was lost');
  const staffColors = await call(page, 'calendarStaffColors');
  assert.equal(staffColors.length, 2);
  assert.equal(new Set(staffColors).size, 2, 'staff columns lost distinct person colors');

  assert.equal(await call(page, 'click', 'Liste'), true);
  await waitFor(() => {
    const request = requestsTo('/api/calendar').at(-1);
    if (!request) return false;
    const params = new URLSearchParams(request.search);
    return params.get('date') === '2026-09-24' && params.get('days') === '1';
  }, 'one-day list did not request the selected business-local range');
  await waitFor(async () => (await call(page, 'calendarListRows')).length === 2, 'one-day list did not collapse physical lines into logical reservations');
  let listRows = await call(page, 'calendarListRows');
  assert.equal(listRows.length, 2);
  const nativeList = listRows.find((row) => row.includes('Native Customer'));
  assert.ok(nativeList?.includes('Renk + Kesim') && nativeList.includes('Ada') && nativeList.includes('Bora') && nativeList.includes('Planlandı'));
  let calendarRequest = requestsTo('/api/calendar').at(-1);
  let calendarQuery = new URLSearchParams(calendarRequest.search);
  assert.equal(calendarQuery.get('date'), '2026-09-24');
  assert.equal(calendarQuery.get('days'), '1');

  assert.equal(await call(page, 'click', '7 gün'), true);
  await waitFor(() => {
    const request = requestsTo('/api/calendar').at(-1);
    const query = new URLSearchParams(request.search);
    return query.get('date') === '2026-09-21' && query.get('days') === '7';
  }, 'seven-day list range did not normalize to business week');
  await waitFor(async () => (await call(page, 'calendarListRows')).length === 2, 'seven-day list changed the logical reservation set');

  assert.equal(await call(page, 'click', 'Hafta'), true);
  await waitFor(async () => (await call(page, 'calendarEventCount')) === 3, 'week view did not preserve physical line geometry');
  const weekRows = await call(page, 'calendarWeekRows');
  assert.equal(weekRows.length, 3);
  assert.ok(weekRows.every((row) => row.includes('Planlandı')), 'week status became color-only');
  calendarRequest = requestsTo('/api/calendar').at(-1);
  calendarQuery = new URLSearchParams(calendarRequest.search);
  assert.equal(calendarQuery.get('date'), '2026-09-21');
  assert.equal(calendarQuery.get('days'), '7');

  assert.equal(await call(page, 'click', 'Gün'), true);
  assert.equal(await call(page, 'setCalendarDate', '2026-09-24'), true);
  await waitFor(async () => (await call(page, 'calendarEventCount')) === 3, 'direct date filter did not restore the selected business day');
  assert.equal(await call(page, 'setCalendarDate', '2026-09-25'), true);
  await waitFor(async () => (await call(page, 'calendarEventCount')) === 0, 'direct date filter leaked records from another business day');
  assert.equal(await call(page, 'click', 'Bugün'), true);
  await waitFor(async () => (await call(page, 'calendarEventCount')) === 3, 'Today did not restore the business-local day');

  assert.equal(await call(page, 'click', 'Liste'), true);
  await waitFor(async () => (await call(page, 'calendarListRows')).length === 2, 'list did not restore after Today');
  assert.equal(await call(page, 'clickCalendarEvent', 'Native Customer'), true);
  await waitFor(async () => (await call(page, 'calendarDrawerLines')).length === 2, 'list selection lost canonical group detail');
  passed('calendar day/week/list share range identity and list keeps native groups atomic');

  await navigate(page, `${origin}/calendar`);
  await uiContains(page, 'Native Customer');
  assert.equal(await call(page, 'clickCalendarEvent', 'Native Customer'), true);
  await waitFor(async () => (await call(page, 'calendarDrawerLines')).length === 2, 'unfiltered group drawer was incomplete');
  let drawer = await call(page, 'calendarDrawerLines');
  assert.ok(drawer[0].includes('1. Renk') && drawer[1].includes('2. Kesim'));
  assert.ok(requestsTo(`/api/bookings/groups/${NATIVE_GROUP}`).length >= 1, 'calendar did not resolve canonical group detail');
  assert.equal(await call(page, 'setCalendarReason', 'group reason'), true);
  assert.equal(await call(page, 'click', 'Tüm rezervasyonu iptal et'), true);
  await waitFor(() => requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/cancel`).length === 1, 'calendar did not use group cancel');
  const groupCancel = requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/cancel`)[0];
  assert.equal(groupCancel.body.expectedVersion, 7); assert.equal(groupCancel.body.reason, 'group reason');
  passed('calendar counts logical reservations and mutates the canonical group root');

  await navigate(page, `${origin}/calendar`);
  await uiContains(page, 'Native Customer');
  assert.equal(await call(page, 'selectCalendarStaff', 'Ada'), true);
  await waitFor(async () => (await call(page, 'calendarEventCount')) === 2, 'staff-filtered geometry did not settle');
  assert.equal(await call(page, 'calendarReservationCount'), '2', 'staff filter changed logical reservation count incorrectly');
  assert.equal(await call(page, 'clickCalendarEvent', 'Native Customer'), true);
  await waitFor(async () => (await call(page, 'calendarDrawerLines')).length === 2, 'staff-filtered drawer lost sibling lines');
  drawer = await call(page, 'calendarDrawerLines');
  assert.ok(drawer[0].includes('1. Renk') && drawer[1].includes('2. Kesim'), 'staff filter leaked into group drawer');
  passed('calendar staff filter affects geometry only; drawer remains group-complete');

  await navigate(page, `${origin}/calendar`);
  await uiContains(page, 'Legacy Customer');
  assert.equal(await call(page, 'clickCalendarEvent', 'Legacy Customer'), true);
  await uiContains(page, 'Onayla');
  assert.equal(await call(page, 'click', 'Onayla'), true);
  await waitFor(() => requestsTo(`/api/bookings/${LEGACY}/status`).length === 1, 'legacy status route was not preserved');
  passed('calendar preserves legacy single mutation');

  await navigate(page, `${origin}/bookings`);
  await uiContains(page, 'Native Customer'); await uiContains(page, 'Legacy Customer');
  const top = await call(page, 'topBookings'); assert.equal(top.length, 2, 'physical lines became top-level bookings');
  assert.equal(await call(page, 'bookingLineCount', 'Native Customer'), 2);
  assert.equal(await call(page, 'bookingLineCount', 'Legacy Customer'), 1);
  const nativeButtons = await call(page, 'bookingButtons', 'Native Customer');
  assert.ok(nativeButtons.some((label) => label.includes('Tümünü taşı')) && nativeButtons.some((label) => label.includes('Tümünü iptal et')));
  const legacyButtons = await call(page, 'bookingButtons', 'Legacy Customer');
  assert.ok(legacyButtons.includes('Onayla') && legacyButtons.includes('Geçmiş'));
  assert.equal(await call(page, 'click', 'Satırı iptal et'), true);
  await waitFor(() => requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/lines/${LINE_1}/cancel`).length === 1, 'line cancel did not stay group-rooted');
  assert.equal(requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/lines/${LINE_1}/cancel`)[0].body.expectedVersion, 7);
  passed('booking page renders one group card and group-rooted line actions');

  await navigate(page, `${origin}/customers`);
  await uiContains(page, 'History Customer'); assert.equal(await call(page, 'chooseCustomer', 'History Customer'), true);
  await waitFor(async () => (await call(page, 'historyRows')).length === 1, 'first group-history page did not load');
  let history = await call(page, 'historyRows'); assert.ok(history[0].includes('Renk') && history[0].includes('Kesim'));
  assert.equal(await call(page, 'click', 'Daha eski rezervasyonları göster'), true);
  await waitFor(async () => (await call(page, 'historyRows')).length === 2, 'logical history cursor did not advance');
  history = await call(page, 'historyRows');
  assert.equal(history.filter((row) => row.includes('Renk + Kesim')).length, 1, 'native group split/repeated across pages');
  const historyRequests = requestsTo(`/api/customers/${CUSTOMER_ID}/group-history`);
  assert.equal(new URLSearchParams(historyRequests[1].search).get('cursor'), 'logical-page-2');
  passed('customer history keeps native group atomic across pagination and preserves legacy history');

  await navigate(page, `${origin}/bookings`);
  await uiContains(page, 'Native Customer');
  const groupSlotBefore = requestsTo('/api/availability/group-slots').length;
  const createBefore = requestsTo('/api/bookings/groups').filter((request) => request.method === 'POST').length;
  const blockBefore = requestsTo('/api/availability/blocks').length;
  const statusBefore = requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/status`).length;

  assert.equal(await call(page, 'setComposerField', 'Tarih', '2026-09-24'), true);
  assert.equal(await call(page, 'setComposerField', 'Müşteri', 'F13 Operator'), true);
  assert.equal(await call(page, 'setComposerField', 'Telefon', '05550009999'), true);
  assert.equal(await call(page, 'setBookingDraftSelect', 0, 'Hizmet', 'Renk'), true);
  assert.equal(await call(page, 'setBookingDraftSelect', 0, 'Personel', 'Ada'), true);
  assert.equal(await call(page, 'click', '+ Hizmet ekle'), true);
  await waitFor(async () => (await call(page, 'bookingDraftCount')) === 2, 'second operator service line did not appear');
  assert.equal(await call(page, 'setBookingDraftSelect', 1, 'Hizmet', 'Kesim'), true);
  assert.equal(await call(page, 'setBookingDraftSelect', 1, 'Personel', 'Bora'), true);
  assert.equal(await call(page, 'click', 'Uygun saatleri getir'), true);
  await waitFor(() => requestsTo('/api/availability/group-slots').length === groupSlotBefore + 1, 'operator group-slot request did not fire');
  const groupSlotRequest = requestsTo('/api/availability/group-slots').at(-1);
  assert.equal(groupSlotRequest.body.date, '2026-09-24');
  assert.deepEqual(groupSlotRequest.body.lines, [
    { serviceId: SERVICE_1, staffId: STAFF_1 },
    { serviceId: SERVICE_2, staffId: STAFF_2 },
  ]);
  assert.equal(await call(page, 'click', '2 hizmet'), true);
  assert.equal(await call(page, 'click', 'Randevuyu oluştur'), true);
  await waitFor(() => requestsTo('/api/bookings/groups').filter((request) => request.method === 'POST').length === createBefore + 1, 'operator group create did not fire');
  const createRequest = requestsTo('/api/bookings/groups').filter((request) => request.method === 'POST').at(-1);
  assert.equal(createRequest.body.customerName, 'F13 Operator');
  assert.equal(createRequest.body.startsAt, '2026-09-24T12:00:00.000Z');
  assert.deepEqual(createRequest.body.lines, [
    { serviceId: SERVICE_1, staffId: STAFF_1 },
    { serviceId: SERVICE_2, staffId: STAFF_2 },
  ]);
  assert.ok(typeof createRequest.idempotencyKey === 'string' && createRequest.idempotencyKey.length >= 8);
  passed('operator composer creates a two-service reservation through one atomic group command');

  await waitFor(async () => await call(page, 'click', 'Saat kapat'), 'close-time control did not re-enable after create reload');
  assert.equal(await call(page, 'setCloseField', 'Gün', '2026-09-24'), true);
  assert.equal(await call(page, 'setCloseField', 'Başlangıç', '16:00'), true);
  assert.equal(await call(page, 'setCloseField', 'Bitiş', '17:00'), true);
  assert.equal(await call(page, 'setCloseField', 'Kapsam', 'Tüm salon'), true);
  assert.equal(await call(page, 'setCloseField', 'Neden', 'Toplantı'), true);
  assert.equal(await call(page, 'click', 'Kapanışı kaydet'), true);
  await waitFor(() => requestsTo('/api/availability/blocks').length === blockBefore + 1, 'nearby close-time action did not reach guarded availability block');
  const closeRequest = requestsTo('/api/availability/blocks').at(-1);
  assert.deepEqual(closeRequest.body, {
    date: '2026-09-24', start: '16:00', end: '17:00', staffId: null, reason: 'Toplantı',
  });
  passed('operator composer keeps guarded close-time access next to booking creation');

  await waitFor(async () => await call(page, 'clickBookingButton', 'Native Customer', 'Detay'), 'booking detail control did not re-enable after close-time mutation');
  await waitFor(async () => (await call(page, 'detailText')).includes('Fotoğraf F16-03'), 'detail surface did not expose the future photo connection point');
  const detail = await call(page, 'detailText');
  assert.ok(detail.includes('Adisyon F14') && detail.includes('Renk') && detail.includes('Kesim') && detail.includes('Planlandı'));
  assert.equal(await call(page, 'click', 'Onayla'), true);
  await waitFor(() => requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/status`).length === statusBefore + 1, 'native detail status did not use group lifecycle endpoint');
  const statusRequest = requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/status`).at(-1);
  assert.deepEqual(statusRequest.body, { expectedVersion: 7, status: 'confirmed' });
  assert.ok(typeof statusRequest.idempotencyKey === 'string' && statusRequest.idempotencyKey.length >= 8);
  passed('booking detail exposes truthful future tabs and native CAS lifecycle actions');

  console.log('F11-03/F13-03 browser operator consumer acceptance passed.');
} catch (error) {
  console.error(error);
  if (page?.diagnostics.length) console.error(`browser exceptions:\n${page.diagnostics.join('\n')}`);
  try { console.error(readFileSync(chromeLog, 'utf8').slice(-4000)); } catch { /* noop */ }
  process.exitCode = 1;
} finally {
  page?.close(); for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) { chrome.kill('SIGTERM'); await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(1000)]); if (chrome.exitCode === null) chrome.kill('SIGKILL'); }
  if (chromeFd !== undefined) closeSync(chromeFd); rmSync(work, { recursive: true, force: true });
}
