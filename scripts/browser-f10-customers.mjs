import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f10-customers-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const csrfToken = 'D'.repeat(43);

const ids = {
  user: 'ba000000-0000-4000-8000-000000000001',
  businessA: 'bb000000-0000-4000-8000-000000000001',
  businessB: 'bb000000-0000-4000-8000-000000000002',
  membershipA: 'bc000000-0000-4000-8000-000000000001',
  membershipB: 'bc000000-0000-4000-8000-000000000002',
  customerA: 'bd000000-0000-4000-8000-000000000001',
  customerB: 'bd000000-0000-4000-8000-000000000002',
};

const state = {
  selected: ids.businessA,
  recovery: false,
  listMode: 'normal',
  historyMode: 'normal',
  delayListOnceMs: 0,
  delayHistoryOnceMs: 0,
  requests: [],
  customerSequence: 10,
  businesses: {
    [ids.businessA]: {
      id: ids.businessA,
      membershipId: ids.membershipA,
      name: 'Salon A',
      slug: 'salon-a',
      customers: [{
        customer_id: ids.customerA,
        name: 'Ayla A',
        phone: '0555 100 00 01',
        email: 'ayla-a@example.invalid',
        notes: 'A master',
        created_at: '2026-09-01T09:00:00.000Z',
        updated_at: '2026-09-01T09:00:00.000Z',
      }],
      histories: {
        [ids.customerA]: [{
          appointment_id: 'be000000-0000-4000-8000-000000000001',
          status: 'completed',
          starts_at: '2026-08-10T07:00:00.000Z',
          ends_at: '2026-08-10T07:30:00.000Z',
          timezone: 'Europe/Istanbul',
          customer_name_snapshot: 'A History Marker',
          customer_phone_snapshot: '0555 100 00 01',
          customer_email_snapshot: 'ayla-a@example.invalid',
          service_name_snapshot: 'A History Service',
          staff_name_snapshot: 'A Staff',
          price_minor_snapshot: 10000,
          currency_snapshot: 'TRY',
          notes: null,
          cancellation_reason: null,
        }],
      },
    },
    [ids.businessB]: {
      id: ids.businessB,
      membershipId: ids.membershipB,
      name: 'Salon B',
      slug: 'salon-b',
      customers: [{
        customer_id: ids.customerB,
        name: 'Bora B',
        phone: '0555 200 00 02',
        email: 'bora-b@example.invalid',
        notes: 'B master',
        created_at: '2026-09-02T09:00:00.000Z',
        updated_at: '2026-09-02T09:00:00.000Z',
      }],
      histories: {
        [ids.customerB]: [{
          appointment_id: 'be000000-0000-4000-8000-000000000002',
          status: 'confirmed',
          starts_at: '2026-09-09T10:00:00.000Z',
          ends_at: '2026-09-09T10:45:00.000Z',
          timezone: 'Europe/Istanbul',
          customer_name_snapshot: 'B History Marker',
          customer_phone_snapshot: '0555 200 00 02',
          customer_email_snapshot: 'bora-b@example.invalid',
          service_name_snapshot: 'B History Service',
          staff_name_snapshot: 'B Staff',
          price_minor_snapshot: 22000,
          currency_snapshot: 'TRY',
          notes: null,
          cancellation_reason: null,
        }],
      },
    },
  },
};

let testJs;
let styles;
const sockets = new Set();

function membership(business) {
  return {
    id: business.membershipId,
    business_id: business.id,
    role: 'owner',
    active: true,
    businesses: { id: business.id, name: business.name, slug: business.slug, timezone: 'Europe/Istanbul' },
  };
}

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function pageInfo() {
  return { limit: 25, hasMore: false, nextCursor: null };
}

function findCustomer(customerId) {
  for (const business of Object.values(state.businesses)) {
    const customer = business.customers.find((item) => item.customer_id === customerId);
    if (customer) return { business, customer };
  }
  return null;
}

function legacyHistoryBooking(row) {
  return {
    groupId: row.appointment_id,
    status: row.status,
    source: 'operator',
    version: 1,
    customerId: '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    currency: row.currency_snapshot,
    estimateMinMinor: row.price_minor_snapshot,
    estimateMaxMinor: row.price_minor_snapshot,
    lines: [{
      appointmentId: row.appointment_id,
      lineOrdinal: 1,
      serviceName: row.service_name_snapshot,
      staffName: row.staff_name_snapshot,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      priceType: 'fixed',
      priceMinMinor: row.price_minor_snapshot,
      priceMaxMinor: row.price_minor_snapshot,
      priceMinor: row.price_minor_snapshot,
      currency: row.currency_snapshot,
    }],
    legacyAppointmentId: row.appointment_id,
    managementMode: 'legacy_single',
    lineCount: 1,
    customerName: row.customer_name_snapshot,
    customerPhone: row.customer_phone_snapshot,
    customerEmail: row.customer_email_snapshot,
    notes: row.notes,
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(testJs);
      return;
    }
    if (url.pathname === '/customers' || url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>`);
      return;
    }

    const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readJson(request);
    if (url.pathname === '/__control' && request.method === 'POST') {
      Object.assign(state, body);
      return sendJson(response, 200, { ok: true });
    }

    state.requests.push({ method: request.method, path: url.pathname, search: url.search, selected: state.selected });

    if (request.method === 'GET' && url.pathname === '/api/session') {
      return sendJson(response, 200, {
        user: { id: ids.user, email: 'browser-owner@example.invalid', fullName: 'Browser Owner' },
        memberships: Object.values(state.businesses).map(membership),
        activeBusinessId: state.selected,
        passwordRecovery: state.recovery,
        csrfToken,
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/businesses/select') {
      if (!state.businesses[body.businessId]) return sendJson(response, 403, { error: { code: 'TENANT_FORBIDDEN', message: 'İşletme erişimi yok.' } });
      state.selected = body.businessId;
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/api/customers') {
      const capturedBusiness = state.businesses[state.selected];
      const delay = state.delayListOnceMs;
      state.delayListOnceMs = 0;
      if (delay) await sleep(delay);
      if (state.listMode === 'errorOnce') {
        state.listMode = 'normal';
        return sendJson(response, 503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Müşteri listesi test hatası.' } });
      }
      const query = (url.searchParams.get('search') ?? '').trim().toLocaleLowerCase('tr-TR');
      const rows = state.listMode === 'emptyOnce'
        ? []
        : capturedBusiness.customers.filter((customer) => !query || [customer.name, customer.phone ?? '', customer.email ?? ''].some((value) => value.toLocaleLowerCase('tr-TR').includes(query)));
      if (state.listMode === 'emptyOnce') state.listMode = 'normal';
      return sendJson(response, 200, { membership: membership(capturedBusiness), customers: rows, page: pageInfo() });
    }

    const groupHistoryMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/group-history$/);
    if (request.method === 'GET' && groupHistoryMatch) {
      const captured = findCustomer(groupHistoryMatch[1]);
      const delay = state.delayHistoryOnceMs;
      state.delayHistoryOnceMs = 0;
      if (delay) await sleep(delay);
      if (state.historyMode === 'errorOnce') {
        state.historyMode = 'normal';
        return sendJson(response, 503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Randevu geçmişi test hatası.' } });
      }
      if (!captured || captured.business.id !== state.selected) return sendJson(response, 404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri bulunamadı.' } });
      const rows = captured.business.histories[groupHistoryMatch[1]] ?? [];
      return sendJson(response, 200, { bookings: rows.map(legacyHistoryBooking), page: pageInfo() });
    }

    const historyMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/history$/);
    if (request.method === 'GET' && historyMatch) {
      const captured = findCustomer(historyMatch[1]);
      const delay = state.delayHistoryOnceMs;
      state.delayHistoryOnceMs = 0;
      if (delay) await sleep(delay);
      if (state.historyMode === 'errorOnce') {
        state.historyMode = 'normal';
        return sendJson(response, 503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Randevu geçmişi test hatası.' } });
      }
      if (!captured || captured.business.id !== state.selected) return sendJson(response, 404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri bulunamadı.' } });
      return sendJson(response, 200, { appointments: captured.business.histories[historyMatch[1]] ?? [], page: pageInfo() });
    }

    if (request.method === 'POST' && url.pathname === '/api/customers') {
      const business = state.businesses[state.selected];
      const customerId = `bd000000-0000-4000-8000-${String(state.customerSequence++).padStart(12, '0')}`;
      const customer = {
        customer_id: customerId,
        name: String(body.name ?? '').trim(),
        phone: String(body.phone ?? '').trim() || null,
        email: String(body.email ?? '').trim().toLowerCase() || null,
        notes: String(body.notes ?? '').trim() || null,
        created_at: '2026-09-14T12:00:00.000Z',
        updated_at: '2026-09-14T12:00:00.000Z',
      };
      business.customers.unshift(customer);
      business.histories[customerId] = [];
      return sendJson(response, 201, { customer });
    }

    const updateMatch = url.pathname.match(/^\/api\/customers\/([^/]+)$/);
    if (request.method === 'PATCH' && updateMatch) {
      const found = findCustomer(updateMatch[1]);
      if (!found || found.business.id !== state.selected) return sendJson(response, 404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri bulunamadı.' } });
      Object.assign(found.customer, {
        name: String(body.name ?? '').trim(),
        phone: String(body.phone ?? '').trim() || null,
        email: String(body.email ?? '').trim().toLowerCase() || null,
        notes: String(body.notes ?? '').trim() || null,
        updated_at: '2026-09-14T12:01:00.000Z',
      });
      return sendJson(response, 200, { customer: found.customer });
    }

    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Fixture route missing.' } });
  } catch (error) {
    if (!response.destroyed) sendJson(response, 500, { error: { code: 'FIXTURE_ERROR', message: error.message } });
  }
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

async function waitFor(read, message, timeoutMs = 8_000) {
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
        if (message.method === 'Runtime.exceptionThrown') this.diagnostics.push(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? 'browser exception');
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  send(method, params = {}, timeoutMs = 8_000) {
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
  async evaluate(expression, timeoutMs = 8_000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

function call(page, method, ...args) {
  return page.evaluate(`window.__f10customers[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function uiContains(page, text, timeoutMs = 8_000) {
  return waitFor(async () => (await call(page, 'text')).includes(text), `UI did not contain ${text}`, timeoutMs);
}
async function uiOmits(page, text, timeoutMs = 8_000) {
  return waitFor(async () => !(await call(page, 'text')).includes(text), `UI still contained ${text}`, timeoutMs);
}
async function control(page, patch) {
  return page.evaluate(`fetch('/__control',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(patch))}}).then(r=>r.json())`);
}
async function reload(page) {
  await page.send('Page.reload', { ignoreCache: true });
  await waitFor(() => page.evaluate('document.documentElement.dataset.f10CustomersReady === "true"'), 'customer harness did not reload');
}

let chrome;
let chromeFd;
let page;
let origin;
let chromeStartError;

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
      lib: { entry: path.join(root, 'tests/browser/f10-customers.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js' } },
    },
  });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  styles = `:root{--border:#d9dfeb;--accent:#3158d6;--muted:#667085}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f7f8fb}`
    + readFileSync(path.join(root, 'src/phase4.css'), 'utf8')
    + readFileSync(path.join(root, 'src/customers.css'), 'utf8');

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
    try { return readFileSync(activePort, 'utf8').split(/\r?\n/)[0] || false; }
    catch { return false; }
  }, 'Chrome did not expose a debugging port', 10_000);
  const debugUrl = `http://127.0.0.1:${port}`;
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(`${origin}/customers`)}`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await waitFor(() => page.evaluate('document.documentElement.dataset.f10CustomersReady === "true"'), 'F10 customer harness did not boot');
  await uiContains(page, 'Ayla A');

  // Start both stale A reads, then switch tenant while they are still pending.
  await control(page, { delayHistoryOnceMs: 700 });
  assert.equal(await call(page, 'click', 'Ayla A'), true);
  await sleep(80);
  await control(page, { delayListOnceMs: 700 });
  assert.equal(await call(page, 'setSearch', 'Ayla'), true);
  assert.equal(await call(page, 'submitSearch'), true);
  await sleep(80);
  assert.equal(await call(page, 'click', 'Salon B'), true);
  await uiContains(page, 'Bora B', 10_000);
  await sleep(900);
  await uiOmits(page, 'Ayla A');
  await uiOmits(page, 'A History Marker');
  assert.equal(state.selected, ids.businessB);

  // Success history, then an explicit history error must not render the empty state.
  assert.equal(await call(page, 'click', 'Bora B'), true);
  await uiContains(page, 'B History Service');
  await control(page, { historyMode: 'errorOnce' });
  assert.equal(await call(page, 'click', 'Bora B'), true);
  await uiContains(page, 'Randevu geçmişi test hatası.');
  await uiOmits(page, 'Bu müşterinin randevu geçmişi yok.');

  // List error, empty and success are mutually exclusive states.
  await control(page, { listMode: 'errorOnce' });
  assert.equal(await call(page, 'setSearch', 'error'), true);
  assert.equal(await call(page, 'submitSearch'), true);
  await uiContains(page, 'Müşteri listesi test hatası.');
  await uiOmits(page, 'Bu aramada müşteri bulunamadı.');

  await control(page, { listMode: 'emptyOnce' });
  assert.equal(await call(page, 'setSearch', 'nobody'), true);
  assert.equal(await call(page, 'submitSearch'), true);
  await uiContains(page, 'Bu aramada müşteri bulunamadı.');
  await uiOmits(page, 'Müşteri listesi test hatası.');

  assert.equal(await call(page, 'setSearch', ''), true);
  assert.equal(await call(page, 'submitSearch'), true);
  await uiContains(page, 'Bora B');

  // Real form create/edit flow.
  assert.equal(await call(page, 'setIn', 'Müşteri oluştur', 'name', 'Ceren Browser'), true);
  assert.equal(await call(page, 'setIn', 'Müşteri oluştur', 'phone', '0555 300 00 03'), true);
  assert.equal(await call(page, 'setIn', 'Müşteri oluştur', 'email', 'ceren@example.invalid'), true);
  assert.equal(await call(page, 'submit', 'Müşteri oluştur'), true);
  await uiContains(page, 'Müşteri kaydı oluşturuldu.');
  await uiContains(page, 'Ceren Browser');
  assert.equal(await call(page, 'setIn', 'Bilgileri güncelle', 'name', 'Ceren Güncel'), true);
  assert.equal(await call(page, 'submit', 'Bilgileri güncelle'), true);
  await uiContains(page, 'Ceren Güncel');
  await uiContains(page, 'Geçmiş randevu snapshotları değiştirilmedi.');

  // 360/390 mobile layout: no horizontal overflow, all workspace links on-screen,
  // and all customer controls meet the 44px touch target contract.
  for (const width of [360, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
    await sleep(80);
    const metrics = await call(page, 'metrics');
    assert.ok(metrics.documentWidth <= width + 1, `${width}px document overflowed: ${metrics.documentWidth}`);
    assert.equal(metrics.shortControls.length, 0, `${width}px has short controls: ${JSON.stringify(metrics.shortControls)}`);
    for (const link of metrics.navLinks) {
      assert.ok(link.left >= -1 && link.right <= width + 1, `${width}px nav link offscreen: ${JSON.stringify(link)}`);
      assert.ok(link.top >= -1 && link.bottom <= 801, `${width}px nav link vertically offscreen: ${JSON.stringify(link)}`);
    }
  }

  // Keyboard focus must stay visible at mobile size and expose a visible outline.
  await page.evaluate('document.body.focus()');
  for (let i = 0; i < 16; i += 1) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(20);
    const focus = await call(page, 'focus');
    if (!focus.tag || focus.tag === 'BODY') continue;
    assert.ok(focus.left >= -1 && focus.right <= 391, `keyboard focus moved horizontally offscreen: ${JSON.stringify(focus)}`);
    assert.ok(focus.top >= -1 && focus.bottom <= 801, `keyboard focus moved vertically offscreen: ${JSON.stringify(focus)}`);
    assert.ok(!focus.outline.startsWith('none') && !focus.outline.endsWith(':0px'), `keyboard focus lacks visible outline: ${JSON.stringify(focus)}`);
  }

  // Switch back to A to prove the reverse tenant direction as well.
  assert.equal(await call(page, 'click', 'Salon A'), true);
  await uiContains(page, 'Ayla A', 10_000);
  await uiOmits(page, 'Bora B');
  assert.equal(state.selected, ids.businessA);

  // Recovery session renders only the password boundary and never asks for customers.
  const customerReadsBeforeRecovery = state.requests.filter((item) => item.method === 'GET' && item.path === '/api/customers').length;
  await control(page, { recovery: true });
  await reload(page);
  await uiContains(page, 'Önce yeni parolanızı belirleyin');
  await uiOmits(page, 'Ayla A');
  await sleep(100);
  const customerReadsAfterRecovery = state.requests.filter((item) => item.method === 'GET' && item.path === '/api/customers').length;
  assert.equal(customerReadsAfterRecovery, customerReadsBeforeRecovery, 'recovery UI requested private customer data');

  const paths = state.requests.map((item) => `${item.method} ${item.path}`);
  for (const expected of ['POST /api/businesses/select', 'POST /api/customers', `PATCH /api/customers/${state.businesses[ids.businessB].customers[0]?.customer_id ?? ''}`]) {
    if (expected.startsWith('PATCH')) continue;
    assert.ok(paths.includes(expected), `browser customer flow missed ${expected}`);
  }
  assert.ok(paths.some((item) => item.startsWith('PATCH /api/customers/')), 'browser customer flow missed customer edit');

  console.log('F10-05 browser passed: A/B stale isolation, CRUD/history, exclusive states, recovery boundary, 360/390 touch/nav and keyboard focus.');
} catch (error) {
  const browserDiagnostics = page?.diagnostics?.length ? `\nBrowser diagnostics:\n${page.diagnostics.join('\n')}` : '';
  const chromeDiagnostics = (() => {
    try { return `\nChrome log:\n${readFileSync(chromeLog, 'utf8').slice(-4_000)}`; }
    catch { return ''; }
  })();
  throw new Error(`${error.message}${browserDiagnostics}${chromeDiagnostics}`);
} finally {
  try { page?.close(); } catch { /* noop */ }
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
  if (chromeFd !== undefined) closeSync(chromeFd);
  rmSync(work, { recursive: true, force: true });
}
