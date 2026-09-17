import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f10-customers-conflict-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const csrfToken = 'E'.repeat(43);

const ids = {
  user: 'ea000000-0000-4000-8000-000000000001',
  businessA: 'eb000000-0000-4000-8000-000000000001',
  businessB: 'eb000000-0000-4000-8000-000000000002',
  membershipA: 'ec000000-0000-4000-8000-000000000001',
  membershipB: 'ec000000-0000-4000-8000-000000000002',
  customerA: 'ed000000-0000-4000-8000-000000000001',
  customerB: 'ed000000-0000-4000-8000-000000000002',
};

const state = {
  selected: ids.businessB,
  conflictOnce: true,
  requests: [],
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
      histories: {},
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
          appointment_id: 'ee000000-0000-4000-8000-000000000002',
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
    if (url.pathname === '/customers') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>`);
      return;
    }

    const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readJson(request);
    state.requests.push({ method: request.method, path: url.pathname, selected: state.selected, body });

    if (request.method === 'GET' && url.pathname === '/api/session') {
      return sendJson(response, 200, {
        user: { id: ids.user, email: 'conflict-owner@example.invalid', fullName: 'Conflict Owner' },
        memberships: Object.values(state.businesses).map(membership),
        activeBusinessId: state.selected,
        passwordRecovery: false,
        csrfToken,
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/customers') {
      const business = state.businesses[state.selected];
      return sendJson(response, 200, { membership: membership(business), customers: business.customers, page: pageInfo() });
    }

    const groupHistoryMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/group-history$/);
    if (request.method === 'GET' && groupHistoryMatch) {
      const business = state.businesses[state.selected];
      if (!business.customers.some((item) => item.customer_id === groupHistoryMatch[1])) {
        return sendJson(response, 404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri bulunamadı.' } });
      }
      const rows = business.histories[groupHistoryMatch[1]] ?? [];
      return sendJson(response, 200, { bookings: rows.map(legacyHistoryBooking), page: pageInfo() });
    }

    const historyMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/history$/);
    if (request.method === 'GET' && historyMatch) {
      const business = state.businesses[state.selected];
      if (!business.customers.some((item) => item.customer_id === historyMatch[1])) {
        return sendJson(response, 404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri bulunamadı.' } });
      }
      return sendJson(response, 200, { appointments: business.histories[historyMatch[1]] ?? [], page: pageInfo() });
    }

    const updateMatch = url.pathname.match(/^\/api\/customers\/([^/]+)$/);
    if (request.method === 'PATCH' && updateMatch) {
      const business = state.businesses[state.selected];
      const customer = business.customers.find((item) => item.customer_id === updateMatch[1]);
      if (!customer) return sendJson(response, 404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri bulunamadı.' } });
      if (state.conflictOnce) {
        state.conflictOnce = false;
        assert.equal(state.selected, ids.businessB, 'conflict fixture escaped tenant B');
        assert.equal(body.expectedUpdatedAt, '2026-09-02T09:00:00.000Z', 'browser edit did not carry the selected version');
        assert.equal(body.name, 'Bora Stale', 'browser edit did not carry the attempted stale name');
        Object.assign(customer, {
          name: 'Bora Sunucu',
          notes: 'Sunucu authoritative',
          updated_at: '2026-09-14T12:05:00.000Z',
        });
        return sendJson(response, 409, {
          error: {
            code: 'CUSTOMER_VERSION_CONFLICT',
            message: 'Müşteri kaydı başka bir işlemde değişti. Güncel kayıt yeniden yüklendi.',
          },
        });
      }
      throw new Error('conflict browser fixture received an unexpected second PATCH');
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
        if (message.method === 'Runtime.exceptionThrown') {
          this.diagnostics.push(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? 'browser exception');
        }
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

async function selectedNameInput(page) {
  return page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Bilgileri güncelle'));
    return button?.closest('form')?.querySelector('[name="name"]')?.value ?? null;
  })()`);
}

let chrome;
let chromeFd;
let page;
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
  const origin = `http://127.0.0.1:${server.address().port}`;

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

  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${origin}/customers`)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5_000),
  })).json();
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await waitFor(() => page.evaluate('document.documentElement.dataset.f10CustomersReady === "true"'), 'F10 customer conflict harness did not boot');

  await uiContains(page, 'Bora B');
  await uiOmits(page, 'Ayla A');
  assert.equal(await call(page, 'click', 'Bora B'), true);
  await uiContains(page, 'B History Service');
  await uiContains(page, 'B History Marker');
  assert.equal(await selectedNameInput(page), 'Bora B');

  assert.equal(await call(page, 'setIn', 'Bilgileri güncelle', 'name', 'Bora Stale'), true);
  assert.equal(await call(page, 'setIn', 'Bilgileri güncelle', 'notes', 'Stale browser edit'), true);
  assert.equal(await call(page, 'submit', 'Bilgileri güncelle'), true);

  await uiContains(page, 'Müşteri kaydı başka bir işlemde değişti. Güncel kayıt yeniden yüklendi.');
  await uiContains(page, 'Bora Sunucu');
  await uiOmits(page, 'Ayla A');
  await uiOmits(page, 'A History Marker');
  await uiContains(page, 'B History Service');
  await uiContains(page, 'B History Marker');
  await waitFor(async () => (await selectedNameInput(page)) === 'Bora Sunucu', 'authoritative customer name did not replace stale form value');

  assert.equal(state.selected, ids.businessB, 'optimistic conflict changed tenant selection');
  assert.equal(state.conflictOnce, false, 'optimistic conflict fixture was not exercised');
  assert.equal(state.businesses[ids.businessB].customers[0].name, 'Bora Sunucu');
  assert.equal(state.businesses[ids.businessB].histories[ids.customerB][0].customer_name_snapshot, 'B History Marker');

  const customerReads = state.requests.filter((item) => item.method === 'GET' && item.path === '/api/customers');
  const historyReads = state.requests.filter((item) => item.method === 'GET' && item.path === `/api/customers/${ids.customerB}/group-history`);
  const patches = state.requests.filter((item) => item.method === 'PATCH' && item.path === `/api/customers/${ids.customerB}`);
  assert.ok(customerReads.length >= 2, `conflict recovery did not reload authoritative list: ${customerReads.length}`);
  assert.ok(historyReads.length >= 1, 'conflict browser flow did not load snapshot history');
  assert.equal(patches.length, 1, `conflict browser flow sent unexpected PATCH count: ${patches.length}`);

  console.log('F10-05 browser conflict passed: 409 reload restored authoritative tenant-B customer state and preserved appointment snapshot history.');
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
