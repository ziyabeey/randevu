import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F16-05 real-Chrome acceptance at 390px: define and close a package, sell it
// on an open ticket, cover the same-visit session from it, reverse that use,
// and refund the unused sessions of a closed sale proportionally across the
// ticket's own cash and card payments. Every amount shown comes from the API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f16-packages-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = {
  user: 'f1650000-0000-4000-8000-000000000601', business: 'f1650000-0000-4000-8000-000000000602',
  membership: 'f1650000-0000-4000-8000-000000000603', customer: 'f1650000-0000-4000-8000-000000000604',
  service: 'f1650000-0000-4000-8000-000000000611', otherService: 'f1650000-0000-4000-8000-000000000612',
  package5: 'f1650000-0000-4000-8000-000000000621',
  openTicket: 'f1650000-0000-4000-8000-000000000631', closedTicket: 'f1650000-0000-4000-8000-000000000632',
  serviceLine: 'f1650000-0000-4000-8000-000000000641', packageLine: 'f1650000-0000-4000-8000-000000000642',
  closedPackageLine: 'f1650000-0000-4000-8000-000000000643',
  soldOpen: 'f1650000-0000-4000-8000-000000000651', soldClosed: 'f1650000-0000-4000-8000-000000000652',
  cash: 'f1650000-0000-4000-8000-000000000661', card: 'f1650000-0000-4000-8000-000000000662',
};
const expiresAt = '2026-12-23T09:00:00.000Z';
const baseLine = {
  sourceAppointmentLineId: null, staffId: null, staffName: null, productId: null, productName: null, productCode: null,
  quantity: 1, returnedQuantity: 0, priceType: 'fixed', currency: 'TRY', pricePolicyVersion: 1,
  finalizedAt: '2026-09-24T09:00:00.000Z', finalizationReason: 'catalog', discountMinor: 0, discountAt: null, discountReason: null,
  packageId: null, packageName: null, soldPackage: null, packageCoverage: null,
};
const state = {
  requests: [],
  definitions: [
    { packageId: ids.package5, businessId: ids.business, serviceId: ids.service, serviceName: 'Lazer Seansı', name: '5 Seans Lazer', sessionCount: 5, validityDays: 90, priceMinor: 100000, unitValueMinor: 20000, currency: 'TRY', active: true, version: 1 },
  ],
  tickets: {
    [ids.openTicket]: {
      ticketId: ids.openTicket, status: 'open', version: 2, createdAt: '2026-09-24T09:00:00.000Z', paymentEvents: [], packageRefundedMinor: 0,
      lines: [{ ...baseLine, lineId: ids.serviceLine, ordinal: 1, sourceType: 'service', serviceId: ids.service, serviceName: 'Lazer Seansı', priceMinMinor: 30000, priceMaxMinor: 30000, finalUnitPriceMinor: 30000 }],
    },
    [ids.closedTicket]: {
      ticketId: ids.closedTicket, status: 'closed', version: 4, createdAt: '2026-09-20T09:00:00.000Z', packageRefundedMinor: 0,
      paymentEvents: [
        { eventId: ids.cash, eventType: 'payment', sourcePaymentEventId: null, method: 'cash', correctionDirection: null, amountMinor: 50000, effectMinor: 50000, reason: null, actorMembershipId: ids.membership, createdAt: '2026-09-20T09:05:00.000Z' },
        { eventId: ids.card, eventType: 'payment', sourcePaymentEventId: null, method: 'card', correctionDirection: null, amountMinor: 50000, effectMinor: 50000, reason: null, actorMembershipId: ids.membership, createdAt: '2026-09-20T09:06:00.000Z' },
      ],
      lines: [{ ...baseLine, lineId: ids.closedPackageLine, ordinal: 1, sourceType: 'package', serviceId: null, serviceName: null, packageId: ids.package5, packageName: '5 Seans Lazer', priceMinMinor: 100000, priceMaxMinor: 100000, finalUnitPriceMinor: 100000, finalizationReason: 'package_catalog_snapshot',
        soldPackage: { customerPackageId: ids.soldClosed, status: 'active', sessionsTotal: 5, sessionsUsed: 2, expiresAt, refundPreviewMinor: 60000, refundValueMinor: null, refundedSessions: null } }],
    },
  },
  customerPackages: [
    { customerPackageId: ids.soldClosed, customerId: ids.customer, serviceId: ids.service, packageName: '5 Seans Lazer', serviceName: 'Lazer Seansı', sessionsTotal: 5, sessionsUsed: 2, sessionsRemaining: 3, currency: 'TRY', status: 'active', expiresAt, expired: false, saleTicketId: ids.closedTicket, saleTicketStatus: 'closed', refundPreviewMinor: 60000 },
  ],
};

function projection(ticket) {
  const lines = ticket.lines.map((line) => ({ ...line, netMinor: line.finalUnitPriceMinor * line.quantity - line.discountMinor }));
  const subtotal = lines.reduce((sum, line) => sum + line.finalUnitPriceMinor * line.quantity, 0);
  const discount = lines.reduce((sum, line) => sum + line.discountMinor, 0);
  const covered = lines.filter((line) => line.packageCoverage).reduce((sum, line) => sum + line.discountMinor, 0);
  const total = subtotal - discount - ticket.packageRefundedMinor;
  const paid = ticket.paymentEvents.reduce((sum, event) => sum + event.effectMinor, 0);
  return {
    ticketId: ticket.ticketId, businessId: ids.business, bookingGroupId: null, customerId: ids.customer, source: 'walk_in',
    status: ticket.status, version: ticket.version, currency: 'TRY', customerName: 'Ayşe Paket', customerPhone: null, customerEmail: null,
    settlementReady: true, estimateMinMinor: subtotal, estimateMaxMinor: subtotal, subtotalMinor: subtotal, discountMinor: discount,
    packageCoveredMinor: covered, returnedMinor: 0, packageRefundedMinor: ticket.packageRefundedMinor, totalMinor: total,
    paymentStatus: paid === 0 ? 'unpaid' : paid < total ? 'partial' : 'paid', paidMinor: paid, balanceMinor: total - paid,
    createdAt: ticket.createdAt, updatedAt: ticket.createdAt, closedAt: ticket.status === 'closed' ? ticket.createdAt : null,
    cancelledAt: null, cancellationReason: null, lines, paymentEvents: ticket.paymentEvents,
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
      memberships: [{ id: ids.membership, business_id: ids.business, role: 'owner', active: true, businesses: { id: ids.business, name: 'Paket Salon', slug: 'paket-salon', timezone: 'Europe/Istanbul' } }],
      activeBusinessId: ids.business, passwordRecovery: false, csrfToken: 'C'.repeat(43),
    });
    if (url.pathname === '/api/customers') return sendJson(response, 200, { customers: [{ customer_id: ids.customer, name: 'Ayşe Paket', phone: null, email: null }], page: { limit: 100, hasMore: false, nextCursor: null } });
    if (url.pathname === '/api/catalog') return sendJson(response, 200, {
      membership: { id: ids.membership, business_id: ids.business, role: 'owner', active: true },
      services: [{ id: ids.service, business_id: ids.business, name: 'Lazer Seansı', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 30000, currency: 'TRY', active: true, category: 'Genel', sort_order: 10, price_type: 'fixed', price_min_minor: 30000, price_max_minor: 30000 }],
      staff: [], assignments: [],
    });
    if (url.pathname === '/api/products') return sendJson(response, 200, { products: [], page: { limit: 100, hasMore: false, nextCursor: null } });
    if (url.pathname === '/api/service-packages' && request.method === 'GET') {
      const all = url.searchParams.get('includeInactive') === 'true';
      return sendJson(response, 200, { packages: state.definitions.filter((item) => all || item.active) });
    }
    if (url.pathname === '/api/service-packages' && request.method === 'POST') {
      const created = { packageId: body.packageId, businessId: ids.business, serviceId: body.serviceId, serviceName: 'Cilt Bakımı', name: body.name, sessionCount: body.sessionCount, validityDays: body.validityDays, priceMinor: body.priceMinor, unitValueMinor: Math.floor((2 * body.priceMinor + body.sessionCount) / (2 * body.sessionCount)), currency: 'TRY', active: true, version: 1 };
      state.definitions.push(created);
      return sendJson(response, 201, { package: created });
    }
    const patch = url.pathname.match(/^\/api\/service-packages\/([^/]+)$/);
    if (patch && request.method === 'PATCH') {
      const item = state.definitions.find((row) => row.packageId === patch[1]);
      assert.equal(body.expectedVersion, item.version);
      Object.assign(item, { name: body.name, sessionCount: body.sessionCount, validityDays: body.validityDays, priceMinor: body.priceMinor, active: body.active, version: item.version + 1 });
      return sendJson(response, 200, { package: item });
    }
    if (url.pathname === '/api/customer-packages') {
      assert.equal(url.searchParams.get('customerId'), ids.customer);
      return sendJson(response, 200, { packages: state.customerPackages });
    }
    if (url.pathname === '/api/tickets' && request.method === 'GET') {
      const status = url.searchParams.get('status');
      return sendJson(response, 200, { tickets: Object.values(state.tickets).filter((item) => status === 'all' || item.status === status).map(projection), page: { limit: 25, hasMore: false, nextCursor: null } });
    }
    const ticketRead = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (ticketRead && request.method === 'GET') return sendJson(response, 200, { ticket: projection(state.tickets[ticketRead[1]]) });
    const packageLine = url.pathname.match(/^\/api\/tickets\/([^/]+)\/package-lines$/);
    if (packageLine && request.method === 'POST') {
      const ticket = state.tickets[packageLine[1]];
      const definition = state.definitions.find((row) => row.packageId === body.packageId);
      assert.equal(body.expectedVersion, ticket.version);
      assert.equal(body.expectedPackageVersion, definition.version);
      ticket.lines.push({ ...baseLine, lineId: ids.packageLine, ordinal: 2, sourceType: 'package', serviceId: null, serviceName: null, packageId: definition.packageId, packageName: definition.name, priceMinMinor: definition.priceMinor, priceMaxMinor: definition.priceMinor, finalUnitPriceMinor: definition.priceMinor, finalizationReason: 'package_catalog_snapshot',
        soldPackage: { customerPackageId: ids.soldOpen, status: 'active', sessionsTotal: definition.sessionCount, sessionsUsed: 0, expiresAt, refundPreviewMinor: definition.priceMinor, refundValueMinor: null, refundedSessions: null } });
      ticket.version += 1;
      state.customerPackages.unshift({ customerPackageId: ids.soldOpen, customerId: ids.customer, serviceId: definition.serviceId, packageName: definition.name, serviceName: 'Lazer Seansı', sessionsTotal: definition.sessionCount, sessionsUsed: 0, sessionsRemaining: definition.sessionCount, currency: 'TRY', status: 'active', expiresAt, expired: false, saleTicketId: ticket.ticketId, saleTicketStatus: 'open', refundPreviewMinor: definition.priceMinor });
      return sendJson(response, 201, { ticket: projection(ticket) });
    }
    const use = url.pathname.match(/^\/api\/tickets\/([^/]+)\/lines\/([^/]+)\/package-usage$/);
    if (use && request.method === 'POST') {
      const ticket = state.tickets[use[1]];
      assert.equal(body.expectedVersion, ticket.version);
      const line = ticket.lines.find((row) => row.lineId === use[2]);
      const owned = state.customerPackages.find((row) => row.customerPackageId === body.customerPackageId);
      Object.assign(line, { discountMinor: line.finalUnitPriceMinor, discountReason: `Paket hakkı: ${owned.packageName}`, packageCoverage: { usageId: 'f1650000-0000-4000-8000-000000000671', customerPackageId: owned.customerPackageId, packageName: owned.packageName, valueMinor: 20000 } });
      owned.sessionsUsed += 1; owned.sessionsRemaining -= 1;
      ticket.version += 1;
      return sendJson(response, 200, { ticket: projection(ticket) });
    }
    const reverse = url.pathname.match(/^\/api\/tickets\/([^/]+)\/lines\/([^/]+)\/package-usage\/reverse$/);
    if (reverse && request.method === 'POST') {
      const ticket = state.tickets[reverse[1]];
      assert.equal(body.expectedVersion, ticket.version);
      const line = ticket.lines.find((row) => row.lineId === reverse[2]);
      const owned = state.customerPackages.find((row) => row.customerPackageId === line.packageCoverage.customerPackageId);
      Object.assign(line, { discountMinor: 0, discountReason: null, packageCoverage: null });
      owned.sessionsUsed -= 1; owned.sessionsRemaining += 1;
      ticket.version += 1;
      return sendJson(response, 200, { ticket: projection(ticket) });
    }
    const refund = url.pathname.match(/^\/api\/customer-packages\/([^/]+)\/refund$/);
    if (refund && request.method === 'POST') {
      const ticket = state.tickets[ids.closedTicket];
      assert.equal(refund[1], ids.soldClosed);
      const sold = ticket.lines[0].soldPackage;
      assert.equal(body.expectedRefundMinor, sold.refundPreviewMinor);
      for (const source of body.sources) {
        ticket.paymentEvents.push({ eventId: `f1650000-0000-4000-8000-00000000068${ticket.paymentEvents.length}`, eventType: 'refund', sourcePaymentEventId: source.paymentEventId, method: source.paymentEventId === ids.cash ? 'cash' : 'card', correctionDirection: null, amountMinor: source.amountMinor, effectMinor: -source.amountMinor, reason: body.reason, actorMembershipId: ids.membership, createdAt: '2026-09-24T12:00:00.000Z' });
      }
      Object.assign(sold, { status: 'refunded', refundValueMinor: sold.refundPreviewMinor, refundedSessions: 3, refundPreviewMinor: null });
      ticket.packageRefundedMinor = 60000;
      const owned = state.customerPackages.find((row) => row.customerPackageId === ids.soldClosed);
      Object.assign(owned, { status: 'refunded', sessionsRemaining: 0, refundPreviewMinor: null });
      return sendJson(response, 201, { ticket: projection(ticket) });
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
  return page.evaluate(`window.__f1605[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function scopeContains(page, scope, text, timeoutMs = 7_000) {
  return waitFor(async () => (await call(page, 'text', scope)).includes(text), `${scope} did not contain ${text}`, timeoutMs);
}
const posts = (pathname) => state.requests.filter((item) => item.method !== 'GET' && item.path === pathname);

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
      lib: { entry: path.join(root, 'tests/browser/f16-packages.tsx'), formats: ['es'] },
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
  await waitFor(() => page.evaluate('document.documentElement.dataset.f1605Ready === "true"'), 'F16-05 harness did not boot');

  // Package definitions: list, create with a TL price, then close one for sale.
  await scopeContains(page, 'packages', '5 Seans Lazer');
  await scopeContains(page, 'packages', 'seans değeri');
  assert.equal(await call(page, 'setField', 'packages', '.service-package-form.create select[name="serviceId"]', ids.otherService), true);
  assert.equal(await call(page, 'setField', 'packages', '.service-package-form.create input[name="name"]', '3 Seans Bakım'), true);
  assert.equal(await call(page, 'setField', 'packages', '.service-package-form.create input[name="sessionCount"]', '3'), true);
  assert.equal(await call(page, 'setField', 'packages', '.service-package-form.create input[name="validityDays"]', '60'), true);
  assert.equal(await call(page, 'setField', 'packages', '.service-package-form.create input[name="price"]', '900,50'), true);
  assert.equal(await call(page, 'click', 'packages', 'Paketi ekle'), true);
  await scopeContains(page, 'packages', '3 Seans Bakım');
  const create = posts('/api/service-packages')[0];
  assert.equal(create.body.priceMinor, 90050);
  assert.equal(create.body.sessionCount, 3);
  assert.equal(create.body.validityDays, 60);
  assert.equal(create.body.serviceId, ids.otherService);
  assert.match(create.body.packageId, /^[0-9a-f-]{36}$/);
  assert.equal(create.csrf, 'C'.repeat(43));
  const created = state.definitions.find((item) => item.name === '3 Seans Bakım');
  assert.equal(await call(page, 'click', 'packages', 'Satışa kapat', `.service-package-list > li:nth-child(2)`), true);
  await waitFor(() => posts(`/api/service-packages/${created.packageId}`).length === 1, 'close-for-sale PATCH missing');
  assert.deepEqual(posts(`/api/service-packages/${created.packageId}`)[0].body, { name: '3 Seans Bakım', sessionCount: 3, validityDays: 60, priceMinor: 90050, active: false, expectedVersion: 1 });
  await scopeContains(page, 'packages', 'Satışa kapalı');

  // Sell the package on the open ticket; the sale is its own line.
  await scopeContains(page, 'cashier', 'Lazer Seansı');
  await waitFor(async () => (await call(page, 'optionTexts', 'cashier', '.ticket-add-package select')).some((text) => text.includes('5 Seans Lazer')), 'package sale option missing');
  assert.equal(await call(page, 'setField', 'cashier', '.ticket-add-package select', ids.package5), true);
  assert.equal(await call(page, 'click', 'cashier', 'Paket sat'), true);
  await scopeContains(page, 'cashier', 'Paket satışı · 5 seans · 0 kullanıldı');
  const sale = posts(`/api/tickets/${ids.openTicket}/package-lines`)[0];
  assert.deepEqual(sale.body, { packageId: ids.package5, expectedVersion: 2, expectedPackageVersion: 1 });
  assert.ok(sale.key && sale.key.length >= 8, 'package sale needs an idempotency key');

  // The same-visit session is covered by the new package (its own sale ticket).
  await waitFor(async () => (await call(page, 'optionTexts', 'cashier', '.ticket-package-use select')).some((text) => text.includes('5 seans kaldı')), 'usable package option missing');
  assert.equal(await call(page, 'setField', 'cashier', '.ticket-package-use select', ids.soldOpen), true);
  assert.equal(await call(page, 'click', 'cashier', 'Paketten düş'), true);
  await scopeContains(page, 'cashier', 'Paket hakkı: 5 Seans Lazer');
  const useRequest = posts(`/api/tickets/${ids.openTicket}/lines/${ids.serviceLine}/package-usage`)[0];
  assert.deepEqual(useRequest.body, { customerPackageId: ids.soldOpen, expectedVersion: 3 });
  const totals = await call(page, 'text', 'cashier');
  assert.match(totals, /Paket hakkı\s*₺300,00/);
  assert.match(totals, /Toplam\s*₺1\.000,00/);
  assert.equal((await call(page, 'text', 'cashier')).includes('İskontoyu kaydet'), false, 'covered line still offers a manual discount');

  // Reverse the use with a reason: the session returns and the line is billable again.
  assert.equal(await call(page, 'setField', 'cashier', '.ticket-package-reverse input[name="reason"]', 'Yanlış satır'), true);
  assert.equal(await call(page, 'click', 'cashier', 'Paket kullanımını geri al'), true);
  await waitFor(async () => !(await call(page, 'text', 'cashier')).includes('Paket hakkı: 5 Seans Lazer'), 'reversal did not clear the coverage');
  assert.deepEqual(posts(`/api/tickets/${ids.openTicket}/lines/${ids.serviceLine}/package-usage/reverse`)[0].body, { reason: 'Yanlış satır', expectedVersion: 4 });
  await scopeContains(page, 'cashier', 'Müşteri paketleri');

  // Closed sale: refund the 3 unused sessions (600 TL) across cash 500 + card 100.
  assert.equal(await call(page, 'setStatus', 'closed'), true);
  await waitFor(async () => (await call(page, 'clickTicket', 'Randevusuz · closed')), 'closed sale ticket not listed');
  await scopeContains(page, 'cashier', 'Kalan seansları iade et');
  await scopeContains(page, 'cashier', '3 kullanılmayan seans · iade ₺600,00 · Nakit ₺500,00 + Kart ₺100,00');
  assert.equal(await call(page, 'setField', 'cashier', '.ticket-package-refund input[name="reason"]', 'Taşındı'), true);
  assert.equal(await call(page, 'click', 'cashier', 'Kalan seansları iade et'), true);
  await scopeContains(page, 'cashier', 'Paket iadesi');
  const refundRequest = posts(`/api/customer-packages/${ids.soldClosed}/refund`)[0];
  assert.deepEqual(refundRequest.body, {
    expectedRefundMinor: 60000,
    sources: [{ paymentEventId: ids.cash, amountMinor: 50000 }, { paymentEventId: ids.card, amountMinor: 10000 }],
    reason: 'Taşındı',
  });
  await scopeContains(page, 'cashier', 'iade edildi');
  assert.equal((await call(page, 'text', 'cashier')).includes('Kalan seansları iade et'), false, 'refund stays offered after refund');

  const layout = await call(page, 'layout');
  assert.ok(layout.overflow <= 1, `F16-05 surfaces overflow at 390px by ${layout.overflow}px`);
  assert.deepEqual(layout.shortTargets, [], 'F16-05 touch targets below 44px');
  console.log('F16-05 Chrome acceptance passed: 390px package definitions, ticket sale, same-visit coverage and reversal, proportional split refund.');
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
