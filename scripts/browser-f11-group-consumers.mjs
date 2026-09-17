import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F11-03 operator-consumer acceptance in a real browser. These are the actual
// CalendarPage, BookingPage and CustomersPage components that ship at their
// live routes. Only the API is deterministic. One native two-line group and one
// legacy one-line reservation coexist in every projection.

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
const LEGACY_APPOINTMENT = '82000000-0000-4000-8000-000000000003';
const LEGACY_GROUP = LEGACY_APPOINTMENT;
const SERVICE_1 = '83000000-0000-4000-8000-000000000001';
const SERVICE_2 = '83000000-0000-4000-8000-000000000002';
const STAFF_1 = '84000000-0000-4000-8000-000000000001';
const STAFF_2 = '84000000-0000-4000-8000-000000000002';
const CSRF = 'R'.repeat(43);

async function waitFor(read, message, timeoutMs = 5_000) {
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

function line({ id, ordinal, serviceId, serviceName, staffId, staffName, startsAt, endsAt, priceMinor = 12000 }) {
  return {
    appointmentId: id,
    lineOrdinal: ordinal,
    serviceId,
    serviceName,
    staffId,
    staffName,
    status: 'scheduled',
    startsAt,
    endsAt,
    occupiedStartsAt: startsAt,
    occupiedEndsAt: endsAt,
    processingCapacityPolicy: 'HOLD',
    passiveWaitMinutes: 0,
    processingPolicyVersion: 1,
    priceType: 'fixed',
    priceMinMinor: priceMinor,
    priceMaxMinor: priceMinor,
    priceMinor,
    currency: 'TRY',
    pricePolicyVersion: 1,
  };
}

const nativeLines = [
  line({ id: LINE_1, ordinal: 1, serviceId: SERVICE_1, serviceName: 'Renk', staffId: STAFF_1, staffName: 'Ada', startsAt: '2026-09-24T07:00:00.000Z', endsAt: '2026-09-24T08:00:00.000Z', priceMinor: 20000 }),
  line({ id: LINE_2, ordinal: 2, serviceId: SERVICE_2, serviceName: 'Kesim', staffId: STAFF_2, staffName: 'Bora', startsAt: '2026-09-24T08:00:00.000Z', endsAt: '2026-09-24T08:30:00.000Z', priceMinor: 12000 }),
];
const legacyLine = line({ id: LEGACY_APPOINTMENT, ordinal: 1, serviceId: SERVICE_2, serviceName: 'Kesim', staffId: STAFF_1, staffName: 'Ada', startsAt: '2026-09-24T10:00:00.000Z', endsAt: '2026-09-24T10:30:00.000Z', priceMinor: 12000 });

function nativeBooking() {
  return {
    groupId: NATIVE_GROUP,
    status: 'scheduled',
    source: 'operator',
    version: 7,
    customerId: CUSTOMER_ID,
    startsAt: nativeLines[0].startsAt,
    endsAt: nativeLines[1].endsAt,
    timezone: TZ,
    currency: 'TRY',
    estimateMinMinor: 32000,
    estimateMaxMinor: 32000,
    lines: nativeLines,
    legacyAppointmentId: null,
    managementMode: 'group',
    lineCount: 2,
    canRescheduleGroup: true,
    canCancelGroup: true,
    customerName: 'Native Customer',
    customerPhone: '05550000001',
    customerEmail: 'native@example.test',
    notes: 'native note',
  };
}
function legacyBooking() {
  return {
    groupId: LEGACY_GROUP,
    status: 'scheduled',
    source: 'operator',
    version: 1,
    customerId: CUSTOMER_ID,
    startsAt: legacyLine.startsAt,
    endsAt: legacyLine.endsAt,
    timezone: TZ,
    currency: 'TRY',
    estimateMinMinor: 12000,
    estimateMaxMinor: 12000,
    lines: [legacyLine],
    legacyAppointmentId: LEGACY_APPOINTMENT,
    managementMode: 'legacy_single',
    lineCount: 1,
    canRescheduleGroup: true,
    canCancelGroup: true,
    customerName: 'Legacy Customer',
    customerPhone: '05550000001',
    customerEmail: 'legacy@example.test',
    notes: null,
  };
}

function calendarRow(lineValue, booking, customerName) {
  return {
    appointment_id: lineValue.appointmentId,
    group_id: booking.groupId,
    line_ordinal: lineValue.lineOrdinal,
    group_status: booking.status,
    group_version: booking.version,
    group_legacy_appointment_id: booking.legacyAppointmentId,
    group_line_count: booking.lineCount,
    group_starts_at: booking.startsAt,
    group_ends_at: booking.endsAt,
    staff_id: lineValue.staffId,
    status: lineValue.status,
    starts_at: lineValue.startsAt,
    ends_at: lineValue.endsAt,
    timezone: TZ,
    customer_name: customerName,
    customer_phone: booking.customerPhone,
    customer_email: booking.customerEmail,
    service_name: lineValue.serviceName,
    staff_name: lineValue.staffName,
    price_minor: lineValue.priceMinor,
    currency: 'TRY',
    notes: booking.notes,
    cancellation_reason: null,
    source: 'operator',
  };
}

const membership = {
  id: MEMBERSHIP_ID,
  business_id: BUSINESS_ID,
  role: 'owner',
  active: true,
  businesses: { id: BUSINESS_ID, name: 'F11-03 Salon', slug: 'f1103-salon', timezone: TZ },
};
const fixture = { requests: [] };
const sockets = new Set();
let testJs;
let origin;

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
  fixture.requests.push({
    method: request.method,
    path: url.pathname,
    search: url.search,
    body,
    idempotencyKey: request.headers['idempotency-key'] ?? null,
  });
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
    if (url.pathname === '/calendar' || url.pathname === '/bookings' || url.pathname === '/customers') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/test.js"></script>');
      return;
    }

    const body = request.method === 'POST' || request.method === 'PATCH' ? await readJson(request) : null;
    record(request, url, body);

    if (url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: CSRF });
    if (url.pathname === '/api/session') {
      return sendJson(response, 200, {
        user: { id: USER_ID, email: 'owner@example.test', fullName: 'Owner' },
        memberships: [membership],
        activeBusinessId: BUSINESS_ID,
        passwordRecovery: false,
        csrfToken: CSRF,
      });
    }
    if (url.pathname === '/api/catalog') {
      return sendJson(response, 200, {
        membership,
        services: [
          { id: SERVICE_1, name: 'Renk', duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 20000, currency: 'TRY', active: true, price_type: 'fixed', price_min_minor: 20000, price_max_minor: 20000, price_policy_version: 1 },
          { id: SERVICE_2, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 12000, currency: 'TRY', active: true, price_type: 'fixed', price_min_minor: 12000, price_max_minor: 12000, price_policy_version: 1 },
        ],
        staff: [{ id: STAFF_1, name: 'Ada', active: true }, { id: STAFF_2, name: 'Bora', active: true }],
        assignments: [
          { staff_id: STAFF_1, service_id: SERVICE_1, active: true },
          { staff_id: STAFF_1, service_id: SERVICE_2, active: true },
          { staff_id: STAFF_2, service_id: SERVICE_1, active: true },
          { staff_id: STAFF_2, service_id: SERVICE_2, active: true },
        ],
      });
    }
    if (url.pathname === '/api/availability/setup') return sendJson(response, 200, { timezone: TZ });
    if (url.pathname === '/api/bookings/groups' && request.method === 'GET') {
      return sendJson(response, 200, {
        membership,
        bookings: [nativeBooking(), legacyBooking()],
        page: { limit: 25, hasMore: false, nextCursor: null },
      });
    }
    if (url.pathname === '/api/calendar') {
      const native = nativeBooking();
      const legacy = legacyBooking();
      return sendJson(response, 200, {
        membership,
        business: membership.businesses,
        localDate: '2026-09-24',
        date: '2026-09-24',
        days: 1,
        staff: [{ id: STAFF_1, name: 'Ada', active: true }, { id: STAFF_2, name: 'Bora', active: true }],
        appointments: [
          ...native.lines.map((item) => calendarRow(item, native, 'Native Customer')),
          calendarRow(legacy.lines[0], legacy, 'Legacy Customer'),
        ],
      });
    }
    if (url.pathname === '/api/customers' && request.method === 'GET') {
      return sendJson(response, 200, {
        membership,
        customers: [{ customer_id: CUSTOMER_ID, name: 'History Customer', phone: '05550000001', email: 'history@example.test', notes: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' }],
        page: { limit: 25, hasMore: false, nextCursor: null },
      });
    }
    if (url.pathname === `/api/customers/${CUSTOMER_ID}/group-history`) {
      if (url.searchParams.get('cursor')) {
        const legacy = legacyBooking();
        legacy.customerName = 'History Customer';
        return sendJson(response, 200, { bookings: [legacy], page: { limit: 25, hasMore: false, nextCursor: null } });
      }
      const native = nativeBooking();
      native.customerName = 'History Customer';
      return sendJson(response, 200, { bookings: [native], page: { limit: 25, hasMore: true, nextCursor: 'logical-page-2' } });
    }

    if (url.pathname === `/api/bookings/groups/${NATIVE_GROUP}/cancel` && request.method === 'POST') {
      return sendJson(response, 200, { group: { ...nativeBooking(), version: 8, status: 'cancelled' } });
    }
    if (url.pathname === `/api/bookings/groups/${NATIVE_GROUP}/lines/${LINE_1}/cancel` && request.method === 'POST') {
      return sendJson(response, 200, { group: { ...nativeBooking(), version: 8 } });
    }
    if (url.pathname === `/api/bookings/${LEGACY_APPOINTMENT}/status` && request.method === 'POST') {
      return sendJson(response, 200, { appointment: { id: LEGACY_APPOINTMENT, status: body?.status ?? 'confirmed' } });
    }

    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `unmapped fixture route: ${url.pathname}` } });
  } catch (error) {
    sendJson(response, 500, { error: { code: 'FIXTURE_ERROR', message: String(error) } });
  }
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

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
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.diagnostics = [];
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params?.exceptionDetails;
          this.diagnostics.push(String(details?.exception?.description ?? details?.text ?? 'Unknown browser exception').slice(0, 2_000));
          if (this.diagnostics.length > 8) this.diagnostics.shift();
        }
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }
  send(method, params = {}, timeoutMs = 5_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, timeoutMs = 5_000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

let chrome;
let chromeFd;
let page;
let chromeStartError;

async function navigate(client, url) {
  await client.evaluate('delete document.documentElement.dataset.f1103ConsumerReady');
  await client.send('Page.navigate', { url });
  await waitFor(
    () => client.evaluate(`${JSON.stringify(url)} === location.href && document.documentElement.dataset.f1103ConsumerReady === "true"`, 500),
    `page did not load ${url}`,
  );
}
async function openPage(debugUrl, url) {
  const target = await (await fetch(`${debugUrl}/json/new?about%3Ablank`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const client = await Cdp.connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  client.targetId = target.id;
  await navigate(client, url);
  return client;
}
async function call(client, method, ...args) {
  try {
    return await client.evaluate(`window.__f1103c[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 15_000);
  } catch (error) {
    throw new Error(`consumer harness call ${method}(${JSON.stringify(args)}) failed: ${error.message}`);
  }
}
async function uiContains(client, text, timeoutMs = 5_000) {
  return waitFor(async () => (await call(client, 'text')).includes(text), `UI did not show "${text}"`, timeoutMs);
}
function passed(name) { console.log(`F11-03 consumer browser passed: ${name}`); }

try {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: bundleDir,
      emptyOutDir: true,
      minify: false,
      lib: { entry: path.join(root, 'tests/browser/f11-group-consumers.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js' } },
    },
  });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;

  const chromeBin = process.env.CHROME_BIN;
  assert.ok(chromeBin, 'CHROME_BIN must identify the CI Chrome executable');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${path.join(work, 'profile')}`,
    'about:blank',
  ], { stdio: ['ignore', chromeFd, chromeFd] });
  chrome.once('error', (error) => { chromeStartError = error; });
  const activePort = path.join(work, 'profile', 'DevToolsActivePort');
  const port = await waitFor(() => {
    if (chromeStartError) throw chromeStartError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode} during startup`);
    const first = readFileSync(activePort, 'utf8').split(/\r?\n/)[0];
    return /^\d+$/.test(first) && first;
  }, 'Chrome did not expose a debugging port', 10_000);
  const debugUrl = `http://127.0.0.1:${port}`;

  // Calendar keeps line geometry, but the product count, drawer and mutation
  // authority are reservation-group rooted.
  page = await openPage(debugUrl, `${origin}/calendar`);
  await uiContains(page, 'Native Customer');
  assert.equal(await call(page, 'calendarReservationCount'), '2', 'three physical lines were counted as three reservations');
  assert.equal(await call(page, 'calendarEventCount'), 3, 'calendar no longer rendered per-line geometry');
  assert.equal(await call(page, 'clickCalendarEvent', 'Native Customer'), true);
  await waitFor(async () => (await call(page, 'calendarDrawerLines')).length === 2, 'native calendar drawer did not aggregate both service lines');
  const drawerLines = await call(page, 'calendarDrawerLines');
  assert.ok(drawerLines[0].includes('1. Renk') && drawerLines[1].includes('2. Kesim'));
  assert.equal(await call(page, 'setCalendarReason', 'group reason'), true);
  assert.equal(await call(page, 'click', 'Tüm rezervasyonu iptal et'), true);
  await waitFor(() => requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/cancel`).length === 1, 'calendar did not call the group cancel authority');
  assert.equal(requestsTo(`/api/bookings/${LINE_1}/status`).length, 0, 'native calendar action leaked into a line-id legacy mutation');
  const groupCancel = requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/cancel`)[0];
  assert.equal(groupCancel.body.expectedVersion, 7);
  assert.equal(groupCancel.body.reason, 'group reason');
  passed('calendar counts one logical group, aggregates its drawer and mutates the group root');

  await navigate(page, `${origin}/calendar`);
  await uiContains(page, 'Legacy Customer');
  assert.equal(await call(page, 'clickCalendarEvent', 'Legacy Customer'), true);
  await uiContains(page, 'Onayla');
  assert.equal(await call(page, 'click', 'Onayla'), true);
  await waitFor(() => requestsTo(`/api/bookings/${LEGACY_APPOINTMENT}/status`).length === 1, 'legacy calendar status route was not preserved');
  assert.equal(requestsTo(`/api/bookings/${LEGACY_APPOINTMENT}/status`)[0].body.status, 'confirmed');
  passed('calendar preserves the legacy single-appointment mutation route');

  // BookingPage renders each reservation exactly once at the outer level while
  // retaining the ordered service lines inside a native group card.
  await navigate(page, `${origin}/bookings`);
  await uiContains(page, 'Native Customer');
  await uiContains(page, 'Legacy Customer');
  const topBookings = await call(page, 'topBookings');
  assert.equal(topBookings.length, 2, 'booking page rendered physical lines as top-level bookings');
  assert.equal(await call(page, 'bookingLineCount', 'Native Customer'), 2);
  assert.equal(await call(page, 'bookingLineCount', 'Legacy Customer'), 1);
  const nativeButtons = await call(page, 'bookingButtons', 'Native Customer');
  assert.ok(nativeButtons.some((label) => label.includes('Tümünü taşı')));
  assert.ok(nativeButtons.some((label) => label.includes('Tümünü iptal et')));
  const legacyButtons = await call(page, 'bookingButtons', 'Legacy Customer');
  assert.ok(legacyButtons.some((label) => label === 'Onayla'));
  assert.ok(legacyButtons.some((label) => label === 'Geçmiş'));
  assert.equal(await call(page, 'click', 'Satırı iptal et'), true);
  await waitFor(() => requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/lines/${LINE_1}/cancel`).length === 1, 'booking line cancel did not stay on group-rooted authority');
  const lineCancel = requestsTo(`/api/bookings/groups/${NATIVE_GROUP}/lines/${LINE_1}/cancel`)[0];
  assert.equal(lineCancel.body.expectedVersion, 7);
  assert.equal(lineCancel.body.reason, 'fixture reason');
  assert.ok(lineCancel.idempotencyKey, 'line cancel lost idempotency');
  passed('booking page renders one group card and uses group-rooted line authority');

  // Customer history crosses a page boundary between the native reservation and
  // a legacy reservation. The two-line group must remain one history row.
  await navigate(page, `${origin}/customers`);
  await uiContains(page, 'History Customer');
  assert.equal(await call(page, 'chooseCustomer', 'History Customer'), true);
  await waitFor(async () => (await call(page, 'historyRows')).length === 1, 'first customer history page did not load one logical group');
  let historyRows = await call(page, 'historyRows');
  assert.ok(historyRows[0].includes('Renk') && historyRows[0].includes('Kesim'), 'native history row did not contain both ordered lines');
  assert.equal(await call(page, 'click', 'Daha eski rezervasyonları göster'), true);
  await waitFor(async () => (await call(page, 'historyRows')).length === 2, 'customer history did not cross the logical cursor boundary');
  historyRows = await call(page, 'historyRows');
  assert.equal(historyRows.filter((row) => row.includes('Renk + Kesim')).length, 1, 'native group repeated or split across customer history pages');
  const historyRequests = requestsTo(`/api/customers/${CUSTOMER_ID}/group-history`);
  assert.equal(historyRequests.length, 2);
  assert.equal(new URLSearchParams(historyRequests[1].search).get('cursor'), 'logical-page-2');
  passed('customer history keeps the native group atomic across pagination and preserves legacy history');

  console.log('F11-03 browser operator consumer acceptance passed.');
} catch (error) {
  console.error(error);
  if (page?.diagnostics.length) console.error(`browser exceptions:\n${page.diagnostics.join('\n')}`);
  try { console.error(readFileSync(chromeLog, 'utf8').slice(-4_000)); } catch { /* Chrome may not have started. */ }
  process.exitCode = 1;
} finally {
  page?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(1_000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  if (chromeFd !== undefined) closeSync(chromeFd);
  rmSync(work, { recursive: true, force: true });
}
