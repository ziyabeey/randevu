import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F16-08 real-Chrome acceptance at 390px: the account menu shows the signed-in
// account, business, role and the plan read from /api/account (pilot, then a
// cancelled plan shown as read-only), and its password and sign-out actions
// reach the shell. One language switch changes the Randevu panel header, the
// SalonApp "Diğer" tab and the customer reviews (text and dates) together; the
// choice survives a reload. SalonApp actions are real routes except the
// explicitly disabled "Destek", and "Yeni paket satışı" opens a package sale
// ticket through the F16-05 route.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f16-account-language-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = {
  user: 'f1680000-0000-4000-8000-000000000801', business: 'f1680000-0000-4000-8000-000000000802',
  membership: 'f1680000-0000-4000-8000-000000000803', customer: 'f1680000-0000-4000-8000-000000000804',
  service: 'f1680000-0000-4000-8000-000000000811', package5: 'f1680000-0000-4000-8000-000000000821',
  saleTicket: 'f1680000-0000-4000-8000-000000000831', saleLine: 'f1680000-0000-4000-8000-000000000841',
  sold: 'f1680000-0000-4000-8000-000000000851',
};
const state = { requests: [], planStatus: 'pilot', tickets: {} };
const definition = { packageId: ids.package5, businessId: ids.business, serviceId: ids.service, serviceName: 'Lazer Seansı', name: '5 Seans Lazer', sessionCount: 5, validityDays: 90, priceMinor: 100000, unitValueMinor: 20000, currency: 'TRY', active: true, version: 1 };

function account() {
  const cancelled = state.planStatus === 'cancelled';
  return {
    businessId: ids.business, businessName: 'Dil Salon', membershipId: ids.membership, role: 'owner', email: 'owner@example.test',
    financialPermissions: ['expenses_write', 'financial_reports_read', 'inventory_write', 'payments_write', 'pricing_adjustments_write'],
    plan: { planKey: 'pilot', status: state.planStatus, periodEnd: cancelled ? '2026-09-30T21:00:00.000Z' : null, access: cancelled ? 'read_only' : 'full' },
  };
}
function projection(ticket) {
  const total = ticket.lines.reduce((sum, line) => sum + line.finalUnitPriceMinor, 0);
  return {
    ticketId: ticket.ticketId, businessId: ids.business, bookingGroupId: null, customerId: ids.customer, source: 'walk_in',
    status: 'open', version: 1, currency: 'TRY', customerName: 'Ayşe Dil', customerPhone: null, customerEmail: null,
    settlementReady: true, estimateMinMinor: total, estimateMaxMinor: total, subtotalMinor: total, discountMinor: 0,
    packageCoveredMinor: 0, returnedMinor: 0, packageRefundedMinor: 0, promoDiscountMinor: 0, promo: null, totalMinor: total,
    paymentStatus: 'unpaid', paidMinor: 0, balanceMinor: total, createdAt: '2026-09-24T09:00:00.000Z', updatedAt: '2026-09-24T09:00:00.000Z',
    closedAt: null, cancelledAt: null, cancellationReason: null, lines: ticket.lines.map((line) => ({ ...line, netMinor: line.finalUnitPriceMinor })), paymentEvents: [],
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
    if (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.js')) {
      const file = path.join(bundleDir, path.basename(url.pathname));
      response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(readFileSync(file)); return;
    }
    if (url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="tr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
      return;
    }
    const body = request.method === 'GET' ? null : await bodyOf(request);
    state.requests.push({ method: request.method, path: url.pathname, search: url.search, body, csrf: request.headers['x-yzt-csrf'] ?? null, key: request.headers['idempotency-key'] ?? null });
    if (url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: 'C'.repeat(43) });
    if (url.pathname === '/api/session') return sendJson(response, 200, {
      user: { id: ids.user, email: 'owner@example.test', fullName: 'Owner' },
      memberships: [{ id: ids.membership, business_id: ids.business, role: 'owner', active: true, businesses: { id: ids.business, name: 'Dil Salon', slug: 'dil-salon', timezone: 'Europe/Istanbul' } }],
      activeBusinessId: ids.business, passwordRecovery: false, csrfToken: 'C'.repeat(43),
    });
    if (url.pathname === '/api/account') return sendJson(response, 200, { account: account() });
    if (url.pathname === '/api/public/business/dil-salon/reviews') return sendJson(response, 200, {
      reviews: [{ displayName: 'Ayşe D.', rating: 5, comment: 'Çok memnun kaldım.', publishedAt: '2026-09-24T10:00:00.000Z' }],
      summary: { count: 1, average: 5 },
    });
    if (url.pathname === '/api/customers') return sendJson(response, 200, { customers: [{ customer_id: ids.customer, name: 'Ayşe Dil', phone: null, email: null }], page: { limit: 100, hasMore: false, nextCursor: null } });
    if (url.pathname === '/api/catalog') return sendJson(response, 200, {
      membership: { id: ids.membership, business_id: ids.business, role: 'owner', active: true },
      services: [{ id: ids.service, business_id: ids.business, name: 'Lazer Seansı', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 30000, currency: 'TRY', active: true, category: 'Genel', sort_order: 10, price_type: 'fixed', price_min_minor: 30000, price_max_minor: 30000 }],
      staff: [], assignments: [],
    });
    if (url.pathname === '/api/products') return sendJson(response, 200, { products: [], page: { limit: 100, hasMore: false, nextCursor: null } });
    if (url.pathname === '/api/service-packages') return sendJson(response, 200, { packages: [definition] });
    if (url.pathname === '/api/customer-packages') return sendJson(response, 200, { packages: [] });
    if (url.pathname === '/api/tickets' && request.method === 'GET') {
      return sendJson(response, 200, { tickets: Object.values(state.tickets).map(projection), page: { limit: 25, hasMore: false, nextCursor: null } });
    }
    const ticketRead = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (ticketRead && request.method === 'GET' && state.tickets[ticketRead[1]]) return sendJson(response, 200, { ticket: projection(state.tickets[ticketRead[1]]) });
    if (url.pathname === '/api/tickets/package-sales' && request.method === 'POST') {
      state.tickets[ids.saleTicket] = {
        ticketId: ids.saleTicket,
        lines: [{ lineId: ids.saleLine, ordinal: 1, sourceType: 'package', sourceAppointmentLineId: null, serviceId: null, serviceName: null, staffId: null, staffName: null,
          productId: null, productName: null, productCode: null, quantity: 1, returnedQuantity: 0, priceType: 'fixed', currency: 'TRY', pricePolicyVersion: 1,
          priceMinMinor: 100000, priceMaxMinor: 100000, finalUnitPriceMinor: 100000, finalizedAt: '2026-09-24T09:00:00.000Z', finalizationReason: 'package_catalog_snapshot',
          discountMinor: 0, discountAt: null, discountReason: null, packageId: ids.package5, packageName: '5 Seans Lazer', packageCoverage: null,
          soldPackage: { customerPackageId: ids.sold, status: 'active', sessionsTotal: 5, sessionsUsed: 0, expiresAt: '2026-12-23T09:00:00.000Z', refundPreviewMinor: 100000, refundValueMinor: null, refundedSessions: null } }],
      };
      return sendJson(response, 201, { ticket: projection(state.tickets[ids.saleTicket]) });
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
  return page.evaluate(`window.__f1608[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function scopeContains(page, scope, text, timeoutMs = 7_000) {
  return waitFor(async () => (await call(page, 'text', scope)).includes(text), `${scope} did not contain ${text}`, timeoutMs);
}
async function boot(page, origin, query = '') {
  await page.send('Page.navigate', { url: `${origin}/harness${query}` });
  await waitFor(() => page.evaluate('document.documentElement.dataset.f1608Ready === "true"'), 'F16-08 harness did not boot');
}
const posts = (pathname) => state.requests.filter((item) => item.method !== 'GET' && item.path === pathname);
const reads = (pathname) => state.requests.filter((item) => item.method === 'GET' && item.path === pathname);

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
      lib: { entry: path.join(root, 'tests/browser/f16-account-language.tsx'), formats: ['es'] },
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

  // Turkish by default: account menu, SalonApp "Diğer" and customer reviews.
  await boot(page, origin);
  assert.equal(await page.evaluate('document.documentElement.lang'), 'tr');
  await scopeContains(page, 'public', '24 Eyl 2026');
  await scopeContains(page, 'kolay', 'Hesap ve üyelik');
  await scopeContains(page, 'kolay', 'Pilot plan · Pilot (manuel etkinleştirme)');
  assert.equal(await call(page, 'openAccountMenu'), true);
  await scopeContains(page, 'header', 'İşletme sahibi');
  for (const text of ['owner@example.test', 'Dil Salon', 'Pilot plan · Pilot (manuel etkinleştirme)', 'Parolayı değiştir', 'Çıkış yap', 'Dil']) {
    await scopeContains(page, 'header', text);
  }
  assert.ok(reads('/api/account').length >= 2, 'account menu and panel must read /api/account');
  assert.equal(state.requests.some((item) => item.path === '/api/account' && item.search.includes('businessId')), false, 'account read must not send a business id');

  // Every SalonApp action is a real workspace route except the disabled "Destek".
  assert.deepEqual(await call(page, 'disabled', 'kolay'), ['Destek']);
  const hrefs = await call(page, 'hrefs', 'kolay');
  assert.ok(hrefs.length >= 15, `expected the full "Diğer" action list, got ${hrefs.length}`);
  for (const href of hrefs) assert.match(href, /^\/app\/(public-booking|feedback|services|reports|expenses|setup|availability|team|products)$/, href);

  // Account actions reach the shell.
  assert.equal(await call(page, 'click', 'header', 'Parolayı değiştir'), true);
  assert.equal(await call(page, 'click', 'kolay', 'Çıkış yap'), true);
  assert.deepEqual(await call(page, 'calls'), { logout: 1, password: 1 });

  // One switch (customer arm) changes all three arms, text and dates.
  const catalogBefore = state.requests.length;
  assert.equal(await call(page, 'setField', 'public', '.public-language-switch select', 'en'), true);
  await waitFor(() => page.evaluate('document.documentElement.lang === "en"'), 'language did not switch to English');
  await scopeContains(page, 'public', 'Reviews');
  assert.match(await call(page, 'text', 'public'), /24 Sept? 2026/);
  await scopeContains(page, 'kolay', 'Account and membership');
  for (const text of ['Support', 'Staff commission', 'Promotions', 'Pilot plan · Pilot (manual activation)', 'Sign out']) await scopeContains(page, 'kolay', text);
  assert.equal(await call(page, 'openAccountMenu'), true);
  for (const text of ['Owner', 'MEMBERSHIP', 'Change password', 'Sign out', 'Language']) await scopeContains(page, 'header', text);
  for (const scope of ['header', 'kolay', 'public']) {
    const text = await call(page, 'text', scope);
    for (const turkish of ['Çıkış yap', 'Parolayı değiştir', 'Hesap ve üyelik', 'İşletme sahibi', 'Yorumlar']) {
      assert.equal(text.includes(turkish), false, `${scope} still shows "${turkish}" in English`);
    }
  }
  assert.ok(state.requests.length > catalogBefore, 'switching must re-read data after remount');
  assert.equal(await page.evaluate('localStorage.getItem("yzt_locale")'), 'en');

  // The choice survives a reload; a cancelled plan is shown as read-only.
  state.planStatus = 'cancelled';
  await boot(page, origin);
  assert.equal(await page.evaluate('document.documentElement.lang'), 'en');
  assert.equal(await call(page, 'openAccountMenu'), true);
  await scopeContains(page, 'header', 'The plan is not active: records are view-only');
  await scopeContains(page, 'header', 'Period ends:');

  // Switch back from the Randevu panel header.
  assert.equal(await call(page, 'setField', 'header', '.language-switch select', 'tr'), true);
  await waitFor(() => page.evaluate('document.documentElement.lang === "tr"'), 'language did not switch back to Turkish');
  assert.equal(await call(page, 'openAccountMenu'), true);
  await scopeContains(page, 'header', 'Plan aktif değil: kayıtlar yalnızca görüntülenebilir');
  await scopeContains(page, 'kolay', 'Aktif değil');
  await scopeContains(page, 'public', 'Yorumlar');
  const layout = await call(page, 'layout');
  assert.ok(layout.overflow <= 1, `F16-08 surfaces overflow at 390px by ${layout.overflow}px`);
  assert.deepEqual(layout.shortTargets, [], 'F16-08 touch targets below 44px');

  // "Yeni paket satışı" opens a package sale on its own ticket.
  await boot(page, origin, '?view=cashier&newPackageSale=1');
  await scopeContains(page, 'cashier', 'Yeni paket satışı');
  await waitFor(() => call(page, 'setField', 'cashier', '.ticket-package-sale select[name="customerId"]', ids.customer), 'package sale customer select missing');
  await waitFor(() => call(page, 'setField', 'cashier', '.ticket-package-sale select[name="packageId"]', ids.package5), 'package sale package select missing');
  assert.equal(await call(page, 'click', 'cashier', 'Paket satışını oluştur'), true);
  await waitFor(() => posts('/api/tickets/package-sales').length === 1, 'package sale POST missing');
  const sale = posts('/api/tickets/package-sales')[0];
  assert.deepEqual(sale.body, { customerId: ids.customer, packageId: ids.package5, expectedPackageVersion: 1 });
  assert.equal(sale.csrf, 'C'.repeat(43));
  assert.ok(sale.key, 'package sale needs an idempotency key');
  await scopeContains(page, 'cashier', 'Paket satışı adisyona dönüştürüldü.');
  const cashierLayout = await call(page, 'layout');
  assert.ok(cashierLayout.overflow <= 1, `F16-08 package sale overflows at 390px by ${cashierLayout.overflow}px`);
  assert.deepEqual(cashierLayout.shortTargets, [], 'F16-08 package sale targets below 44px');
  console.log('F16-08 Chrome acceptance passed: 390px account/plan menu, read-only plan, one language switch across three arms with dates and reload, real SalonApp actions and package sale.');
} finally {
  page?.close();
  chrome?.kill('SIGKILL');
  if (chromeFd !== undefined) {
    try { await new Promise((resolve) => chrome?.once('exit', resolve)); } catch {}
  }
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve)).catch(() => {});
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
