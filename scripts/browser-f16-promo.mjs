import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F16-06 real-Chrome acceptance at 390px: a customer checks a campaign code on
// the booking form, the confirmation reserves it through the management link,
// the manage page attaches a code, the salon defines a scoped code, and the
// cashier applies and removes a code on an open ticket. The browser never sends
// a price or discount; every amount shown comes from the API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f16-promo-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = {
  user: 'f1680000-0000-4000-8000-000000000601', business: 'f1680000-0000-4000-8000-000000000602',
  membership: 'f1680000-0000-4000-8000-000000000603', customer: 'f1680000-0000-4000-8000-000000000604',
  service: 'f1680000-0000-4000-8000-000000000611', otherService: 'f1680000-0000-4000-8000-000000000612',
  openTicket: 'f1680000-0000-4000-8000-000000000631', serviceLine: 'f1680000-0000-4000-8000-000000000641',
};
const state = {
  requests: [],
  codes: [],
  managePromo: null,
  ticket: {
    ticketId: ids.openTicket, status: 'open', version: 2, promo: null,
    lines: [{ lineId: ids.serviceLine, ordinal: 1, sourceType: 'service', sourceAppointmentLineId: null, serviceId: ids.service, staffId: null,
      serviceName: 'Kesim', staffName: null, productId: null, productName: null, productCode: null, quantity: 1, returnedQuantity: 0,
      priceType: 'fixed', priceMinMinor: 15000, priceMaxMinor: 15000, currency: 'TRY', pricePolicyVersion: 1, finalUnitPriceMinor: 15000,
      discountMinor: 0, finalizedAt: '2026-09-24T09:00:00.000Z', finalizationReason: 'catalog', discountAt: null, discountReason: null,
      packageId: null, packageName: null, soldPackage: null, packageCoverage: null, promoDiscountMinor: null }],
  },
};

function projection() {
  const t = state.ticket;
  const promoMinor = t.promo ? (t.promo.kind === 'percent' ? Math.floor(15000 * t.promo.percentBps / 10000) : Math.min(t.promo.amountMinor, 15000)) : 0;
  const lines = t.lines.map((line) => ({ ...line, netMinor: line.finalUnitPriceMinor - line.discountMinor }));
  return {
    ticketId: t.ticketId, businessId: ids.business, bookingGroupId: null, customerId: ids.customer, source: 'walk_in', status: t.status,
    version: t.version, currency: 'TRY', customerName: 'Ayşe Kod', customerPhone: null, customerEmail: null, settlementReady: true,
    estimateMinMinor: 15000, estimateMaxMinor: 15000, subtotalMinor: 15000, discountMinor: 0, packageCoveredMinor: 0,
    promoDiscountMinor: promoMinor, promo: t.promo, returnedMinor: 0, packageRefundedMinor: 0, totalMinor: 15000 - promoMinor,
    paymentStatus: 'unpaid', paidMinor: 0, balanceMinor: 15000 - promoMinor, createdAt: '2026-09-24T09:00:00.000Z',
    updatedAt: '2026-09-24T09:00:00.000Z', closedAt: null, cancelledAt: null, cancellationReason: null, lines, paymentEvents: [],
  };
}

let testJs;
let testCss;
const sockets = new Set();
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(testJs); return; }
    if (url.pathname === '/style.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(testCss); return; }
    if (url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
      return;
    }
    const body = request.method === 'GET' ? null : await bodyOf(request);
    state.requests.push({ method: request.method, path: url.pathname, search: url.search, body, csrf: request.headers['x-yzt-csrf'] ?? null, key: request.headers['idempotency-key'] ?? null });
    if (url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: 'C'.repeat(43) });
    if (url.pathname === '/api/session') return sendJson(response, 200, {
      user: { id: ids.user, email: 'owner@example.test', fullName: 'Owner' },
      memberships: [{ id: ids.membership, business_id: ids.business, role: 'owner', active: true, businesses: { id: ids.business, name: 'Kod Salon', slug: 'salon-a', timezone: 'Europe/Istanbul' } }],
      activeBusinessId: ids.business, passwordRecovery: false, csrfToken: 'C'.repeat(43),
    });
    if (url.pathname === '/api/public/business/salon-a/promo') {
      const code = url.searchParams.get('code')?.toUpperCase();
      if (code === 'YAZ20') return sendJson(response, 200, { promo: { code: 'YAZ20', kind: 'percent', percentBps: 2000, amountMinor: null, currency: 'TRY', endsAt: null, applicable: true, scoped: false } });
      if (code === 'BOYA50') return sendJson(response, 200, { promo: { code: 'BOYA50', kind: 'fixed', percentBps: null, amountMinor: 5000, currency: 'TRY', endsAt: null, applicable: false, scoped: true } });
      return sendJson(response, 404, { error: { code: 'PROMO_NOT_FOUND', message: 'Kampanya kodu bulunamadı veya aktif değil.' } });
    }
    if (url.pathname === '/api/manage/promo/view') {
      assert.equal(body.token, 'N'.repeat(43));
      return sendJson(response, 200, { promo: state.managePromo ?? { code: null, kind: null, percentBps: null, amountMinor: null, currency: null, status: null, attachable: true } });
    }
    if (url.pathname === '/api/manage/promo') {
      if (body.token === 'M'.repeat(43)) return sendJson(response, 201, { promo: { code: 'YAZ20', kind: 'percent', percentBps: 2000, amountMinor: null, currency: 'TRY', status: 'reserved', attachable: false } });
      assert.equal(body.token, 'N'.repeat(43));
      if (body.code.toUpperCase() !== 'YAZ20') return sendJson(response, 409, { error: { code: 'PROMO_EXHAUSTED', message: 'Bu kampanya kodunun kullanım hakkı doldu.' } });
      state.managePromo = { code: 'YAZ20', kind: 'percent', percentBps: 2000, amountMinor: null, currency: 'TRY', status: 'reserved', attachable: false };
      return sendJson(response, 201, { promo: state.managePromo });
    }
    if (url.pathname === '/api/customers') return sendJson(response, 200, { customers: [{ customer_id: ids.customer, name: 'Ayşe Kod', phone: null, email: null }], page: { limit: 100, hasMore: false, nextCursor: null } });
    if (url.pathname === '/api/catalog') return sendJson(response, 200, {
      membership: { id: ids.membership, business_id: ids.business, role: 'owner', active: true },
      services: [{ id: ids.service, business_id: ids.business, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 15000, currency: 'TRY', active: true, category: 'Genel', sort_order: 10, price_type: 'fixed', price_min_minor: 15000, price_max_minor: 15000 }],
      staff: [], assignments: [],
    });
    if (url.pathname === '/api/products') return sendJson(response, 200, { products: [], page: { limit: 100, hasMore: false, nextCursor: null } });
    if (url.pathname === '/api/service-packages') return sendJson(response, 200, { packages: [] });
    if (url.pathname === '/api/customer-packages') return sendJson(response, 200, { packages: [] });
    if (url.pathname === '/api/promo-codes' && request.method === 'GET') return sendJson(response, 200, { promoCodes: state.codes });
    if (url.pathname === '/api/promo-codes' && request.method === 'POST') {
      const created = { promoId: body.promoId, businessId: ids.business, code: body.code.toUpperCase(), kind: body.kind, percentBps: body.percentBps, amountMinor: body.amountMinor, currency: 'TRY',
        startsAt: body.startsAt, endsAt: body.endsAt, usageLimit: body.usageLimit, serviceIds: body.serviceIds, serviceNames: body.serviceIds.length ? ['Boya'] : [],
        reservedCount: 0, consumedCount: 0, active: true, version: 1 };
      state.codes.push(created);
      return sendJson(response, 201, { promoCode: created });
    }
    const patch = url.pathname.match(/^\/api\/promo-codes\/([^/]+)$/);
    if (patch && request.method === 'PATCH') {
      const item = state.codes.find((row) => row.promoId === patch[1]);
      assert.equal(body.expectedVersion, item.version);
      Object.assign(item, { active: body.active, version: item.version + 1 });
      return sendJson(response, 200, { promoCode: item });
    }
    if (url.pathname === '/api/tickets' && request.method === 'GET') return sendJson(response, 200, { tickets: [projection()], page: { limit: 25, hasMore: false, nextCursor: null } });
    if (url.pathname === `/api/tickets/${ids.openTicket}` && request.method === 'GET') return sendJson(response, 200, { ticket: projection() });
    if (url.pathname === `/api/tickets/${ids.openTicket}/promo` && request.method === 'POST') {
      assert.equal(body.expectedVersion, state.ticket.version);
      if (body.code.toUpperCase() !== 'YAZ20') return sendJson(response, 409, { error: { code: 'PROMO_NOT_APPLICABLE', message: 'Kampanya bu adisyondaki hizmetleri kapsamıyor.' } });
      state.ticket.promo = { redemptionId: 'f1680000-0000-4000-8000-000000000651', code: 'YAZ20', kind: 'percent', percentBps: 2000, amountMinor: null, source: 'ticket', status: 'reserved' };
      state.ticket.version += 1;
      return sendJson(response, 200, { ticket: projection() });
    }
    if (url.pathname === `/api/tickets/${ids.openTicket}/promo/remove` && request.method === 'POST') {
      assert.equal(body.expectedVersion, state.ticket.version);
      state.ticket.promo = null;
      state.ticket.version += 1;
      return sendJson(response, 200, { ticket: projection() });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `fixture missing ${request.method} ${url.pathname}` } });
  } catch (error) {
    return sendJson(response, 500, { error: { message: error instanceof Error ? error.message : 'fixture error' } });
  }
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

async function waitFor(read, message, timeoutMs = 7_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(60);
  }
  throw new Error(`${message}${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
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
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  send(method, params = {}, timeoutMs = 7_000) {
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
  async evaluate(expression, timeoutMs = 7_000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

function call(page, method, ...args) {
  return page.evaluate(`window.__f1606[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function scopeContains(page, scope, text, timeoutMs = 7_000) {
  return waitFor(async () => (await call(page, 'text', scope)).includes(text), `${scope} did not contain ${text}`, timeoutMs);
}
const requestsTo = (pathname, method = 'POST') => state.requests.filter((item) => item.method === method && item.path === pathname);

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
      cssCodeSplit: false,
      lib: { entry: path.join(root, 'tests/browser/f16-promo.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js', assetFileNames: 'style.css' } },
    },
  });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  testCss = readFileSync(path.join(bundleDir, 'style.css'));
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
  const debugUrl = `http://127.0.0.1:${port}`;
  const target = await (await fetch(`${debugUrl}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Page.navigate', { url: `${origin}/harness?ticketId=${ids.openTicket}` });
  await waitFor(() => page.evaluate('document.documentElement.dataset.f1606Ready === "true"'), 'F16-06 harness did not boot');

  // Booking form: an unknown code is explained, an out-of-scope code is not
  // accepted, and a valid code shows server terms without any amount math.
  assert.equal(await call(page, 'setField', 'public', 'input[name="promoCode"]', 'YOKBOYLE'), true);
  assert.equal(await call(page, 'click', 'public', 'Kodu kontrol et'), true);
  await scopeContains(page, 'public', 'Kampanya kodu bulunamadı');
  assert.equal(await call(page, 'checkedCode'), null);
  assert.equal(await call(page, 'setField', 'public', 'input[name="promoCode"]', 'boya50'), true);
  assert.equal(await call(page, 'click', 'public', 'Kodu kontrol et'), true);
  await scopeContains(page, 'public', 'seçtiğiniz hizmetleri kapsamıyor');
  assert.equal(await call(page, 'checkedCode'), null);
  assert.equal(await call(page, 'setField', 'public', 'input[name="promoCode"]', 'yaz20'), true);
  assert.equal(await call(page, 'click', 'public', 'Kodu kontrol et'), true);
  await scopeContains(page, 'public', 'YAZ20: %20 indirim');
  await scopeContains(page, 'public', 'adisyonda uygulanır');
  assert.equal(await call(page, 'checkedCode'), 'YAZ20');
  const preview = state.requests.filter((item) => item.path === '/api/public/business/salon-a/promo').at(-1);
  assert.equal(new URLSearchParams(preview.search).get('serviceIds'), ids.service);

  // Confirmation: the checked code is reserved once through the booking's own management token.
  await scopeContains(page, 'attach', 'Kampanya kodunuz ayrıldı: YAZ20');
  const attaches = requestsTo('/api/manage/promo').filter((item) => item.body.token === 'M'.repeat(43));
  assert.equal(attaches.length, 1, 'confirmation must attach exactly once');
  assert.deepEqual(attaches[0].body, { token: 'M'.repeat(43), code: 'YAZ20' });
  assert.equal(attaches[0].csrf, null, 'capability promo must not depend on a cookie CSRF session');

  // Manage page: a refused code is explained; a valid one is reserved.
  await scopeContains(page, 'manage', 'Kampanya kodu');
  assert.equal(await call(page, 'setField', 'manage', 'input', 'ESKI10'), true);
  assert.equal(await call(page, 'click', 'manage', 'Kodu ekle'), true);
  await scopeContains(page, 'manage', 'kullanım hakkı doldu');
  assert.equal(await call(page, 'setField', 'manage', 'input', 'YAZ20'), true);
  assert.equal(await call(page, 'click', 'manage', 'Kodu ekle'), true);
  await scopeContains(page, 'manage', 'Kod randevunuz için ayrıldı');

  // Salon definitions: a fixed TL code scoped to one service, then closed.
  await scopeContains(page, 'codes', 'Henüz kampanya kodu yok.');
  assert.equal(await call(page, 'setField', 'codes', 'input[name="code"]', 'boya50'), true);
  assert.equal(await call(page, 'setField', 'codes', '.promo-code-form select', 'fixed'), true);
  assert.equal(await call(page, 'setField', 'codes', 'input[name="value"]', '50'), true);
  assert.equal(await call(page, 'setField', 'codes', 'input[name="usageLimit"]', '100'), true);
  assert.equal(await call(page, 'check', 'codes', `input[name="serviceIds"][value="${ids.otherService}"]`), true);
  assert.equal(await call(page, 'click', 'codes', 'Kampanyayı ekle'), true);
  await scopeContains(page, 'codes', 'BOYA50');
  const created = requestsTo('/api/promo-codes')[0];
  assert.equal(created.body.kind, 'fixed');
  assert.equal(created.body.amountMinor, 5000);
  assert.equal(created.body.percentBps, null);
  assert.equal(created.body.usageLimit, 100);
  assert.deepEqual(created.body.serviceIds, [ids.otherService]);
  assert.match(created.body.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(created.csrf, 'C'.repeat(43));
  assert.equal(await call(page, 'click', 'codes', 'Kampanyayı kapat'), true);
  await scopeContains(page, 'codes', 'Kapalı');
  assert.equal(requestsTo(`/api/promo-codes/${created.body.promoId}`, 'PATCH')[0].body.active, false);

  // Cashier: apply a code (server total), then remove it with a reason.
  await scopeContains(page, 'cashier', 'Kesim');
  assert.equal(await call(page, 'setField', 'cashier', '.ticket-promo input[name="code"]', 'yaz20'), true);
  assert.equal(await call(page, 'click', 'cashier', 'Kodu uygula'), true);
  await scopeContains(page, 'cashier', 'Kampanya (YAZ20)');
  const apply = requestsTo(`/api/tickets/${ids.openTicket}/promo`)[0];
  assert.deepEqual(apply.body, { code: 'yaz20', expectedVersion: 2 });
  assert.ok(apply.key && apply.key.length >= 8);
  assert.match(await call(page, 'text', 'cashier'), /Toplam\s*₺120,00/);
  assert.equal(await call(page, 'setField', 'cashier', '.ticket-promo input[name="reason"]', 'Yanlış kod'), true);
  assert.equal(await call(page, 'click', 'cashier', 'Kampanyayı kaldır'), true);
  await waitFor(async () => !(await call(page, 'text', 'cashier')).includes('Kampanya (YAZ20)'), 'promo removal did not clear the total row');
  assert.deepEqual(requestsTo(`/api/tickets/${ids.openTicket}/promo/remove`)[0].body, { reason: 'Yanlış kod', expectedVersion: 3 });

  const layout = await call(page, 'layout');
  assert.ok(layout.overflow <= 1, `F16-06 surfaces overflow at 390px by ${layout.overflow}px`);
  assert.deepEqual(layout.shortTargets, [], 'F16-06 touch targets below 44px');
  console.log('F16-06 Chrome acceptance passed: 390px booking code check, one-shot capability reservation, manage attach, scoped salon code and cashier apply/remove.');
} finally {
  page?.close();
  chrome?.kill('SIGKILL');
  if (chromeFd !== undefined) {
    try { await new Promise((resolve) => chrome?.once('exit', resolve)); } catch {}
  }
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve)).catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
