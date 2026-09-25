import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F16-07 real-Chrome acceptance at 390px on the "Kasa ve raporlar" page: the
// owner reads the staff commission report with its definition, saves a new
// dated rate version, adds and clears a per-service override, and a date change
// reloads the report; a staff member sees only their own commission and no rate
// editor. The browser never computes commission: every amount is from the API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f16-commission-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = {
  user: 'f16c0000-0000-4000-8000-000000000701', business: 'f16c0000-0000-4000-8000-000000000702',
  membership: 'f16c0000-0000-4000-8000-000000000703', ayla: 'f16c0000-0000-4000-8000-000000000711',
  deniz: 'f16c0000-0000-4000-8000-000000000712', boya: 'f16c0000-0000-4000-8000-000000000721',
  kesim: 'f16c0000-0000-4000-8000-000000000722', ticket: 'f16c0000-0000-4000-8000-000000000731',
};
const definition = [
  'Prim, adisyon kapanınca satır bazında yazılır: oran × (satır fiyatı − satır indirimi − kampanya payı).',
  'Paketten karşılanan seans, paketin seans birim değeri (satış fiyatı ÷ seans) üzerinden prim alır; paket satışının kendisi prim üretmez.',
  'Bu rapor bordro veya maaş hesabı değildir.',
];
const state = {
  role: 'owner',
  requests: [],
  rates: [
    { staffId: ids.ayla, staffName: 'Ayla', active: true, version: 1, serviceRateBps: 1000, productRateBps: 500, updatedAt: '2026-09-20T09:00:00.000Z', overrides: [] },
    { staffId: ids.deniz, staffName: 'Deniz', active: true, version: 0, serviceRateBps: null, productRateBps: null, updatedAt: null, overrides: [] },
  ],
};

const aylaRow = {
  staffId: ids.ayla, staffName: 'Ayla', serviceBaseMinor: 90000, packageUnitBaseMinor: 80000, productBaseMinor: 0,
  adjustmentBaseMinor: -4500, baseMinor: 165500, commissionMinor: 24650, adjustmentCommissionMinor: -1350, lineCount: 2, adjustmentCount: 1,
};
const denizRow = {
  staffId: ids.deniz, staffName: 'Deniz', serviceBaseMinor: 13500, packageUnitBaseMinor: 0, productBaseMinor: 0,
  adjustmentBaseMinor: 0, baseMinor: 13500, commissionMinor: 0, adjustmentCommissionMinor: 0, lineCount: 1, adjustmentCount: 0,
};
const movement = (entryId, staffName, staffId, kind, lineKind, itemName, rateBps, baseMinor, amountMinor) => ({
  entryId, occurredAt: '2026-09-24T10:00:00.000Z', kind, staffId, staffName, ticketId: ids.ticket, customerName: 'Ziya Örnek',
  lineKind, itemName, rateBps, rateSource: rateBps ? 'service_default' : 'none', baseMinor, amountMinor,
});
function commissionReport(url) {
  const own = state.role === 'staff';
  const staff = own ? [aylaRow] : [aylaRow, denizRow];
  const movements = [
    movement('f16c0000-0000-4000-8000-000000000741', 'Ayla', ids.ayla, 'line', 'service', 'Bakım', 1000, 90000, 9000),
    movement('f16c0000-0000-4000-8000-000000000742', 'Ayla', ids.ayla, 'line', 'package_covered', 'Bakım', 2000, 80000, 16000),
    movement('f16c0000-0000-4000-8000-000000000743', 'Ayla', ids.ayla, 'payment_adjustment', 'service', 'Boya', 3000, -4500, -1350),
    ...(own ? [] : [movement('f16c0000-0000-4000-8000-000000000744', 'Deniz', ids.deniz, 'line', 'service', 'Kesim', 0, 13500, 0)]),
  ];
  return {
    businessId: ids.business, startDate: url.searchParams.get('startDate'), endDate: url.searchParams.get('endDate'),
    timezone: 'Europe/Istanbul', asOf: '2026-09-24T12:00:00.000Z', scope: own ? 'own' : 'business', ownStaffId: own ? ids.ayla : null,
    currency: 'TRY',
    totals: { baseMinor: staff.reduce((sum, row) => sum + row.baseMinor, 0), commissionMinor: staff.reduce((sum, row) => sum + row.commissionMinor, 0),
      adjustmentCommissionMinor: -1350, lineCount: staff.reduce((sum, row) => sum + row.lineCount, 0) },
    staff, movements, movementCount: movements.length, movementsTruncated: false, definition,
  };
}
function dayReport(url) {
  const zero = Object.fromEntries(['collectedMinor','cashCollectedMinor','cardCollectedMinor','refundMinor','correctionIncreaseMinor',
    'correctionDecreaseMinor','paymentNetMinor','expenseMinor','cashExpenseMinor','cardExpenseMinor','netMovementMinor','cashNetMovementMinor',
    'cardNetMovementMinor','expectedMinMinor','expectedMaxMinor','expectedAppointmentMinMinor','expectedAppointmentMaxMinor','appointmentCount',
    'serviceSaleMinor','productSaleMinor','packageSaleMinor','promoDiscountMinor','packageCoveredSessionCount','packageCoveredValueMinor',
    'saleValueMinor','outstandingMinor','ticketCount','unsettledTicketCount'].map((key) => [key, 0]));
  return { ...zero, businessId: ids.business, startDate: url.searchParams.get('startDate'), endDate: url.searchParams.get('endDate'),
    timezone: 'Europe/Istanbul', fromInstant: '2026-09-23T21:00:00.000Z', toInstant: '2026-09-24T21:00:00.000Z', asOf: '2026-09-24T12:00:00.000Z', currency: 'TRY' };
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
    state.requests.push({ method: request.method, path: url.pathname, search: url.search, body, csrf: request.headers['x-yzt-csrf'] ?? null, role: state.role });
    if (url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: 'C'.repeat(43) });
    if (url.pathname === '/api/session') return sendJson(response, 200, {
      user: { id: ids.user, email: 'user@example.test', fullName: 'Kullanıcı' },
      memberships: [{ id: ids.membership, business_id: ids.business, role: state.role, active: true, businesses: { id: ids.business, name: 'Prim Salon', slug: 'prim-salon', timezone: 'Europe/Istanbul' } }],
      activeBusinessId: ids.business, passwordRecovery: false, csrfToken: 'C'.repeat(43),
    });
    if (url.pathname === '/api/reports/financial') {
      if (state.role === 'staff') return sendJson(response, 403, { error: { code: 'FINANCIAL_REPORTS_PERMISSION_REQUIRED', message: 'Mali raporları görüntülemek için yetkiniz yok.' } });
      return sendJson(response, 200, { report: dayReport(url) });
    }
    if (url.pathname === '/api/reports/commission') return sendJson(response, 200, { report: commissionReport(url) });
    if (url.pathname === '/api/commission-rates' && request.method === 'GET') {
      assert.equal(state.role, 'owner', 'staff must not load the rate editor');
      return sendJson(response, 200, { staff: state.rates });
    }
    if (url.pathname === '/api/catalog') return sendJson(response, 200, {
      membership: { id: ids.membership, business_id: ids.business, role: state.role, active: true },
      services: [
        { id: ids.boya, name: 'Boya', active: true },
        { id: ids.kesim, name: 'Kesim', active: true },
      ],
      staff: [], assignments: [],
    });
    const rate = url.pathname.match(/^\/api\/commission-rates\/([^/]+)$/);
    if (rate && request.method === 'POST') {
      const item = state.rates.find((row) => row.staffId === rate[1]);
      assert.equal(body.expectedVersion, item.version);
      Object.assign(item, { version: item.version + 1, serviceRateBps: body.serviceRateBps, productRateBps: body.productRateBps });
      return sendJson(response, 200, { staff: item });
    }
    const override = url.pathname.match(/^\/api\/commission-rates\/([^/]+)\/services\/([^/]+)$/);
    if (override && request.method === 'POST') {
      const item = state.rates.find((row) => row.staffId === override[1]);
      const current = item.overrides.find((row) => row.serviceId === override[2]);
      assert.equal(body.expectedVersion, current?.version ?? 0);
      const next = { serviceId: override[2], serviceName: override[2] === ids.boya ? 'Boya' : 'Kesim', version: (current?.version ?? 0) + 1, rateBps: body.rateBps };
      item.overrides = [...item.overrides.filter((row) => row.serviceId !== override[2]), next];
      return sendJson(response, 200, { staff: item });
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
  return page.evaluate(`window.__f1607[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function scopeContains(page, text, timeoutMs = 7_000) {
  return waitFor(async () => (await call(page, 'text', 'reports')).includes(text), `reports page did not contain ${text}`, timeoutMs);
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
      lib: { entry: path.join(root, 'tests/browser/f16-commission.tsx'), formats: ['es'] },
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
  await page.send('Page.navigate', { url: `${origin}/harness` });
  await waitFor(() => page.evaluate('document.documentElement.dataset.f1607Ready === "true"'), 'F16-07 harness did not boot');

  // Owner: the report, its definition and the per-staff breakdown come from the API.
  await scopeContains(page, 'Prim raporu');
  await scopeContains(page, 'Ayla');
  await scopeContains(page, 'Seçili tarihlerde yazılan tüm çalışan prim hareketleri');
  const ownerText = await call(page, 'text', 'reports');
  assert.match(ownerText, /Toplam prim\s*₺246,50/);
  assert.match(ownerText, /Deniz/);
  assert.equal(await call(page, 'openDetails', 'reports', 'Hesap tanımı'), true);
  await scopeContains(page, 'paket satışının kendisi prim üretmez');
  assert.equal(await call(page, 'openDetails', 'reports', 'Prim hareketleri'), true);
  await scopeContains(page, 'İade/düzeltme payı');
  await scopeContains(page, 'Paket seansı');

  // Rate editor: invalid input never leaves the browser; a valid save is a new version.
  await scopeContains(page, 'Prim oranları');
  await scopeContains(page, 'Oran tanımlı değil (prim yazılmaz)');
  const aylaForm = 'form[aria-label="Ayla prim oranları"]';
  assert.equal(await call(page, 'setField', 'reports', `${aylaForm} input[name="serviceRate"]`, '150'), true);
  assert.equal(await call(page, 'click', 'reports', 'Kaydet', aylaForm), true);
  await scopeContains(page, 'Oranlar %0 ile %100 arasında');
  assert.equal(requestsTo(`/api/commission-rates/${ids.ayla}`).length, 0);
  assert.equal(await call(page, 'setField', 'reports', `${aylaForm} input[name="serviceRate"]`, '12,5'), true);
  assert.equal(await call(page, 'setField', 'reports', `${aylaForm} input[name="productRate"]`, '5'), true);
  assert.equal(await call(page, 'click', 'reports', 'Kaydet', aylaForm), true);
  await scopeContains(page, 'Yalnız bundan sonra kapanan adisyonlara uygulanır');
  await scopeContains(page, 'Sürüm 2');
  const saved = requestsTo(`/api/commission-rates/${ids.ayla}`)[0];
  assert.deepEqual(saved.body, { serviceRateBps: 1250, productRateBps: 500, expectedVersion: 1 });
  assert.equal(saved.csrf, 'C'.repeat(43));

  // Per-service override: add Boya at 30%, then clear it back to the default.
  const overrideForm = 'form[aria-label="Ayla hizmet istisnası"]';
  assert.equal(await call(page, 'setField', 'reports', `${overrideForm} select[name="serviceId"]`, ids.boya), true);
  assert.equal(await call(page, 'setField', 'reports', `${overrideForm} input[name="rate"]`, '30'), true);
  assert.equal(await call(page, 'click', 'reports', 'İstisna ekle', overrideForm), true);
  await scopeContains(page, 'Boya: %30');
  assert.deepEqual(requestsTo(`/api/commission-rates/${ids.ayla}/services/${ids.boya}`)[0].body, { rateBps: 3000, expectedVersion: 0 });
  assert.equal(await call(page, 'click', 'reports', 'İstisnayı kaldır'), true);
  await scopeContains(page, 'Hizmet istisnası kaldırıldı');
  await waitFor(async () => !(await call(page, 'text', 'reports')).includes('Boya: %30'), 'cleared override still listed');
  assert.deepEqual(requestsTo(`/api/commission-rates/${ids.ayla}/services/${ids.boya}`)[1].body, { rateBps: null, expectedVersion: 1 });

  // A new date range reloads the commission report for exactly that range.
  const before = requestsTo('/api/reports/commission', 'GET').length;
  assert.equal(await call(page, 'setField', 'reports', '.financial-report-filter label:first-child input', '2026-09-01'), true);
  assert.equal(await call(page, 'click', 'reports', 'Raporu getir', '.financial-report-filter'), true);
  await waitFor(() => requestsTo('/api/reports/commission', 'GET').length > before, 'commission report was not reloaded');
  const reload = requestsTo('/api/reports/commission', 'GET').at(-1);
  assert.equal(new URLSearchParams(reload.search).get('startDate'), '2026-09-01');
  await scopeContains(page, 'Ayla');

  const ownerLayout = await call(page, 'layout');
  assert.ok(ownerLayout.overflow <= 1, `F16-07 owner surfaces overflow at 390px by ${ownerLayout.overflow}px`);
  assert.deepEqual(ownerLayout.shortTargets, [], 'F16-07 owner touch targets below 44px');

  // Staff: only their own commission, no rate editor, no rates request.
  state.role = 'staff';
  await page.send('Page.navigate', { url: `${origin}/harness` });
  await waitFor(() => page.evaluate('document.documentElement.dataset.f1607Ready === "true"'), 'F16-07 staff harness did not boot');
  await scopeContains(page, 'Yalnız sizin prim hareketleriniz gösterilir.');
  await scopeContains(page, 'Mali raporları görüntülemek için yetkiniz yok.');
  const staffText = await call(page, 'text', 'reports');
  assert.doesNotMatch(staffText, /Deniz/);
  assert.doesNotMatch(staffText, /Prim oranları/);
  assert.equal(state.requests.filter((item) => item.role === 'staff' && item.path === '/api/commission-rates').length, 0);
  const staffLayout = await call(page, 'layout');
  assert.ok(staffLayout.overflow <= 1, `F16-07 staff view overflows at 390px by ${staffLayout.overflow}px`);
  assert.deepEqual(staffLayout.shortTargets, [], 'F16-07 staff touch targets below 44px');
  console.log('F16-07 Chrome acceptance passed: 390px commission report with definition, dated rate save, service override add/clear, range reload and own-only staff view.');
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
