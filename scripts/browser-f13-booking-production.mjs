import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f1303-production-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const servedAssets = new Set();
const sockets = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let chrome;
let chromeFd;
let server;

const USER = 'f3000000-0000-4000-8000-000000000001';
const BUSINESS = 'f3010000-0000-4000-8000-000000000001';
const MEMBERSHIP = 'f3020000-0000-4000-8000-000000000001';
const SERVICE = 'f3030000-0000-4000-8000-000000000001';
const STAFF = 'f3040000-0000-4000-8000-000000000001';
const CSRF = 'F'.repeat(43);
const SERIES = 'f3050000-0000-4000-8000-000000000001';
const SERIES_GROUPS = [
  'f3060000-0000-4000-8000-000000000001',
  'f3060000-0000-4000-8000-000000000002',
  'f3060000-0000-4000-8000-000000000003',
];
let recurringBookings = [];
let seriesVersion = 1;
let availabilitySetupReads = 0;

function seriesGroup(ordinal, startsAt) {
  const end = new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString();
  return {
    groupId: SERIES_GROUPS[ordinal - 1],
    status: 'scheduled',
    source: 'operator',
    version: seriesVersion,
    customerId: 'f3070000-0000-4000-8000-000000000001',
    startsAt,
    endsAt: end,
    timezone: 'Europe/Istanbul',
    currency: 'TRY',
    estimateMinMinor: 10000,
    estimateMaxMinor: 10000,
    lines: [{
      appointmentId: 'f3080000-0000-4000-8000-00000000000' + ordinal,
      lineOrdinal: 1,
      serviceId: SERVICE,
      serviceName: 'Kesim',
      staffId: STAFF,
      staffName: 'Ada',
      status: 'scheduled',
      startsAt,
      endsAt: end,
      occupiedStartsAt: startsAt,
      occupiedEndsAt: end,
      processingCapacityPolicy: 'HOLD',
      passiveWaitMinutes: 0,
      processingPolicyVersion: 1,
      priceType: 'fixed',
      priceMinMinor: 10000,
      priceMaxMinor: 10000,
      priceMinor: 10000,
      currency: 'TRY',
      pricePolicyVersion: 1,
    }],
    legacyAppointmentId: null,
    managementMode: 'group',
    lineCount: 1,
    canRescheduleGroup: true,
    canCancelGroup: true,
    customerName: 'F16 Seri Müşteri',
    customerPhone: '05551601001',
    customerEmail: null,
    notes: null,
    seriesId: SERIES,
    seriesOrdinal: ordinal,
  };
}
function seriesPayload() {
  return {
    seriesId: SERIES,
    businessId: BUSINESS,
    customerId: 'f3070000-0000-4000-8000-000000000001',
    frequency: 'weekly',
    occurrenceCount: 3,
    timezone: 'Europe/Istanbul',
    anchorStartsAt: recurringBookings[0]?.startsAt ?? '2026-10-05T07:00:00.000Z',
    version: seriesVersion,
    status: 'active',
    occurrences: recurringBookings,
    events: [],
  };
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
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
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome executable not found');
}

async function waitFor(read, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
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
      sleep(5_000).then(() => { throw new Error('CDP WebSocket timeout'); }),
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
          this.diagnostics.push(String(details?.exception?.description ?? details?.text ?? 'browser exception').slice(0, 2000));
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

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
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
      rollupOptions: {
        output: { entryFileNames: 'app.js', chunkFileNames: '[name]-[hash].js' },
      },
    },
  });

  const bundleRoot = path.resolve(bundleDir);
  const appJs = readFileSync(path.join(bundleDir, 'app.js'));
  const cssFile = readdirSync(bundleDir).find((name) => name.endsWith('.css'));
  assert.ok(cssFile, 'production main build did not emit CSS');
  const appCss = readFileSync(path.join(bundleDir, cssFile));

  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/app.js') {
      servedAssets.add('/app.js');
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(appJs);
      return;
    }
    if (url.pathname === '/app.css') {
      servedAssets.add('/app.css');
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(appCss);
      return;
    }
    if (!url.pathname.startsWith('/api/') && path.extname(url.pathname)) {
      let relative;
      try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
      catch {
        response.writeHead(400); response.end('bad asset'); return;
      }
      const assetPath = path.resolve(bundleRoot, relative);
      if (!assetPath.startsWith(`${bundleRoot}${path.sep}`) || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
        response.writeHead(404); response.end('asset not found'); return;
      }
      servedAssets.add(url.pathname);
      response.writeHead(200, { 'Content-Type': contentType(assetPath), 'Cache-Control': 'no-store' });
      response.end(readFileSync(assetPath));
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
      return;
    }

    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Geçersiz JSON.' } }); }
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/session') {
      return sendJson(response, 200, {
        user: { id: USER, email: 'f13-prod@example.test', fullName: 'F13 Prod' },
        memberships: [{
          id: MEMBERSHIP, business_id: BUSINESS, role: 'owner', active: true,
          businesses: { id: BUSINESS, name: 'F13 Production Salon', slug: 'f13-prod', timezone: 'Europe/Istanbul' },
        }],
        activeBusinessId: BUSINESS,
        passwordRecovery: false,
        csrfToken: CSRF,
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog') {
      return sendJson(response, 200, {
        membership: { id: MEMBERSHIP, business_id: BUSINESS, role: 'owner', active: true },
        services: [{
          id: SERVICE, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0,
          buffer_after_minutes: 0, price_minor: 10000, currency: 'TRY', active: true,
          price_type: 'fixed', price_min_minor: 10000, price_max_minor: 10000, price_policy_version: 1,
        }],
        staff: [{ id: STAFF, name: 'Ada', active: true }],
        assignments: [{ staff_id: STAFF, service_id: SERVICE, active: true }],
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/availability/setup') {
      availabilitySetupReads += 1;
      return sendJson(response, 200, { timezone: 'Europe/Istanbul' });
    }
    if (request.method === 'POST' && url.pathname === '/api/availability/group-slots') {
      assert.deepEqual(body.lines, [{ serviceId: SERVICE, staffId: null }]);
      return sendJson(response, 200, {
        slots: [{
          starts_at: '2026-10-05T07:00:00.000Z',
          ends_at: '2026-10-05T07:30:00.000Z',
          timezone: 'Europe/Istanbul',
          total_duration_minutes: 30,
          lines: [],
        }],
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/bookings/series/preview') {
      assert.equal(body.frequency, 'weekly');
      assert.equal(body.count, 3);
      assert.deepEqual(body.lines, [{ serviceId: SERVICE, staffId: null }]);
      return sendJson(response, 200, {
        preview: {
          frequency: 'weekly',
          occurrenceCount: 3,
          timezone: 'Europe/Istanbul',
          allAvailable: true,
          occurrences: [
            { ordinal: 1, startsAt: '2026-10-05T07:00:00.000Z', localDate: '2026-10-05', localTime: '10:00:00', available: true },
            { ordinal: 2, startsAt: '2026-10-12T07:00:00.000Z', localDate: '2026-10-12', localTime: '10:00:00', available: true },
            { ordinal: 3, startsAt: '2026-10-19T07:00:00.000Z', localDate: '2026-10-19', localTime: '10:00:00', available: true },
          ],
        },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/bookings/series') {
      assert.ok(request.headers['idempotency-key'], 'F16-01 series create omitted Idempotency-Key');
      assert.equal(body.frequency, 'weekly');
      assert.equal(body.count, 3);
      recurringBookings = [
        seriesGroup(1, '2026-10-05T07:00:00.000Z'),
        seriesGroup(2, '2026-10-12T07:00:00.000Z'),
        seriesGroup(3, '2026-10-19T07:00:00.000Z'),
      ];
      return sendJson(response, 201, { series: seriesPayload() });
    }
    if (request.method === 'GET' && url.pathname === `/api/bookings/series/${SERIES}`) {
      return sendJson(response, 200, { series: seriesPayload() });
    }
    if (request.method === 'POST' && url.pathname === `/api/bookings/series/${SERIES}/future/preview`) {
      assert.ok(body.action === 'reschedule_future' || body.action === 'cancel_future');
      if (body.action === 'reschedule_future') {
        assert.equal(body.fromOrdinal, 1);
        assert.equal(typeof body.newStartsAt, 'string');
        const start = new Date(body.newStartsAt);
        const targets = recurringBookings.map((booking, index) => {
          const target = new Date(start.getTime() + index * 7 * 24 * 60 * 60_000).toISOString();
          return {
            groupId: booking.groupId,
            ordinal: index + 1,
            groupVersion: booking.version,
            startsAt: booking.startsAt,
            targetStartsAt: target,
            localDate: target.slice(0, 10),
            available: true,
          };
        });
        return sendJson(response, 200, {
          preview: {
            seriesId: SERIES,
            seriesVersion,
            action: 'reschedule_future',
            fromOrdinal: 1,
            timezone: 'Europe/Istanbul',
            allAvailable: true,
            targets,
            conflicts: [],
            skipped: [],
          },
        });
      }
      assert.equal(body.fromOrdinal, 2);
      assert.equal(body.newStartsAt, null);
      const targets = recurringBookings
        .filter((booking) => booking.seriesOrdinal >= 2 && booking.status !== 'cancelled')
        .map((booking) => ({
          groupId: booking.groupId,
          ordinal: booking.seriesOrdinal,
          groupVersion: booking.version,
          startsAt: booking.startsAt,
          targetStartsAt: null,
          localDate: booking.startsAt.slice(0, 10),
          available: true,
        }));
      return sendJson(response, 200, {
        preview: {
          seriesId: SERIES,
          seriesVersion,
          action: 'cancel_future',
          fromOrdinal: 2,
          timezone: 'Europe/Istanbul',
          allAvailable: true,
          targets,
          conflicts: [],
          skipped: [],
        },
      });
    }
    if (request.method === 'POST' && url.pathname === `/api/bookings/series/${SERIES}/future/reschedule`) {
      assert.ok(request.headers['idempotency-key'], 'F16-01 future reschedule omitted Idempotency-Key');
      assert.equal(body.expectedVersion, seriesVersion);
      assert.equal(body.fromOrdinal, 1);
      const start = new Date(body.newStartsAt);
      seriesVersion += 1;
      recurringBookings = recurringBookings.map((_, index) =>
        seriesGroup(index + 1, new Date(start.getTime() + index * 7 * 24 * 60 * 60_000).toISOString()));
      return sendJson(response, 200, { series: seriesPayload() });
    }
    if (request.method === 'POST' && url.pathname === `/api/bookings/series/${SERIES}/future/cancel`) {
      assert.ok(request.headers['idempotency-key'], 'F16-01 future cancel omitted Idempotency-Key');
      assert.equal(body.expectedVersion, seriesVersion);
      assert.equal(body.fromOrdinal, 2);
      assert.equal(body.reason, 'Plan değişti');
      seriesVersion += 1;
      recurringBookings = recurringBookings.map((booking) => {
        if (booking.seriesOrdinal < 2) return booking;
        return {
          ...booking,
          status: 'cancelled',
          version: seriesVersion,
          canRescheduleGroup: false,
          canCancelGroup: false,
          lines: booking.lines.map((line) => ({ ...line, status: 'cancelled' })),
        };
      });
      return sendJson(response, 200, { series: seriesPayload() });
    }
    if (request.method === 'GET' && url.pathname === '/api/bookings/groups') {
      return sendJson(response, 200, {
        membership: { id: MEMBERSHIP, business_id: BUSINESS, role: 'owner', active: true },
        bookings: recurringBookings,
        page: { limit: 25, hasMore: false, nextCursor: null },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/csrf') {
      return sendJson(response, 200, { csrfToken: CSRF });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `unmapped production fixture: ${url.pathname}` } });
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
  }, 'F13-03 production Chrome did not expose a debugging port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`, { method: 'PUT' })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Pacific/Pago_Pago' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const RealDate = Date;
      const fixedNow = RealDate.parse('2026-09-26T08:00:00.000Z');
      class FixedDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [fixedNow])); }
        static now() { return fixedNow; }
      }
      globalThis.Date = FixedDate;
    })();`,
  });
  await page.send('Page.navigate', { url: `${origin}/app/bookings` });

  await waitFor(
    () => page.evaluate('location.pathname === "/app/bookings" && document.body.innerText.includes("RANDEVU YÖNETİMİ") && document.body.innerText.includes("YENİ RANDEVU")'),
    'production /app/bookings lazy route did not render BookingPage',
  );

  assert.ok(
    [...servedAssets].some((name) => /\/BookingPage-[^/]+\.js$/.test(name)),
    `production /app/bookings did not request BookingPage lazy chunk: ${JSON.stringify([...servedAssets])}`,
  );
  assert.equal(await page.evaluate("document.querySelector('a[aria-current=\"page\"]')?.textContent"), 'Randevular');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  const initialDateAuthority = await page.evaluate(`(() => {
    const composerDate = document.querySelector('.booking-composer input[type="date"]')?.value ?? null;
    const now = new Date();
    const browserDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    return { composerDate, browserDate };
  })()`);
  assert.deepEqual(
    initialDateAuthority,
    { composerDate: '2026-09-26', browserDate: '2026-09-25' },
    'F13-03 create date did not prefer the active business day over the browser-local day',
  );
  await page.evaluate(`document.querySelector('.booking-inline-action button').click()`);
  await waitFor(
    () => page.evaluate(`document.querySelector('.booking-close-panel input[type="date"]')?.value === '2026-09-26'`),
    'F13-03 close-time date did not initialize from the active business day',
  );

  const setControl = async (labelText, value, tag = 'input') => page.evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>node.textContent.includes(${JSON.stringify(labelText)}));
    const field=label?.querySelector(${JSON.stringify(tag)});
    if(!field) return false;
    const proto=field.tagName==='SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(field,${JSON.stringify(value)});
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);

  assert.equal(await setControl('Tarih', '2026-10-05'), true, 'F13-03 create date input missing');
  assert.equal(await setControl('Gün', '2026-10-06'), true, 'F13-03 close-time date input missing');
  assert.equal(await setControl('Müşteri', 'F16 Seri Müşteri'), true, 'F16-01 customer input missing');
  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.includes('Uygun saatleri getir')).click()`);
  await waitFor(
    () => page.evaluate(`[...document.querySelectorAll('.slot-button')].some((node)=>node.textContent.includes('10:00'))`),
    'F16-01 create slot did not render',
  );
  await page.evaluate(`[...document.querySelectorAll('.slot-button')].find((node)=>node.textContent.includes('10:00')).click()`);
  assert.equal(await setControl('Tekrar', 'weekly', 'select'), true, 'F16-01 recurrence selector missing');
  assert.equal(await setControl('Adet', '3'), true, 'F16-01 recurrence count missing');
  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.includes('Tüm tekrarları önizle')).click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('3 tekrarın tamamı uygun.') && document.body.innerText.includes('3. tekrar')`),
    'F16-01 all-occurrence preview did not render',
  );

  const create390 = await page.evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth-innerWidth,
    text: document.body.innerText,
  }))()`);
  assert.equal(create390.overflow <= 1, true, 'F16-01 recurring composer overflowed at 390px');
  assert.match(create390.text, /Her hafta/);
  assert.match(create390.text, /3\. tekrar/);

  const setupReadsBeforeSeriesCreate = availabilitySetupReads;
  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.trim()==='Seriyi oluştur').click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('3 randevuluk seri atomik olarak oluşturuldu.') && [...document.querySelectorAll('button')].some((node)=>node.textContent.trim()==='Seri')`),
    'F16-01 series create did not refresh occurrence list',
  );
  await waitFor(
    () => availabilitySetupReads > setupReadsBeforeSeriesCreate,
    'F13-03 same-business post-create reload did not re-read availability setup',
  );
  const preservedDateEdits = await page.evaluate(`(() => ({
    createDate: document.querySelector('.booking-composer input[type="date"]')?.value ?? null,
    closeDate: document.querySelector('.booking-close-panel input[type="date"]')?.value ?? null,
  }))()`);
  assert.deepEqual(
    preservedDateEdits,
    { createDate: '2026-10-05', closeDate: '2026-10-06' },
    'F13-03 same-business reload reset user-edited create/close dates',
  );

  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.trim()==='Seri').click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('TEKRARLAYAN SERİ') && document.body.innerText.includes('Seri sürümü')`),
    'F16-01 series management surface did not open',
  );
  assert.equal(await setControl('Yeni tarih', '2026-10-05'), true, 'F16-01 future date input missing');
  assert.equal(await setControl('Yeni saat', '12:00'), true, 'F16-01 future time input missing');
  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.includes('Kapsamı önizle')).click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes(${JSON.stringify(SERIES_GROUPS[0])}) && document.body.innerText.includes(${JSON.stringify(SERIES_GROUPS[2])}) && document.body.innerText.includes('Kapsamda')`),
    'F16-01 future-scope preview did not expose exact group ids',
  );

  const scope390 = await page.evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth-innerWidth,
    targets: [...document.querySelectorAll('.appointment-row')].filter((node)=>node.textContent.includes('Kapsamda')).length,
  }))()`);
  assert.equal(scope390.overflow <= 1, true, 'F16-01 series scope overflowed at 390px');
  assert.equal(scope390.targets >= 3, true, 'F16-01 series scope did not expose all three targets');

  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.includes('Kapsamdaki randevuları taşı')).click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Seçilen tekrar ve sonraki uygun randevular atomik olarak taşındı.')`),
    'F16-01 future reschedule did not complete through the operator UI',
  );
  assert.equal(seriesVersion, 2, 'F16-01 browser fixture did not receive one series version bump');

  // Re-open the series and prove the operator cancel-future path against the
  // same candidate-bound production build. Ordinal 1 must stay scheduled.
  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.trim()==='Seri').click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('TEKRARLAYAN SERİ') && document.body.innerText.includes('Seri sürümü')`),
    'F16-01 series management surface did not reopen for future cancel',
  );
  assert.equal(await setControl('İşlem', 'cancel', 'select'), true, 'F16-01 future cancel selector missing');
  assert.equal(await setControl('Başlangıç tekrarı', '2', 'select'), true, 'F16-01 future cancel ordinal selector missing');
  const reasonSet = await page.evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find((node)=>node.textContent.includes('İptal nedeni'));
    const field=label?.querySelector('textarea');
    if(!field) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Plan değişti');
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  assert.equal(reasonSet, true, 'F16-01 future cancel reason field missing');
  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.includes('Kapsamı önizle')).click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes(${JSON.stringify(SERIES_GROUPS[1])}) && document.body.innerText.includes(${JSON.stringify(SERIES_GROUPS[2])}) && !document.body.innerText.includes(${JSON.stringify(SERIES_GROUPS[0])})`),
    'F16-01 future cancel preview did not expose exactly ordinals 2-3',
  );
  await page.evaluate(`[...document.querySelectorAll('button')].find((node)=>node.textContent.includes('Kapsamdaki randevuları iptal et')).click()`);
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('Seçilen tekrar ve sonraki uygun randevular atomik olarak iptal edildi.')`),
    'F16-01 future cancel did not complete through the operator UI',
  );
  assert.equal(seriesVersion, 3, 'F16-01 future cancel did not bump the series version once');
  assert.equal(recurringBookings[0].status, 'scheduled', 'F16-01 future cancel rewrote the preserved first occurrence');
  assert.deepEqual(recurringBookings.slice(1).map((booking) => booking.status), ['cancelled', 'cancelled']);

  assert.deepEqual(page.diagnostics, []);
  page.close();

  console.log('F16-01 production Chrome acceptance passed: weekly preview/create, exact future scope, atomic reschedule/cancel and 390px.');
  console.log('F13-03 business-date acceptance passed: business-local default beats browser-local day and same-business reload preserves user edits.');
  console.log('F13-03 production-entry browser passed: src/main.tsx /app/bookings route requested BookingPage lazy chunk and rendered workspace UI.');
} catch (error) {
  let diagnostics = '';
  try { diagnostics = `\nChrome log:\n${readFileSync(chromeLog, 'utf8').slice(-4000)}`; } catch { /* noop */ }
  throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostics}`);
} finally {
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(1000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  if (chromeFd !== undefined) closeSync(chromeFd);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { rmSync(work, { recursive: true, force: true }); break; }
    catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 5) throw error;
      await sleep(100 * (attempt + 1));
    }
  }
}
