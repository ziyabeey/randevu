import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f10-settings-review-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const csrfToken = 'R'.repeat(43);
const ids = {
  user: 'e1000000-0000-4000-8000-000000000001',
  businessA: 'e2000000-0000-4000-8000-000000000001',
  businessB: 'e2000000-0000-4000-8000-000000000002',
  membershipA: 'e3000000-0000-4000-8000-000000000001',
  membershipB: 'e3000000-0000-4000-8000-000000000002',
  serviceA: 'e4000000-0000-4000-8000-000000000001',
  serviceB: 'e4000000-0000-4000-8000-000000000002',
  staffA: 'e5000000-0000-4000-8000-000000000001',
  staffB: 'e5000000-0000-4000-8000-000000000002',
};
const state = {
  activeBusinessId: ids.businessA,
  recovery: false,
  sessionDelayMs: 0,
  catalogDelayMs: 0,
  failNextSetup: 1,
  failSetupAfterMutation: false,
  staleNextService: false,
  requests: [],
  serviceA: { id: ids.serviceA, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 10000, currency: 'TRY', active: true, updated_at: '2026-09-15T10:00:00.000Z' },
  serviceB: { id: ids.serviceB, name: 'Boya', duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 20000, currency: 'TRY', active: true, updated_at: '2026-09-15T10:00:00.000Z' },
  staffA: { id: ids.staffA, membership_id: null, name: 'Ada', phone: '5550000000', active: true, updated_at: '2026-09-15T10:00:00.000Z' },
  staffB: { id: ids.staffB, membership_id: null, name: 'Bora', phone: '5550000001', active: true, updated_at: '2026-09-15T10:00:00.000Z' },
  assignmentA: { staff_id: ids.staffA, service_id: ids.serviceA, active: true, updated_at: '2026-09-15T10:00:00.000Z' },
  businessHoursA: [{ id: 'bh-a-1', weekday: 1, starts_local: '09:00:00', ends_local: '17:00:00', active: true }],
  staffHoursA: [{ id: 'sh-a-1', staff_id: ids.staffA, weekday: 1, starts_local: '09:00:00', ends_local: '17:00:00', active: true }],
  blocksA: [],
};
let testJs;
let testCss;
const sockets = new Set();

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function assertCsrf(request) {
  assert.equal(request.headers['x-yzt-csrf'], csrfToken, 'unsafe fixture request missing CSRF header');
}
function membership(businessId) {
  return {
    id: businessId === ids.businessA ? ids.membershipA : ids.membershipB,
    business_id: businessId,
    role: 'owner',
    active: true,
  };
}
function catalogFor(businessId) {
  if (businessId === ids.businessB) return { membership: membership(businessId), services: [state.serviceB], staff: [state.staffB], assignments: [] };
  return { membership: membership(ids.businessA), services: [state.serviceA], staff: [state.staffA], assignments: [state.assignmentA] };
}
function setupFor(businessId) {
  if (businessId === ids.businessB) return { membership: membership(businessId), timezone: 'Europe/Istanbul', businessHours: [], staffHours: [], blocks: [] };
  return { membership: membership(ids.businessA), timezone: 'Europe/Istanbul', businessHours: state.businessHoursA, staffHours: state.staffHoursA, blocks: state.blocksA };
}
function bump(value) {
  return new Date(Date.parse(value) + 1000).toISOString();
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(testJs);
      return;
    }
    if (url.pathname === '/test.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' });
      response.end(testCss);
      return;
    }
    if (url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><link rel="stylesheet" href="/test.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
      return;
    }

    const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await bodyOf(request);
    state.requests.push({ method: request.method, path: url.pathname, businessId: state.activeBusinessId, body });

    if (request.method === 'GET' && url.pathname === '/api/session') {
      const businessId = state.activeBusinessId;
      if (state.sessionDelayMs) await sleep(state.sessionDelayMs);
      return sendJson(response, 200, {
        user: { id: ids.user, email: 'owner@example.test', fullName: 'Owner' },
        memberships: businessId ? [membership(businessId)] : [],
        activeBusinessId: businessId,
        passwordRecovery: state.recovery,
        csrfToken,
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog') {
      const businessId = state.activeBusinessId;
      const delayMs = state.catalogDelayMs;
      if (delayMs) await sleep(delayMs);
      return sendJson(response, 200, catalogFor(businessId));
    }
    if (request.method === 'GET' && url.pathname === '/api/availability/setup') {
      const businessId = state.activeBusinessId;
      if (state.failNextSetup > 0) {
        state.failNextSetup -= 1;
        return sendJson(response, 503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Ayar servisine şu anda ulaşılamıyor.' } });
      }
      return sendJson(response, 200, setupFor(businessId));
    }

    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') assertCsrf(request);

    if (request.method === 'PATCH' && url.pathname === `/api/services/${ids.serviceA}`) {
      if (state.staleNextService) {
        state.staleNextService = false;
        state.serviceA = { ...state.serviceA, price_minor: 14000, updated_at: bump(state.serviceA.updated_at) };
        return sendJson(response, 409, { error: { code: 'STALE_WRITE', message: 'Bu kayıt başka bir oturumda değişti.' } });
      }
      assert.equal(body.expectedUpdatedAt, state.serviceA.updated_at);
      state.serviceA = {
        ...state.serviceA,
        name: body.name ?? state.serviceA.name,
        duration_minutes: body.durationMinutes ?? state.serviceA.duration_minutes,
        buffer_before_minutes: body.bufferBeforeMinutes ?? state.serviceA.buffer_before_minutes,
        buffer_after_minutes: body.bufferAfterMinutes ?? state.serviceA.buffer_after_minutes,
        price_minor: body.priceMinor ?? state.serviceA.price_minor,
        active: body.active ?? state.serviceA.active,
        updated_at: bump(state.serviceA.updated_at),
      };
      if (state.failSetupAfterMutation) {
        state.failSetupAfterMutation = false;
        state.failNextSetup = 1;
      }
      return sendJson(response, 200, { service: state.serviceA });
    }
    if (request.method === 'PUT' && url.pathname === `/api/staff/${ids.staffA}/services/${ids.serviceA}`) {
      assert.equal(body.expectedUpdatedAt, state.assignmentA.updated_at);
      state.assignmentA = { ...state.assignmentA, active: body.active, updated_at: bump(state.assignmentA.updated_at) };
      return sendJson(response, 200, { assignment: state.assignmentA });
    }
    if (request.method === 'PUT' && url.pathname === `/api/availability/staff/${ids.staffA}/hours/1`) {
      assert.deepEqual(body.expectedIntervals, state.staffHoursA.map((row) => ({ start: row.starts_local.slice(0, 5), end: row.ends_local.slice(0, 5) })));
      state.staffHoursA = body.intervals.map((row, index) => ({ id: `sh-a-${index + 2}`, staff_id: ids.staffA, weekday: 1, starts_local: `${row.start}:00`, ends_local: `${row.end}:00`, active: true }));
      return sendJson(response, 200, { hours: state.staffHoursA });
    }
    if (request.method === 'POST' && url.pathname === '/api/availability/blocks') {
      const block = { id: `block-${state.blocksA.length + 1}`, staff_id: body.staffId, starts_at: `${body.date}T${body.start}:00+03:00`, ends_at: `${body.date}T${body.end}:00+03:00`, reason: body.reason, active: true };
      state.blocksA = [...state.blocksA, block];
      return sendJson(response, 201, { block });
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/availability/blocks/')) {
      const id = url.pathname.split('/').at(-1);
      state.blocksA = state.blocksA.filter((block) => block.id !== id);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/availability/slots') return sendJson(response, 200, { slots: [] });
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `fixture missing ${url.pathname}` } });
  } catch (error) {
    return sendJson(response, 500, { error: { message: error instanceof Error ? error.message : 'fixture error' } });
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
    await sleep(50);
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
  return page.evaluate(`window.__f10settingsReview[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function uiContains(page, text, timeoutMs = 8_000) {
  return waitFor(async () => (await call(page, 'text')).includes(text), `UI did not contain ${text}`, timeoutMs);
}
async function uiExcludes(page, text) {
  assert.equal((await call(page, 'text')).includes(text), false, `UI unexpectedly contained ${text}`);
}
async function reloadPage(page) {
  await page.send('Page.reload', { ignoreCache: true });
  await waitFor(() => page.evaluate('document.documentElement.dataset.f10SettingsReviewReady === "true"'), 'review harness did not reboot');
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
      lib: { entry: path.join(root, 'tests/browser/f10-catalog-settings-review.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js', assetFileNames: 'test.[ext]' } },
    },
  });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  testCss = readFileSync(path.join(bundleDir, 'test.css'));
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
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(`${origin}/harness`)}`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await waitFor(() => page.evaluate('document.documentElement.dataset.f10SettingsReviewReady === "true"'), 'F10-04 review harness did not boot');

  // Initial transient read failure is an explicit error state, not the no-workspace state.
  await uiContains(page, 'Ayarlar yüklenemedi.');
  await uiContains(page, 'Tekrar yükle');
  await uiExcludes(page, 'Önce çalışma alanını seçin.');
  assert.equal(await call(page, 'clickButton', 'Tekrar yükle'), true);
  await uiContains(page, 'Hizmet, ekip ve çalışma düzeni');
  await uiContains(page, 'Kesim');

  // Stale service edit is not retried; an external winner is reloaded and the stale form is discarded.
  state.staleNextService = true;
  assert.equal(await call(page, 'setInArticle', 'Kesim', 'price', '130.00'), true);
  assert.equal(await call(page, 'submitInArticle', 'Kesim'), true);
  await uiContains(page, 'Güncel bilgiler yeniden yüklendi');
  await waitFor(async () => (await call(page, 'valueInArticle', 'Kesim', 'price')) === '140.00', 'stale service form was not reconciled to authoritative value');
  assert.equal(state.serviceA.price_minor, 14000);

  // Assignment path is exercised on the real settings surface.
  assert.equal(await call(page, 'assignmentChecked', 'Ada', 'Kesim'), true);
  assert.equal(await call(page, 'toggleAssignment', 'Ada', 'Kesim'), true);
  await waitFor(() => state.assignmentA.active === false, 'assignment toggle not persisted');
  await waitFor(async () => (await call(page, 'assignmentChecked', 'Ada', 'Kesim')) === false, 'assignment UI not reloaded');

  // Staff-hours path carries expected interval snapshots and reloads.
  assert.equal(await call(page, 'setInSection', 'Personel saatleri', 'start', '18:00'), true);
  assert.equal(await call(page, 'setInSection', 'Personel saatleri', 'end', '20:00'), true);
  assert.equal(await call(page, 'submitInSection', 'Personel saatleri', 'Aralık ekle'), true);
  await waitFor(() => state.staffHoursA.length === 2, 'staff hours append not persisted');
  await uiContains(page, 'Personel çalışma aralığı kaydedildi');

  // Block create/delete path is covered end-to-end.
  assert.equal(await call(page, 'setInSection', 'İzin / kapanış', 'reason', 'Toplantı'), true);
  assert.equal(await call(page, 'submitInSection', 'İzin / kapanış', 'Kapanış ekle'), true);
  await waitFor(() => state.blocksA.length === 1, 'availability block create not persisted');
  await uiContains(page, 'Toplantı');
  assert.equal(await call(page, 'clickInSection', 'İzin / kapanış', 'Sil'), true);
  await waitFor(() => state.blocksA.length === 0, 'availability block delete not persisted');

  // Mutation commits, but refresh fails. Do not show false success or invite a blind mutation retry.
  state.failSetupAfterMutation = true;
  state.catalogDelayMs = 400;
  assert.equal(await call(page, 'setInArticle', 'Kesim', 'duration', '50'), true);
  assert.equal(await call(page, 'submitInArticle', 'Kesim'), true);
  await waitFor(() => state.serviceA.duration_minutes === 50, 'service mutation did not commit before refresh failure');
  await uiContains(page, 'Ayarlar yüklenemedi.');
  await uiExcludes(page, 'Hizmet güncellendi.');

  // Retry switches to business B while the old A catalog read is still outstanding. A cannot overwrite B.
  state.activeBusinessId = ids.businessB;
  state.catalogDelayMs = 0;
  assert.equal(await call(page, 'clickButton', 'Tekrar yükle'), true);
  await uiContains(page, 'Boya');
  await uiContains(page, 'Bora');
  await sleep(500);
  await uiContains(page, 'Boya');
  await uiExcludes(page, 'Kesim');

  // Return to A for responsive and keyboard checks.
  state.activeBusinessId = ids.businessA;
  await reloadPage(page);
  await uiContains(page, 'Kesim');

  for (const width of [360, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(80);
    const metrics = await call(page, 'metrics');
    assert.equal(metrics.width, width);
    assert.ok(metrics.scrollWidth <= width, `horizontal overflow at ${width}px: ${metrics.scrollWidth}`);
    assert.ok(metrics.targetCount >= 10, `too few interactive targets at ${width}px`);
    assert.ok(metrics.minTargetHeight >= 44, `touch target below 44px at ${width}px: ${metrics.minTargetHeight}`);
  }

  await page.evaluate('document.activeElement && document.activeElement.blur()');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  const focus = await page.evaluate(`(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    return { tag: element.tagName, outlineWidth: parseFloat(style.outlineWidth || '0') };
  })()`);
  assert.ok(focus, 'keyboard Tab did not reach an interactive control');
  assert.ok(focus.outlineWidth >= 2, `keyboard focus is not visibly outlined: ${JSON.stringify(focus)}`);

  // Recovery session cannot expose private settings data or issue protected reads after session detection.
  const protectedBeforeRecovery = state.requests.filter((item) => item.path === '/api/catalog' || item.path === '/api/availability/setup').length;
  state.recovery = true;
  await reloadPage(page);
  await uiContains(page, 'Parolanızı güncelledikten sonra');
  await uiExcludes(page, 'Kesim');
  await sleep(100);
  const protectedAfterRecovery = state.requests.filter((item) => item.path === '/api/catalog' || item.path === '/api/availability/setup').length;
  assert.equal(protectedAfterRecovery, protectedBeforeRecovery, 'recovery session reached private settings reads');

  // No-workspace is exclusive from transient error.
  state.recovery = false;
  state.activeBusinessId = null;
  await reloadPage(page);
  await uiContains(page, 'Önce çalışma alanını seçin.');
  await uiExcludes(page, 'Ayarlar yüklenemedi.');

  // Loading state is exclusive and resolves back to ready.
  state.activeBusinessId = ids.businessA;
  state.sessionDelayMs = 300;
  await reloadPage(page);
  await uiContains(page, 'İşletme ayarları hazırlanıyor…', 1_000);
  state.sessionDelayMs = 0;
  await uiContains(page, 'Hizmet, ekip ve çalışma düzeni');

  assert.ok(state.requests.some((item) => item.path === `/api/staff/${ids.staffA}/services/${ids.serviceA}` && item.body.expectedUpdatedAt));
  assert.ok(state.requests.some((item) => item.path === `/api/availability/staff/${ids.staffA}/hours/1` && Array.isArray(item.body.expectedIntervals)));
  assert.ok(state.requests.some((item) => item.path === '/api/availability/blocks' && item.method === 'POST'));
  console.log('F10-04 review Chrome acceptance passed.');
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
