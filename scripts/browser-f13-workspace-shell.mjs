import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f1304-workspace-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sockets = new Set();
const requests = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let chrome;
let chromeFd;

const USER = 'f3400000-0000-4000-8000-000000000001';
const BUSINESS_A = 'f3410000-0000-4000-8000-000000000001';
const BUSINESS_B = 'f3410000-0000-4000-8000-000000000002';
const MEMBERSHIP_A = 'f3420000-0000-4000-8000-000000000001';
const MEMBERSHIP_B = 'f3420000-0000-4000-8000-000000000002';
const SERVICE = 'f3430000-0000-4000-8000-000000000001';
const STAFF = 'f3440000-0000-4000-8000-000000000001';
const APPOINTMENT = 'f3450000-0000-4000-8000-000000000001';
const GROUP = 'f3460000-0000-4000-8000-000000000001';
const CUSTOMER = 'f3470000-0000-4000-8000-000000000001';
const TICKET = 'f3480000-0000-4000-8000-000000000001';
const PAYMENT_CASH = 'f3490000-0000-4000-8000-000000000001';
const PAYMENT_CARD = 'f3490000-0000-4000-8000-000000000002';
const TOKEN = 'T'.repeat(48);
const CSRF = 'C'.repeat(43);

let activeBusinessId = BUSINESS_A;
let appointmentStatus = 'scheduled';
let ticketPaidMinor = 0;
let ticketPaymentEvents = [];
let ambiguousCashCommitted = false;
const ticketPaymentReplays = new Map();

function business(id) {
  return id === BUSINESS_A
    ? { id, name: 'Salon A', slug: 'salon-a', timezone: 'Europe/Istanbul' }
    : { id, name: 'Salon B', slug: 'salon-b', timezone: 'Europe/Istanbul' };
}
function membership(id) {
  return {
    id: id === BUSINESS_A ? MEMBERSHIP_A : MEMBERSHIP_B,
    business_id: id,
    role: id === BUSINESS_A ? 'owner' : 'manager',
    active: true,
    businesses: business(id),
  };
}
function session() {
  return {
    user: { id: USER, email: 'workspace@example.test', fullName: 'Workspace Owner' },
    memberships: [membership(BUSINESS_A), membership(BUSINESS_B)],
    activeBusinessId,
    passwordRecovery: false,
    csrfToken: CSRF,
  };
}
function isoAt(index) {
  const hour = 6 + Math.floor(index / 3);
  const minute = (index % 3) * 20;
  return new Date(Date.UTC(2026, 8, 21, hour, minute)).toISOString();
}
function calendarAppointments() {
  const prefix = activeBusinessId === BUSINESS_A ? 'A' : 'B';
  return Array.from({ length: 30 }, (_, index) => {
    const appointmentId = index === 0 && activeBusinessId === BUSINESS_A
      ? APPOINTMENT
      : `f3450000-0000-4000-8${prefix === 'A' ? '1' : '2'}${String(index).padStart(10, '0')}`;
    const startsAt = isoAt(index);
    const endsAt = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
    const status = index === 0 && activeBusinessId === BUSINESS_A ? appointmentStatus : 'scheduled';
    return {
      appointment_id: appointmentId,
      group_id: index === 0 && activeBusinessId === BUSINESS_A ? GROUP : appointmentId,
      group_legacy_appointment_id: appointmentId,
      group_status: status,
      group_version: 1,
      group_line_count: 1,
      line_ordinal: 1,
      group_starts_at: startsAt,
      group_ends_at: endsAt,
      staff_id: STAFF,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: 'Europe/Istanbul',
      customer_name: index === 0
        ? (activeBusinessId === BUSINESS_A ? 'Ada Public' : 'Bora Business B')
        : `${prefix} Uzun Liste ${String(index + 1).padStart(2, '0')}`,
      customer_phone: '+905550001122',
      customer_email: 'customer@example.test',
      service_name: 'Kesim',
      staff_name: 'Deniz',
      price_minor: 10000,
      currency: 'TRY',
      notes: null,
      cancellation_reason: null,
      source: index === 0 ? 'public' : 'operator',
    };
  });
}
function calendarPayload(url) {
  const days = Number(url.searchParams.get('days') || '1') === 7 ? 7 : 1;
  return {
    membership: {
      id: activeBusinessId === BUSINESS_A ? MEMBERSHIP_A : MEMBERSHIP_B,
      business_id: activeBusinessId,
      role: activeBusinessId === BUSINESS_A ? 'owner' : 'manager',
    },
    business: business(activeBusinessId),
    localDate: '2026-09-21',
    date: url.searchParams.get('date') || '2026-09-21',
    days,
    staff: [{ id: STAFF, name: 'Deniz', active: true }],
    appointments: calendarAppointments(),
  };
}
function catalog() {
  return {
    membership: {
      id: activeBusinessId === BUSINESS_A ? MEMBERSHIP_A : MEMBERSHIP_B,
      business_id: activeBusinessId,
      role: activeBusinessId === BUSINESS_A ? 'owner' : 'manager',
      active: true,
    },
    services: [{
      id: SERVICE, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0,
      buffer_after_minutes: 0, price_minor: 10000, currency: 'TRY', active: true,
      price_type: 'fixed', price_min_minor: 10000, price_max_minor: 10000, price_policy_version: 1,
    }],
    staff: [{ id: STAFF, membership_id: null, name: 'Deniz', phone: '+905550001122', active: true }],
    assignments: [{ staff_id: STAFF, service_id: SERVICE, active: true }],
  };
}
function customers() {
  const prefix = activeBusinessId === BUSINESS_A ? 'A' : 'B';
  return {
    membership: membership(activeBusinessId),
    customers: Array.from({ length: 30 }, (_, index) => ({
      customer_id: index === 0 && activeBusinessId === BUSINESS_A ? CUSTOMER : `f3470000-0000-4000-8000-${String((activeBusinessId === BUSINESS_A ? 100 : 200) + index).padStart(12, '0')}`,
      name: index === 0
        ? (activeBusinessId === BUSINESS_A ? 'Ada Public' : 'Bora Business B')
        : `${prefix} Müşteri ${index + 1}`,
      phone: '+905550001122',
      email: 'customer@example.test',
      notes: null,
      created_at: '2026-09-21T06:00:00.000Z',
      updated_at: '2026-09-21T06:00:00.000Z',
    })),
    page: { limit: 25, hasMore: false, nextCursor: null },
  };
}
function manageView() {
  const startsAt = isoAt(0);
  const endsAt = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
  return {
    appointment: {
      appointment_id: APPOINTMENT,
      business_name: 'Salon A',
      status: appointmentStatus,
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: 'Europe/Istanbul',
      service_name: 'Kesim',
      staff_name: 'Deniz',
      price_minor: 10000,
      currency: 'TRY',
      can_reschedule: false,
      can_cancel: false,
      local_date: '2026-09-21',
      max_date: '2026-11-20',
      support_slug: 'salon-a',
      support_phone: '+905550001122',
      support_email: 'destek@example.test',
      support_website: 'https://example.test',
      support_whatsapp: '+905550001122',
      support_address: 'İstanbul',
      kvkk_notice_text: 'Test aydınlatma metni.',
      privacy_policy_url: 'https://example.test/privacy',
      booking_terms_text: 'Test randevu koşulları.',
    },
    notification: { channel: 'email', status: 'accepted' },
  };
}

function ticketProjection() {
  const totalMinor = 60000;
  return {
    ticketId: TICKET,
    businessId: BUSINESS_A,
    bookingGroupId: GROUP,
    customerId: CUSTOMER,
    source: 'booking_group',
    status: 'open',
    version: 1,
    currency: 'TRY',
    customerName: 'Ada Public',
    customerPhone: '+905550001122',
    customerEmail: 'customer@example.test',
    settlementReady: true,
    estimateMinMinor: totalMinor,
    estimateMaxMinor: totalMinor,
    subtotalMinor: totalMinor,
    discountMinor: 0,
    totalMinor,
    paymentStatus: ticketPaidMinor === 0 ? 'unpaid' : ticketPaidMinor < totalMinor ? 'partial' : 'paid',
    paidMinor: ticketPaidMinor,
    balanceMinor: totalMinor - ticketPaidMinor,
    createdAt: '2026-09-21T06:00:00.000Z',
    updatedAt: '2026-09-21T06:00:00.000Z',
    closedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    lines: [{
      lineId: 'f3481000-0000-4000-8000-000000000001',
      ordinal: 1,
      sourceType: 'service',
      sourceAppointmentLineId: APPOINTMENT,
      serviceId: SERVICE,
      staffId: STAFF,
      serviceName: 'Kesim + Renk',
      staffName: 'Deniz',
      quantity: 1,
      priceType: 'fixed',
      priceMinMinor: totalMinor,
      priceMaxMinor: totalMinor,
      currency: 'TRY',
      pricePolicyVersion: 1,
      finalUnitPriceMinor: totalMinor,
      discountMinor: 0,
      netMinor: totalMinor,
      finalizedAt: '2026-09-21T06:00:00.000Z',
      finalizationReason: 'fixture',
      discountAt: null,
      discountReason: null,
    }],
    paymentEvents: ticketPaymentEvents,
  };
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
    case '.webmanifest': return 'application/manifest+json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}
function findChrome() {
  for (const candidate of [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome executable not found');
}
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function waitFor(read, message, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(60);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  static async connect(url) {
    const client = new Cdp(url);
    await Promise.race([
      new Promise((resolve, reject) => {
        client.ws.addEventListener('open', resolve, { once: true });
        client.ws.addEventListener('error', () => reject(new Error('F13-04 CDP WebSocket failed')), { once: true });
      }),
      sleep(5_000).then(() => { throw new Error('F13-04 CDP WebSocket timed out'); }),
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
          this.diagnostics.push(String(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? 'browser exception').slice(0, 2000));
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  send(method, params = {}, timeoutMs = 8_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

async function newPage(debugUrl, origin, pathname, width = 390) {
  const target = await (await fetch(`${debugUrl}/json/new?about%3Ablank`, {
    method: 'PUT', signal: AbortSignal.timeout(5_000),
  })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: width <= 760 });
  await page.send('Page.navigate', { url: `${origin}${pathname}` });
  return page;
}
async function tab(page) {
  const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await sleep(30);
  return page.evaluate(`(() => {
    const node=document.activeElement;
    return {tag:node?.tagName||'', text:(node?.textContent||'').trim(), focusVisible:Boolean(node?.matches?.(':focus-visible'))};
  })()`);
}

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
      lib: { entry: path.join(root, 'src/main.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'app.js', chunkFileNames: '[name]-[hash].js' } },
    },
  });

  const bundleRoot = path.resolve(bundleDir);
  const publicRoot = path.resolve(root, 'public');
  const appJs = readFileSync(path.join(bundleDir, 'app.js'));
  const cssFile = readdirSync(bundleDir).find((name) => name.endsWith('.css'));
  assert.ok(cssFile, 'F13-04 production build did not emit CSS');
  const appCss = readFileSync(path.join(bundleDir, cssFile));

  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/app.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(appJs); return;
    }
    if (url.pathname === '/app.css') {
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(appCss); return;
    }
    if (!url.pathname.startsWith('/api/') && path.extname(url.pathname)) {
      let relative;
      try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
      catch { response.writeHead(400); response.end('bad asset'); return; }
      const candidates = [
        { root: bundleRoot, target: path.resolve(bundleRoot, relative) },
        { root: publicRoot, target: path.resolve(publicRoot, relative) },
      ];
      const found = candidates.find(({ root: candidateRoot, target }) =>
        target.startsWith(`${candidateRoot}${path.sep}`) && existsSync(target) && statSync(target).isFile());
      if (!found) {
        response.writeHead(404); response.end('asset not found'); return;
      }
      response.writeHead(200, { 'Content-Type': contentType(found.target), 'Cache-Control': 'no-store' });
      response.end(readFileSync(found.target)); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#2456e8"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/kolayapp-192.png"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
      return;
    }

    const body = request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH'
      ? await readJson(request) : {};
    requests.push({
      method: request.method,
      path: url.pathname,
      body,
      expectedUser: request.headers['x-yzt-expected-user'] ?? null,
      expectedBusiness: request.headers['x-yzt-expected-business'] ?? null,
      idempotencyKey: request.headers['idempotency-key'] ?? null,
    });

    if (request.method === 'GET' && url.pathname === '/api/session') return sendJson(response, 200, session());
    if (request.method === 'GET' && url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: CSRF });
    if (request.method === 'POST' && url.pathname === '/api/businesses/select') {
      assert.ok(body.businessId === BUSINESS_A || body.businessId === BUSINESS_B, 'unexpected business switch');
      activeBusinessId = body.businessId;
      return sendJson(response, 200, { activeBusinessId, csrfToken: CSRF });
    }
    if (request.method === 'GET' && url.pathname === '/api/calendar') return sendJson(response, 200, calendarPayload(url));
    if (request.method === 'GET' && url.pathname === '/api/catalog') return sendJson(response, 200, catalog());
    if (request.method === 'GET' && url.pathname === '/api/availability/setup') {
      return sendJson(response, 200, {
        membership: catalog().membership,
        timezone: 'Europe/Istanbul',
        businessHours: [], staffHours: [], blocks: [],
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/bookings/groups') {
      return sendJson(response, 200, {
        membership: catalog().membership,
        bookings: [],
        page: { limit: 25, hasMore: false, nextCursor: null },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/customers') return sendJson(response, 200, customers());
    if (request.method === 'GET' && url.pathname === '/api/tickets') {
      return sendJson(response, 200, {
        tickets: activeBusinessId === BUSINESS_A ? [ticketProjection()] : [],
        page: { limit: 25, hasMore: false, nextCursor: null },
      });
    }
    if (request.method === 'GET' && url.pathname === `/api/tickets/${TICKET}`) {
      if (activeBusinessId !== BUSINESS_A) return sendJson(response, 404, { error: { code: 'TICKET_NOT_FOUND', message: 'Adisyon bulunamadı.' } });
      return sendJson(response, 200, { ticket: ticketProjection() });
    }
    if (request.method === 'POST' && url.pathname === `/api/tickets/${TICKET}/payments`) {
      assert.equal(activeBusinessId, BUSINESS_A, 'payment escaped active business A');
      const key = request.headers['idempotency-key'];
      assert.ok(key, 'payment omitted Idempotency-Key');
      if (ticketPaymentReplays.has(key)) {
        return sendJson(response, 201, { ticket: ticketPaymentReplays.get(key) });
      }
      const amount = Number(body.amountMinor);
      assert.ok(body.method === 'cash' || body.method === 'card', 'unexpected payment method');
      assert.ok(amount > 0, 'unexpected payment amount');

      const eventId = body.method === 'cash' ? PAYMENT_CASH : PAYMENT_CARD;
      ticketPaidMinor += amount;
      ticketPaymentEvents = [...ticketPaymentEvents, {
        eventId,
        eventType: 'payment',
        sourcePaymentEventId: null,
        method: body.method,
        correctionDirection: null,
        amountMinor: amount,
        effectMinor: amount,
        reason: null,
        actorMembershipId: MEMBERSHIP_A,
        createdAt: new Date().toISOString(),
      }];
      const projection = ticketProjection();
      ticketPaymentReplays.set(key, projection);

      if (body.method === 'cash' && amount === 20000 && !ambiguousCashCommitted) {
        ambiguousCashCommitted = true;
        return sendJson(response, 503, { error: { code: 'TICKET_WRITE_UNAVAILABLE', message: 'Sonuç doğrulanamadı.' } });
      }
      return sendJson(response, 201, { ticket: projection });
    }
    if (request.method === 'POST' && url.pathname === `/api/bookings/${APPOINTMENT}/status`) {
      assert.equal(activeBusinessId, BUSINESS_A, 'status mutation escaped active business A');
      assert.equal(request.headers['x-yzt-expected-user'], USER, 'status mutation omitted expected user');
      assert.equal(request.headers['x-yzt-expected-business'], BUSINESS_A, 'status mutation omitted expected business');
      appointmentStatus = body.status;
      return sendJson(response, 200, { appointment: { id: APPOINTMENT, status: appointmentStatus } });
    }
    if (request.method === 'POST' && url.pathname === '/api/manage/view') {
      assert.equal(body.token, TOKEN, 'management token mismatch');
      return sendJson(response, 200, manageView());
    }

    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `unmapped F13-04 fixture: ${url.pathname}` } });
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const chromeBin = findChrome();
  const profileDir = path.join(work, 'profile');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: ['ignore', chromeFd, chromeFd] });

  const activePort = path.join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(() => {
    try { return readFileSync(activePort, 'utf8').split(/\r?\n/)[0] || false; }
    catch { return false; }
  }, 'F13-04 Chrome did not expose a debugging port');
  const debugUrl = `http://127.0.0.1:${port}`;

  const page = await newPage(debugUrl, origin, '/', 390);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app' && document.body.innerText.includes('OPERASYON TAKVİMİ') && document.body.innerText.includes('Ada Public')`),
    'root compatibility did not land on mobile calendar workspace',
  );

  const mobile = await page.evaluate(`(() => ({
    path: location.pathname,
    listVisible: Boolean(document.querySelector('.calendar-list-view')),
    rows: document.querySelectorAll('.calendar-list-event').length,
    mobileMenu: getComputedStyle(document.querySelector('.workspace-mobile-nav')).display,
    desktopMenu: getComputedStyle(document.querySelector('.workspace-panel-nav')).display,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    scrollable: document.documentElement.scrollHeight > window.innerHeight,
    navLabels: [...document.querySelectorAll('.workspace-mobile-nav a')].map((node) => node.textContent?.trim() ?? ''),
    body: document.body.innerText,
  }))()`);
  assert.equal(mobile.path, '/app');
  assert.equal(mobile.listVisible, true, 'narrow workspace did not default calendar to agenda/list');
  assert.ok(mobile.rows >= 25, 'long calendar list was not rendered');
  assert.notEqual(mobile.mobileMenu, 'none', 'mobile workspace menu is hidden');
  assert.equal(mobile.desktopMenu, 'none', 'desktop panel nav leaked into narrow viewport');
  assert.ok(mobile.overflow <= 1, `workspace overflowed narrow viewport by ${mobile.overflow}px`);
  assert.equal(mobile.scrollable, true, 'long mobile list is not vertically scrollable');
  for (const label of ['Takvim', 'Müşteriler', 'Hizmetler', 'Ekip']) {
    assert.ok(mobile.navLabels.includes(label), `mobile workspace navigation is missing ${label}: ${JSON.stringify(mobile.navLabels)}`);
  }
  assert.doesNotMatch(mobile.body, /YÖNETİM ÖZETİ|PROMOSYON/i);

  await page.evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  let keyboardOk = false;
  for (let index = 0; index < 12; index += 1) {
    const focused = await tab(page);
    if (focused.focusVisible) { keyboardOk = true; break; }
  }
  assert.equal(keyboardOk, true, 'workspace navigation did not expose a visible keyboard focus');

  const sessionReadsBeforePanel = requests.filter((item) => item.method === 'GET' && item.path === '/api/session').length;
  await page.evaluate(`document.querySelector('.workspace-mobile-nav summary').click()`);
  await page.evaluate(`[...document.querySelectorAll('.workspace-mobile-nav a')].find((node) => node.textContent.trim()==='Müşteriler').click()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/customers' && document.body.innerText.includes('Ada Public') && document.body.innerText.includes('İşletme müşteri kayıtları')`),
    'mobile panel did not open canonical customers route',
  );
  const sessionReadsAfterPanel = requests.filter((item) => item.method === 'GET' && item.path === '/api/session').length;
  assert.equal(sessionReadsAfterPanel, sessionReadsBeforePanel, 'domain navigation created a second session authority');

  await page.evaluate('history.back()');
  await waitFor(() => page.evaluate(`location.pathname === '/app' && document.body.innerText.includes('OPERASYON TAKVİMİ')`), 'history back did not restore calendar panel');
  await page.evaluate('history.forward()');
  await waitFor(() => page.evaluate(`location.pathname === '/app/customers'`), 'history forward did not restore customers panel');
  await page.evaluate('history.back()');
  await waitFor(() => page.evaluate(`location.pathname === '/app'`), 'calendar did not return after history traversal');


  // F14-01: the mobile product surface reuses this exact session/business authority.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 820, deviceScaleFactor: 1, mobile: true });
  await page.send('Page.navigate', { url: `${origin}/app/mobile` });
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile' && Boolean(document.querySelector('.kolay-bottom-nav')) && document.body.innerText.includes('Ada Public')`),
    'KolayApp appointments route did not reuse the canonical calendar data',
  );

  const appManifest = await page.send('Page.getAppManifest');
  assert.match(appManifest.url ?? '', /\/manifest\.webmanifest$/, 'F14-05 browser did not discover the KolayApp manifest');
  assert.equal(appManifest.errors?.length ?? 0, 0, `F14-05 manifest parse errors: ${JSON.stringify(appManifest.errors ?? [])}`);
  const parsedManifest = JSON.parse(appManifest.data);
  assert.equal(parsedManifest.start_url, '/app/mobile');
  assert.equal(parsedManifest.scope, '/app/');
  assert.equal(parsedManifest.display, 'standalone');
  assert.ok(parsedManifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(parsedManifest.icons.some((icon) => icon.sizes === '512x512'));

  const pwaRuntime = await page.evaluate(`(async () => ({
    secure: window.isSecureContext,
    serviceWorkers: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    cacheKeys: 'caches' in window ? await caches.keys() : [],
  }))()`);
  assert.equal(pwaRuntime.secure, true, 'F14-05 browser fixture is not a secure localhost context');
  assert.equal(pwaRuntime.serviceWorkers, 0, 'F14-05 unexpectedly registered a service worker');
  assert.deepEqual(pwaRuntime.cacheKeys, [], 'F14-05 unexpectedly persisted application responses in Cache Storage');

  const kolay390 = await page.evaluate(`(() => {
    const labels=[...document.querySelectorAll('.kolay-bottom-nav__label')].map((node)=>node.textContent.trim());
    const items=[...document.querySelectorAll('.kolay-bottom-nav__item')];
    const nav=document.querySelector('.kolay-bottom-nav');
    const navRect=nav.getBoundingClientRect();
    return {
      labels,
      overflow: document.documentElement.scrollWidth - innerWidth,
      minWidth: Math.min(...items.map((node)=>node.getBoundingClientRect().width)),
      minHeight: Math.min(...items.map((node)=>node.getBoundingClientRect().height)),
      navBottom: navRect.bottom,
      viewportHeight: innerHeight,
    };
  })()`);
  assert.deepEqual(kolay390.labels, ['Randevular', 'Adisyonlar', 'Yeni', 'Müşteriler', 'Diğer']);
  assert.ok(kolay390.overflow <= 1, `KolayApp overflowed 390px viewport by ${kolay390.overflow}px`);
  assert.ok(kolay390.minWidth >= 44, `KolayApp touch target width dropped below 44px: ${kolay390.minWidth}`);
  assert.ok(kolay390.minHeight >= 44, `KolayApp touch target height dropped below 44px: ${kolay390.minHeight}`);
  assert.ok(kolay390.navBottom <= kolay390.viewportHeight + 1, 'KolayApp bottom navigation is outside the viewport');

  const sessionReadsBeforeKolayTabs = requests.filter((item) => item.method === 'GET' && item.path === '/api/session').length;
  await page.evaluate(`[...document.querySelectorAll('.kolay-bottom-nav__item')].find((node) => node.textContent.includes('Müşteriler')).click()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/customers' && Boolean(document.querySelector('.customers-list-panel')) && document.body.innerText.includes('Ada Public')`),
    'KolayApp customers tab did not reuse the canonical customer module',
  );
  const sessionReadsAfterKolayTabs = requests.filter((item) => item.method === 'GET' && item.path === '/api/session').length;
  assert.equal(sessionReadsAfterKolayTabs, sessionReadsBeforeKolayTabs, 'KolayApp tab navigation created a second session authority');

  await page.evaluate('history.back()');
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile' && document.body.innerText.includes('Ada Public')`),
    'KolayApp history back did not restore appointments',
  );
  await page.evaluate('history.forward()');
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/customers'`),
    'KolayApp history forward did not restore customers',
  );

  await page.evaluate(`[...document.querySelectorAll('.kolay-bottom-nav__item')].find((node) => node.textContent.includes('Adisyonlar')).click()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/tickets' && document.body.innerText.includes('Kasa ve adisyon') && document.body.innerText.includes('Ada Public')`),
    'F14-04 ticket cashier surface did not open',
  );

  await page.evaluate(`[...document.querySelectorAll('.ticket-list button')].find((node) => node.textContent.includes('Ada Public')).click()`);
  await waitFor(
    () => page.evaluate(`Boolean(document.querySelector('.ticket-detail')) && document.querySelector('.ticket-totals')?.innerText.includes('600')`),
    'F14-04 ticket detail did not render server totals',
  );

  const ticket390 = await page.evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    bottom: document.querySelector('.kolay-bottom-nav').getBoundingClientRect().bottom,
    viewport: innerHeight,
    totals: document.querySelector('.ticket-totals').innerText,
  }))()`);
  assert.ok(ticket390.overflow <= 1, `F14-04 cashier overflowed 390px viewport by ${ticket390.overflow}px`);
  assert.ok(ticket390.bottom <= ticket390.viewport + 1, 'F14-04 cashier covered the fixed bottom navigation');
  assert.match(ticket390.totals, /600/);
  assert.match(ticket390.totals, /0/);

  await page.evaluate(`(() => {
    const form=document.querySelector('.ticket-payment');
    form.querySelector('select[name="method"]').value='cash';
    form.querySelector('input[name="amount"]').value='200';
    form.requestSubmit();
  })()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('İşlemin sonucu henüz doğrulanamadı')`),
    'F14-04 ambiguous payment did not preserve uncertainty',
  );
  const ambiguousTotals = await page.evaluate(`document.querySelector('.ticket-totals').innerText`);
  assert.match(ambiguousTotals, /Tahsil/);
  assert.ok(!/200[^\n]*Kalan[^\n]*400/s.test(ambiguousTotals), 'ambiguous write was shown as locally paid');

  const walkInPostsBeforeAmbiguitySwitch = requests.filter((item) => item.method === 'POST' && item.path === '/api/tickets').length;
  await page.evaluate(`(() => {
    const select=document.querySelector('.kolay-business-select select');
    select.value='${BUSINESS_B}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/tickets' && document.querySelector('.kolay-business-select select').value === '${BUSINESS_B}' && document.body.innerText.includes('Açık filtrede adisyon yok.')`),
    'F14-04 ambiguity switch did not remount business B ticket state',
  );
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Başka bir işletmede sonucu belirsiz mali işlem var')`),
    'F14-04 ambiguity lock did not survive business switch',
  );
  await page.evaluate(`(() => {
    const form=document.querySelector('.ticket-walkin');
    const select=form.querySelector('select[name="customerId"]');
    select.value=select.options[1].value;
    form.requestSubmit();
  })()`);
  await sleep(100);
  assert.equal(
    requests.filter((item) => item.method === 'POST' && item.path === '/api/tickets').length,
    walkInPostsBeforeAmbiguitySwitch,
    'F14-04 allowed a different ticket mutation while a payment result was ambiguous',
  );

  await page.evaluate(`(() => {
    const select=document.querySelector('.kolay-business-select select');
    select.value='${BUSINESS_A}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/tickets' && document.querySelector('.kolay-business-select select').value === '${BUSINESS_A}' && document.body.innerText.includes('Ada Public')`),
    'F14-04 ambiguity switch did not restore business A ticket state',
  );
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Sonucu belirsiz mali işlem korunuyor') && [...document.querySelectorAll('.ticket-notice button')].some((node) => node.textContent.includes('Belirsiz işlemi doğrula'))`),
    'F14-04 ambiguity recovery did not restore the persisted replay control',
  );
  await page.evaluate(`[...document.querySelectorAll('.ticket-notice button')].find((node) => node.textContent.includes('Belirsiz işlemi doğrula')).click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Tahsilat sunucuda doğrulandı.') && document.querySelector('.ticket-totals')?.innerText.includes('200') && document.querySelector('.ticket-totals')?.innerText.includes('400')`),
    'F14-04 same-key ambiguous payment recovery after business remount did not restore server projection',
  );

  const cashRequests = requests.filter((item) => item.method === 'POST' && item.path === `/api/tickets/${TICKET}/payments` && item.body.method === 'cash');
  assert.equal(cashRequests.length, 2, 'F14-04 ambiguous cash payment was not retried exactly once');
  assert.equal(cashRequests[0].idempotencyKey, cashRequests[1].idempotencyKey, 'F14-04 ambiguity remount changed Idempotency-Key');
  assert.equal(ticketPaymentEvents.filter((item) => item.method === 'cash').length, 1, 'F14-04 same-key retry duplicated cash event');

  await page.evaluate(`(() => {
    const form=document.querySelector('.ticket-payment');
    form.querySelector('select[name="method"]').value='card';
    form.querySelector('input[name="amount"]').value='400';
    form.requestSubmit();
  })()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Tahsilat sunucuda doğrulandı.') && document.querySelector('.ticket-totals')?.innerText.includes('600') && document.querySelector('.ticket-totals')?.innerText.includes('0')`),
    'F14-04 200 cash + 400 card did not display paid 600 / balance 0 from server',
  );
  assert.equal(ticketPaidMinor, 60000, 'F14-04 fixture did not preserve server paid total');
  assert.equal(ticketPaymentEvents.length, 2, 'F14-04 fixture created an unexpected payment count');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
  const ticket360 = await page.evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    minTarget: Math.min(...[...document.querySelectorAll('.ticket-page button')].map((node)=>node.getBoundingClientRect().height)),
  }))()`);
  assert.ok(ticket360.overflow <= 1, `F14-04 cashier overflowed 360px viewport by ${ticket360.overflow}px`);
  assert.ok(ticket360.minTarget >= 44, `F14-04 cashier touch target dropped below 44px: ${ticket360.minTarget}`);

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 480, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
  const ticketKeyboard = await page.evaluate(`(() => ({
    navBottom: document.querySelector('.kolay-bottom-nav').getBoundingClientRect().bottom,
    viewport: innerHeight,
    contentScroll: document.querySelector('.kolay-app-content').scrollHeight,
    contentClient: document.querySelector('.kolay-app-content').clientHeight,
  }))()`);
  assert.ok(ticketKeyboard.navBottom <= ticketKeyboard.viewport + 1, 'F14-04 cashier bottom nav is covered in keyboard-sized viewport');
  assert.ok(ticketKeyboard.contentScroll >= ticketKeyboard.contentClient, 'F14-04 cashier content is not scrollable in keyboard-sized viewport');

  await page.evaluate(`(() => {
    const select=document.querySelector('.kolay-business-select select');
    select.value='${BUSINESS_B}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/tickets' && document.querySelector('.kolay-business-select select').value === '${BUSINESS_B}' && document.body.innerText.includes('Açık filtrede adisyon yok.')`),
    'F14-04 business switch did not clear/remount ticket state',
  );

  await page.evaluate(`(() => {
    const select=document.querySelector('.kolay-business-select select');
    select.value='${BUSINESS_A}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/tickets' && document.querySelector('.kolay-business-select select').value === '${BUSINESS_A}' && document.body.innerText.includes('Ada Public')`),
    'F14-04 business switch did not restore A ticket state',
  );
  console.log('F14-04 ticket cashier payment/idempotency/mobile acceptance passed.');

  await page.evaluate(`[...document.querySelectorAll('.kolay-bottom-nav__item')].find((node) => node.textContent.includes('Müşteriler')).click()`);
  await waitFor(() => page.evaluate(`location.pathname === '/app/mobile/customers'`), 'KolayApp did not return to customers');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
  const kolay360 = await page.evaluate(`(() => {
    const nav=document.querySelector('.kolay-bottom-nav');
    const items=[...document.querySelectorAll('.kolay-bottom-nav__item')];
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      minWidth: Math.min(...items.map((node)=>node.getBoundingClientRect().width)),
      navBottom: nav.getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
    };
  })()`);
  assert.ok(kolay360.overflow <= 1, `KolayApp overflowed 360px viewport by ${kolay360.overflow}px`);
  assert.ok(kolay360.minWidth >= 44, `KolayApp 360px touch target width dropped below 44px: ${kolay360.minWidth}`);
  assert.ok(kolay360.navBottom <= kolay360.viewportHeight + 1, 'KolayApp 360px bottom navigation is outside the viewport');


  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 480, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
  const kolayKeyboardViewport = await page.evaluate(`(() => {
    const nav=document.querySelector('.kolay-bottom-nav');
    const content=document.querySelector('.kolay-app-content');
    return {
      navBottom: nav.getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
      contentClientHeight: content.clientHeight,
      contentScrollHeight: content.scrollHeight,
    };
  })()`);
  assert.ok(
    kolayKeyboardViewport.navBottom <= kolayKeyboardViewport.viewportHeight + 1,
    'KolayApp bottom navigation is covered after keyboard-like viewport resize',
  );
  assert.ok(kolayKeyboardViewport.contentClientHeight > 0, 'KolayApp content collapsed after keyboard-like viewport resize');
  assert.ok(
    kolayKeyboardViewport.contentScrollHeight >= kolayKeyboardViewport.contentClientHeight,
    'KolayApp content cannot scroll inside keyboard-like viewport',
  );

  await page.evaluate(`(() => {
    const select=document.querySelector('.kolay-business-select select');
    select.value='${BUSINESS_B}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/customers' && document.body.innerText.includes('Salon B') && document.body.innerText.includes('Bora Business B')`),
    'KolayApp business switch did not remount the verified B context on the same tab',
  );

  await page.evaluate(`(() => {
    const select=document.querySelector('.kolay-business-select select');
    select.value='${BUSINESS_A}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile/customers' && document.body.innerText.includes('Salon A') && document.body.innerText.includes('Ada Public')`),
    'KolayApp business switch did not restore the verified A context',
  );
  console.log('F14-01 KolayApp mobile route/back-forward/business-switch acceptance passed.');

  await page.send('Network.enable');
  await page.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  const offlineNavigation = await page.send('Page.navigate', { url: `${origin}/app/mobile` });
  assert.match(
    String(offlineNavigation.errorText ?? ''),
    /ERR_INTERNET_DISCONNECTED|ERR_FAILED/,
    `F14-05 private app unexpectedly navigated from an offline persistent shell: ${JSON.stringify(offlineNavigation)}`,
  );
  await page.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.send('Page.navigate', { url: `${origin}/app/mobile` });
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/mobile' && document.body.innerText.includes('Ada Public')`),
    'F14-05 KolayApp did not recover from an offline navigation with the current network version',
  );
  const pwaRuntimeAfterReconnect = await page.evaluate(`(async () => ({
    serviceWorkers: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    cacheKeys: 'caches' in window ? await caches.keys() : [],
  }))()`);
  assert.equal(pwaRuntimeAfterReconnect.serviceWorkers, 0, 'F14-05 reconnect unexpectedly registered a service worker');
  assert.deepEqual(pwaRuntimeAfterReconnect.cacheKeys, [], 'F14-05 reconnect populated persistent Cache Storage');
  console.log('F14-05 manifest/installability and no-offline-private-cache acceptance passed.');

  // Return the shared F13 harness to its canonical workspace before continuing
  // the pre-existing desktop/legacy-route acceptance below.
  await page.send('Page.navigate', { url: `${origin}/app` });
  await waitFor(
    () => page.evaluate(`location.pathname === '/app' && Boolean(document.querySelector('.workspace-panel-nav')) && document.body.innerText.includes('Salon A')`),
    'workspace harness did not return from KolayApp to the canonical panel',
  );

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  const desktop = await page.evaluate(`(() => ({
    panel: getComputedStyle(document.querySelector('.workspace-panel-nav')).display,
    mobile: getComputedStyle(document.querySelector('.workspace-mobile-nav')).display,
  }))()`);
  assert.notEqual(desktop.panel, 'none', 'desktop workspace panel navigation is hidden');
  assert.equal(desktop.mobile, 'none', 'mobile workspace navigation leaked into desktop');

  await page.send('Page.navigate', { url: `${origin}/calendar` });
  await waitFor(() => page.evaluate(`location.pathname === '/app/calendar' && document.body.innerText.includes('Salon A')`), 'legacy calendar route did not canonicalize');

  await page.evaluate(`(() => {
    const select=document.querySelector('.workspace-business select');
    select.value='${BUSINESS_B}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`location.pathname === '/app/calendar' && document.body.innerText.includes('Salon B') && document.body.innerText.includes('Bora Business B')`),
    'business switch did not remount verified B context',
  );

  await page.evaluate(`(() => {
    const select=document.querySelector('.workspace-business select');
    select.value='${BUSINESS_A}';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Salon A') && document.body.innerText.includes('Ada Public')`),
    'business switch did not return to verified A context',
  );

  await page.evaluate(`[...document.querySelectorAll('button')].find((node) => node.textContent.includes('Ada Public')).click()`);
  await waitFor(() => page.evaluate(`Boolean(document.querySelector('.calendar-drawer')) && document.body.innerText.includes('Ada Public')`), 'calendar booking drawer did not open');
  await page.evaluate(`[...document.querySelectorAll('.calendar-drawer button')].find((node) => node.textContent.trim()==='Onayla').click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Randevu durumu “Onaylandı” olarak güncellendi.') && document.body.innerText.includes('Onaylandı')`),
    'calendar status mutation did not refresh the panel',
  );
  assert.equal(appointmentStatus, 'confirmed');

  await page.send('Page.navigate', { url: `${origin}/m#${TOKEN}` });
  await waitFor(
    () => page.evaluate(`location.pathname === '/m' && document.body.innerText.includes('RANDEVUMU YÖNET') && document.body.innerText.includes('Onaylandı')`),
    'customer management did not reflect operator calendar change',
  );

  await page.send('Page.navigate', { url: `${origin}/app/does-not-exist` });
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Bu çalışma alanı yolu bulunamadı')`),
    'workspace NotFound was not explicit',
  );

  if (page.diagnostics.length) throw new Error(`browser diagnostics: ${page.diagnostics.join(' | ')}`);
  page.close();

  const statusWrite = requests.find((item) => item.method === 'POST' && item.path === `/api/bookings/${APPOINTMENT}/status`);
  assert.ok(statusWrite, 'calendar status mutation did not reach the fixture');
  assert.equal(statusWrite.expectedUser, USER);
  assert.equal(statusWrite.expectedBusiness, BUSINESS_A);
  assert.ok(requests.some((item) => item.method === 'POST' && item.path === '/api/manage/view'), 'management projection was not read');

  console.log('F13-04 real-browser workspace shell acceptance passed.');
} finally {
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (chrome && !chrome.killed) chrome.kill('SIGTERM');
  if (chromeFd !== undefined) closeSync(chromeFd);
  await sleep(150);
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
