import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-s07-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const fixture = {
  bookMode: 'success',
  resolveMode: 'not-found',
  clockOffsetSeconds: 0,
  requests: [],
  hanging: new Set(),
};
const sockets = new Set();
let testJs;

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function hold(response, bodyPrefix = '') {
  fixture.hanging.add(response);
  response.on('close', () => fixture.hanging.delete(response));
  if (bodyPrefix) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write(bodyPrefix);
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Fixture request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requestCount(fragment, method = 'POST') {
  return fixture.requests.filter((item) => item.method === method && item.path.includes(fragment)).length;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    fixture.requests.push({ method: request.method, path: url.pathname });
    const requestBody = request.method === 'POST' ? await readJson(request) : null;
    if (url.pathname === '/test.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(testJs);
      return;
    }
    if (url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/test.js"></script>');
      return;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && parts.slice(0, 3).join('/') === 'api/public/business') {
      const slug = decodeURIComponent(parts[3] ?? 'browser-salon');
      if (parts[4] === 'staff') return sendJson(response, 200, { staff: [{ staff_id: '70000000-0000-4000-8000-000000000001', staff_name: 'Browser Staff' }] });
      if (parts[4] === 'slots') return sendJson(response, 200, { slots: [{
        staff_id: '70000000-0000-4000-8000-000000000001', staff_name: 'Browser Staff',
        starts_at: '2026-09-20T09:00:00.000Z', ends_at: '2026-09-20T09:30:00.000Z', timezone: 'Europe/Istanbul',
      }] });
      return sendJson(response, 200, {
        business: { name: 'Browser Salon', slug, timezone: 'Europe/Istanbul', local_date: '2026-09-20', max_date: '2026-10-20', step_minutes: 15, min_notice_minutes: 0, horizon_days: 30 },
        services: [{ service_id: '60000000-0000-4000-8000-000000000001', name: 'Browser Service', duration_minutes: 30, price_minor: 25000, currency: 'TRY' }],
        bookingClock: { serverNowEpochSeconds: Math.floor(Date.now() / 1000) + fixture.clockOffsetSeconds, submitWindowSeconds: 300 },
      });
    }
    if (request.method === 'POST' && /\/api\/public\/business\/[^/]+\/book$/.test(url.pathname)) {
      if (fixture.bookMode === 'hang') return hold(response);
      assert.equal(typeof requestBody?.managementToken, 'string');
      return sendJson(response, 201, {
        appointment: { appointment_id: '90000000-0000-4000-8000-000000000001', status: 'scheduled', starts_at: '2026-09-20T09:00:00.000Z', ends_at: '2026-09-20T09:30:00.000Z', timezone: 'Europe/Istanbul', service_name: 'Browser Service', staff_name: 'Browser Staff', price_minor: 25000, currency: 'TRY' },
        management: { url: `/m#${encodeURIComponent(requestBody.managementToken)}` },
        recovery: { expiresAt: '2026-09-23T09:00:00.000Z' },
      });
    }
    if (request.method === 'POST' && /\/api\/public\/booking\/(resolve|recover)$/.test(url.pathname)) {
      if (fixture.resolveMode === 'hang-body') return hold(response, '{"resolution":');
      if (fixture.resolveMode === 'committed') return sendJson(response, 200, {
        resolution: 'committed', recoveryId: requestBody.recoveryId,
        appointment: { appointment_id: '90000000-0000-4000-8000-000000000001', business_name: 'Browser Salon', status: 'scheduled', starts_at: '2026-09-20T09:00:00.000Z', ends_at: '2026-09-20T09:30:00.000Z', timezone: 'Europe/Istanbul', service_name: 'Browser Service', staff_name: 'Browser Staff', price_minor: 25000, currency: 'TRY' },
        management: { url: `/m#${Buffer.alloc(32, 17).toString('base64url')}` }, recovery: { expiresAt: '2026-09-23T09:00:00.000Z' },
      });
      if (fixture.resolveMode === 'malformed') return sendJson(response, 200, { resolution: 'committed', recoveryId: requestBody.recoveryId });
      if (fixture.resolveMode === 'mismatched') return sendJson(response, 200, { resolution: 'closed_absent', recoveryId: '80000000-0000-4000-8000-000000000099' });
      if (fixture.resolveMode === 'rate-limit') return sendJson(response, 429, { error: { code: 'PUBLIC_BOOKING_RATE_LIMITED', message: 'Çok fazla istek gönderildi.' } }, { 'Retry-After': '1' });
      if (fixture.resolveMode === 'exists_nolink' || fixture.resolveMode === 'closed_absent') {
        return sendJson(response, 200, { resolution: fixture.resolveMode, recoveryId: requestBody.recoveryId });
      }
      return sendJson(response, 404, { error: { code: 'BOOKING_RECOVERY_NOT_FOUND', message: 'Randevu sonucu bulunamadı.' } });
    }
    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Fixture route not found.' } });
  } catch (error) {
    sendJson(response, 500, { error: { message: error.message } });
  }
});
server.headersTimeout = 5_000;
server.requestTimeout = 5_000;
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
          const summary = details?.exception?.description ?? details?.text ?? 'Unknown browser exception';
          this.diagnostics.push(String(summary).slice(0, 2_000));
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
let pageA;
let pageB;
let origin;
let chromeStartError;

async function openPage(debugUrl, url) {
  const target = await (await fetch(`${debugUrl}/json/new?about%3Ablank`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  page.targetId = target.id;
  try {
    await navigate(page, url);
  } catch (error) {
    const details = page.diagnostics.length ? `\nBrowser exceptions:\n${page.diagnostics.join('\n')}` : '';
    page.close();
    throw new Error(`${error.message}${details}`);
  }
  return page;
}

async function navigate(page, url) {
  await page.evaluate('delete document.documentElement.dataset.s07Ready');
  await page.send('Page.navigate', { url });
  await waitFor(() => page.evaluate(`${JSON.stringify(url)} === location.href && document.documentElement.dataset.s07Ready === "true"`, 500), `page did not load ${url}`);
}

async function reload(page) {
  const url = await page.evaluate('location.href');
  await page.evaluate('delete document.documentElement.dataset.s07Ready');
  await page.send('Page.reload');
  await waitFor(() => page.evaluate(`${JSON.stringify(url)} === location.href && document.documentElement.dataset.s07Ready === "true"`, 500), `page did not reload ${url}`);
}

function call(page, method, ...args) {
  return page.evaluate(`window.__s07[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 15_000);
}

async function uiContains(page, text, timeoutMs = 5_000) {
  return waitFor(async () => (await call(page, 'text')).includes(text), `UI did not contain ${text}`, timeoutMs);
}

async function waitForManualResolve(page, message) {
  return waitFor(async () => (await call(page, 'buttons'))
    .some((button) => button.text.includes('Sonucu tekrar kontrol et') && !button.disabled), message);
}

function passed(name) { console.log(`S07 browser passed: ${name}`); }

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
      lib: { entry: path.join(root, 'tests/browser/s07-booking-recovery.ts'), formats: ['es'] },
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
    try { return /^\d+$/.test(readFileSync(activePort, 'utf8').split(/\r?\n/)[0]) && readFileSync(activePort, 'utf8').split(/\r?\n/)[0]; }
    catch { return false; }
  }, 'Chrome did not expose a debugging port', 10_000);
  const debugUrl = `http://127.0.0.1:${port}`;
  pageA = await openPage(debugUrl, `${origin}/harness`);
  pageB = await openPage(debugUrl, `${origin}/harness`);
  assert.notEqual(pageA.targetId, pageB.targetId, 'the regression must use two real Chrome pages');

  const first = await call(pageA, 'candidate', 'Case-Salon', 1);
  const second = await call(pageB, 'candidate', 'case-salon', 2);
  const raced = await Promise.all([call(pageA, 'acquire', first), call(pageB, 'acquire', second)]);
  assert.equal(raced.filter((item) => item.created).length, 1);
  assert.equal(raced[0].record.id, raced[1].record.id);
  assert.equal((await call(pageB, 'load', 'CASE-SALON')).length, 1);
  passed('two-page atomic acquire and case-normalized scope');

  const corrupt = await call(pageA, 'candidate', 'corrupt-salon', 3);
  await call(pageA, 'injectCorruptRecord', 'corrupt-salon');
  const blocked = await call(pageB, 'acquire', corrupt);
  assert.equal(blocked.created, false);
  assert.equal(blocked.record.status, 'legacy_unknown');
  assert.ok(!JSON.stringify(blocked.record).includes('must-not-survive'));
  passed('corrupt rows redact and fail closed');

  const oldIntent = await call(pageA, 'candidate', 'late-callback-salon', 4);
  const oldRecord = (await call(pageA, 'acquire', oldIntent)).record;
  await call(pageA, 'complete', oldRecord.id, ['submitting'], 'closed_absent');
  assert.equal(await call(pageA, 'dismiss', oldRecord.id), true);
  const newIntent = await call(pageB, 'candidate', 'late-callback-salon', 5);
  const newRecord = (await call(pageB, 'acquire', newIntent)).record;
  const late = await call(pageA, 'complete', oldRecord.id, ['submitting', 'unresolved'], 'committed');
  assert.equal(late.applied, false);
  assert.equal((await call(pageA, 'load', 'late-callback-salon'))[0].id, newRecord.id);
  passed('late callbacks cannot clear a newer intent');

  fixture.bookMode = 'hang';
  fixture.clockOffsetSeconds = -24 * 60 * 60;
  await navigate(pageA, `${origin}/harness?mode=ui&slug=settle-salon`);
  const beforeSettleSubmit = Date.now();
  await call(pageA, 'uiSubmit');
  await waitFor(() => requestCount('/settle-salon/book') === 1, 'create request did not start');
  await navigate(pageB, `${origin}/harness?mode=ui&slug=settle-salon`);
  await uiContains(pageB, 'Önceki');
  const settling = (await call(pageB, 'load', 'settle-salon'))[0];
  const afterSettleLoad = Date.now();
  assert.ok(settling.sampledAtEpochMs >= beforeSettleSubmit && settling.sampledAtEpochMs <= afterSettleLoad, 'local TTL inherited the server clock');
  assert.equal(settling.expiresAtEpochMs - settling.sampledAtEpochMs, 72 * 60 * 60 * 1000);
  assert.ok(settling.submitDeadlineEpochSeconds < Math.floor(Date.now() / 1000) - 23 * 60 * 60, 'deadline did not use the server clock');
  await reload(pageB);
  await sleep(300);
  assert.equal(requestCount('/booking/resolve'), 0, 'reload resolved while the create settle window was open');
  const settleButtons = await call(pageB, 'buttons');
  assert.ok(settleButtons.some((button) => button.text.includes('İlk istek tamamlanıyor') && button.disabled));
  await navigate(pageA, `${origin}/harness`);
  await navigate(pageB, `${origin}/harness`);
  for (const response of fixture.hanging) response.destroy();
  passed('reload waits for an in-flight create settle window');

  fixture.bookMode = 'success';
  fixture.clockOffsetSeconds = 0;
  await navigate(pageA, `${origin}/harness?mode=ui&slug=receipt-salon`);
  await call(pageA, 'uiSubmit');
  await uiContains(pageA, 'RANDEVU OLUŞTURULDU');
  const managementHref = (await call(pageA, 'links')).find((href) => href?.startsWith('/m#'));
  assert.match(managementHref, /^\/m#[A-Za-z0-9_-]{43}$/);
  const receipt = await waitFor(async () => {
    const record = (await call(pageB, 'load', 'receipt-salon'))[0];
    return record?.status === 'committed' ? record : false;
  }, 'successful booking receipt was not persisted');
  for (const forbidden of ['recoverySecret', 'idempotencyKey', 'requestFingerprint', 'ownerId', managementHref]) {
    assert.ok(!JSON.stringify(receipt).includes(forbidden), `terminal receipt retained ${forbidden}`);
  }
  await navigate(pageB, `${origin}/harness?mode=ui&slug=receipt-salon`);
  await uiContains(pageB, 'RANDEVU KAYDI BULUNDU');
  await reload(pageB);
  await uiContains(pageB, 'RANDEVU KAYDI BULUNDU');
  assert.ok(!(await call(pageB, 'links')).some((href) => href?.includes('#')));
  await call(pageB, 'clickButton', 'Yeni randevu');
  await uiContains(pageB, 'Hizmet ve tarih');
  assert.equal((await call(pageB, 'load', 'receipt-salon')).length, 0);
  passed('proofless receipt survives another tab and requires explicit new action');

  const resolvedIntent = await call(pageA, 'candidate', 'committed-resolve-salon', 15);
  const resolvedPending = (await call(pageA, 'acquire', resolvedIntent)).record;
  await call(pageA, 'unresolved', resolvedPending.id, resolvedIntent.ownerId);
  fixture.resolveMode = 'committed';
  const committedResolveCalls = requestCount('/booking/resolve');
  await navigate(pageB, `${origin}/harness?mode=ui&slug=committed-resolve-salon`);
  await uiContains(pageB, 'Önceki');
  await call(pageB, 'clickButton', 'kontrol');
  await uiContains(pageB, 'RANDEVU OLUŞTURULDU');
  assert.equal(requestCount('/booking/resolve'), committedResolveCalls + 1);
  assert.ok((await call(pageB, 'links')).includes(`/m#${Buffer.alloc(32, 17).toString('base64url')}`));
  const resolvedReceipt = await waitFor(async () => {
    const record = (await call(pageA, 'load', 'committed-resolve-salon'))[0];
    return record?.status === 'committed' ? record : false;
  }, 'resolved committed receipt was not persisted');
  for (const key of ['recoverySecret', 'idempotencyKey', 'requestFingerprint', 'ownerId']) {
    assert.ok(!Object.hasOwn(resolvedReceipt, key));
  }
  await navigate(pageA, `${origin}/harness?mode=ui&slug=committed-resolve-salon`);
  await uiContains(pageA, 'RANDEVU KAYDI BULUNDU');
  assert.ok(!(await call(pageA, 'links')).some((href) => href?.includes('#')));
  passed('manual committed resolve keeps its capability in the resolving page only');

  const unresolvedIntent = await call(pageA, 'candidate', 'unresolved-salon', 6);
  const unresolvedRecord = (await call(pageA, 'acquire', unresolvedIntent)).record;
  await call(pageA, 'unresolved', unresolvedRecord.id, unresolvedIntent.ownerId);
  fixture.resolveMode = 'not-found';
  await navigate(pageB, `${origin}/harness?mode=ui&slug=unresolved-salon`);
  await uiContains(pageB, 'Önceki');
  assert.ok(!(await call(pageB, 'buttons')).some((button) => button.text.includes('Cihazdaki hatırlatıcıyı kaldır')));
  let resolveCalls = requestCount('/booking/resolve');
  for (const mode of ['malformed', 'mismatched']) {
    fixture.resolveMode = mode;
    await call(pageB, 'clickButton', 'kontrol');
    resolveCalls += 1;
    await waitFor(() => requestCount('/booking/resolve') === resolveCalls, `${mode} resolve request did not run`);
    await waitForManualResolve(pageB, `${mode} resolve did not settle UI`);
    assert.equal((await call(pageA, 'load', 'unresolved-salon'))[0].status, 'unresolved');
  }
  fixture.resolveMode = 'rate-limit';
  await call(pageB, 'clickButton', 'kontrol');
  resolveCalls += 1;
  await waitFor(() => requestCount('/booking/resolve') === resolveCalls, 'rate-limited resolve request did not run');
  await uiContains(pageB, '1 saniye');
  await sleep(300);
  assert.equal(requestCount('/booking/resolve'), resolveCalls, '429 caused an immediate retry');
  await waitForManualResolve(pageB, 'rate-limited resolve did not settle UI');
  fixture.resolveMode = 'not-found';
  await call(pageB, 'clickButton', 'kontrol');
  resolveCalls += 1;
  await waitFor(() => requestCount('/booking/resolve') === resolveCalls, '404 resolve request did not run');
  assert.equal((await call(pageA, 'load', 'unresolved-salon'))[0].status, 'unresolved');
  assert.equal(await call(pageA, 'dismiss', unresolvedRecord.id), false);
  await waitForManualResolve(pageB, '404 resolve did not settle UI');
  fixture.resolveMode = 'hang-body';
  await call(pageB, 'clickButton', 'kontrol');
  resolveCalls += 1;
  await waitFor(() => requestCount('/booking/resolve') === resolveCalls, 'body-hang resolve request did not run');
  await sleep(10_500);
  assert.equal((await call(pageA, 'load', 'unresolved-salon'))[0].status, 'unresolved');
  await waitFor(() => fixture.hanging.size === 0, 'browser timeout did not close the response', 2_000);
  await waitForManualResolve(pageB, 'timeout resolve did not settle UI');
  fixture.resolveMode = 'exists_nolink';
  await call(pageB, 'clickButton', 'kontrol');
  await uiContains(pageB, 'RANDEVU KAYDI BULUNDU');
  assert.equal((await call(pageA, 'load', 'unresolved-salon'))[0].status, 'exists_nolink');
  assert.ok(!(await call(pageB, 'links')).some((href) => href?.includes('#')));
  passed('generic 404 and body timeout preserve pending until exists_nolink');

  const closedIntent = await call(pageA, 'candidate', 'closed-salon', 13);
  const closedRecord = (await call(pageA, 'acquire', closedIntent)).record;
  await call(pageA, 'unresolved', closedRecord.id, closedIntent.ownerId);
  fixture.resolveMode = 'closed_absent';
  const closedPosts = requestCount('/closed-salon/book');
  await navigate(pageB, `${origin}/harness?mode=ui&slug=closed-salon`);
  await uiContains(pageB, 'Önceki');
  await call(pageB, 'clickButton', 'kontrol');
  await uiContains(pageB, 'güvenli olarak kapatıldı');
  assert.equal((await call(pageA, 'load', 'closed-salon'))[0].status, 'closed_absent');
  assert.equal(requestCount('/closed-salon/book'), closedPosts);
  passed('closed_absent reopens the form without a background create');

  const expiredV2 = await call(pageA, 'candidate', 'expired-v2-salon', 14);
  expiredV2.sampledAtEpochMs = Date.now() - 72 * 60 * 60 * 1000 - 2_000;
  expiredV2.expiresAtEpochMs = Date.now() - 1_000;
  expiredV2.settleAfterEpochMs = expiredV2.sampledAtEpochMs + 12_000;
  assert.equal((await call(pageA, 'acquire', expiredV2)).created, true);
  const expiredV2Record = (await call(pageB, 'load', 'expired-v2-salon'))[0];
  assert.equal(expiredV2Record.status, 'expired_unverified');
  assert.ok(!Object.hasOwn(expiredV2Record, 'recoverySecret'));
  passed('expired persisted v2 proof becomes a redacted marker');

  const dualSlug = 'legacy-dual-salon';
  const legacyA = await call(pageA, 'legacyValue', dualSlug, 7, 0);
  const legacyB = await call(pageB, 'legacyValue', dualSlug, 8, 0);
  await call(pageA, 'setLegacy', dualSlug, legacyA);
  await call(pageB, 'setLegacy', dualSlug, legacyB);
  await Promise.all([call(pageA, 'load', dualSlug), call(pageB, 'load', dualSlug)]);
  assert.equal((await call(pageA, 'load', dualSlug)).filter((record) => record.status === 'legacy_pending').length, 2);

  const replaySlug = 'legacy-replay-salon';
  const replayRaw = await call(pageA, 'legacyValue', replaySlug, 9, 0);
  await call(pageA, 'setLegacy', replaySlug, replayRaw);
  const replay = (await call(pageA, 'load', replaySlug))[0];
  await call(pageA, 'complete', replay.id, ['legacy_pending'], 'committed');
  await call(pageA, 'setLegacy', replaySlug, replayRaw);
  const replayed = await call(pageA, 'load', replaySlug);
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].status, 'committed');
  assert.ok(!Object.hasOwn(replayed[0], 'recoverySecret'));

  const expiredSlug = 'legacy-expired-salon';
  const expiredRaw = await call(pageA, 'legacyValue', expiredSlug, 10, 72 * 60 * 60 * 1000 + 1_000);
  await call(pageA, 'setLegacy', expiredSlug, expiredRaw);
  const expired = (await call(pageA, 'load', expiredSlug))[0];
  assert.equal(expired.status, 'expired_unverified');
  assert.ok(!Object.hasOwn(expired, 'recoverySecret'));
  const brokenSlug = 'legacy-broken-salon';
  await call(pageB, 'setLegacy', brokenSlug, '{"customerEmail":"private@example.test","recoverySecret":"private-proof"');
  const broken = (await call(pageB, 'load', brokenSlug))[0];
  assert.equal(broken.status, 'legacy_unknown');
  assert.ok(!JSON.stringify(broken).includes('private@example.test'));
  passed('dual, replayed, expired and corrupt legacy imports stay safe');

  const legacyUiSlug = 'legacy-forget-salon';
  const legacyUiRaw = await call(pageA, 'legacyValue', legacyUiSlug, 11, 0);
  await call(pageA, 'setLegacy', legacyUiSlug, legacyUiRaw);
  await call(pageA, 'load', legacyUiSlug);
  await navigate(pageA, `${origin}/harness?mode=ui&slug=${legacyUiSlug}`);
  await uiContains(pageA, 'hatırlatıcı');
  await call(pageA, 'clickButton', 'hatırlatıcı');
  await waitFor(async () => (await call(pageA, 'load', legacyUiSlug)).length === 0, 'legacy UI forget did not remove its marker');
  assert.equal(await call(pageA, 'forgetLegacy', unresolvedRecord.id), false);
  passed('only legacy state has the explicit device-only forget action');

  const quotaSlug = 'quota-import-salon';
  const quotaRaw = await call(pageA, 'legacyValue', quotaSlug, 12, 0);
  await call(pageA, 'setLegacy', quotaSlug, quotaRaw);
  await pageA.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1 });
  await assert.rejects(() => call(pageA, 'load', quotaSlug));
  assert.equal(await call(pageA, 'hasLegacy', quotaSlug), true, 'aborted import discarded the proof');
  await pageA.send('Storage.overrideQuotaForOrigin', { origin });
  await call(pageA, 'load', quotaSlug);
  assert.equal(await call(pageA, 'hasLegacy', quotaSlug), false);

  const beforeQuotaPosts = requestCount('/quota-create-salon/book');
  await navigate(pageB, `${origin}/harness?mode=ui&slug=quota-create-salon`);
  await pageB.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1 });
  await call(pageB, 'uiSubmit');
  await uiContains(pageB, 'güvenli olarak saklanamadı');
  assert.equal(requestCount('/quota-create-salon/book'), beforeQuotaPosts, 'create POST ran after IndexedDB abort');
  await pageB.send('Storage.overrideQuotaForOrigin', { origin });
  passed('real IndexedDB abort retains legacy proof and blocks create POST');

  console.log('S07 browser booking recovery passed in two Chrome pages.');
} catch (error) {
  console.error(error);
  for (const [name, page] of [['page A', pageA], ['page B', pageB]]) {
    if (page?.diagnostics.length) console.error(`${name} browser exceptions:\n${page.diagnostics.join('\n')}`);
  }
  try { console.error(readFileSync(chromeLog, 'utf8').slice(-4_000)); } catch { /* Chrome may not have started. */ }
  process.exitCode = 1;
} finally {
  for (const response of fixture.hanging) response.destroy();
  pageA?.close();
  pageB?.close();
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
