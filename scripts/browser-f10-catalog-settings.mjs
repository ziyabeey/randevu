import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f10-settings-'));
const bundleDir = path.join(work, 'bundle');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = {
  user: 'd1000000-0000-4000-8000-000000000001', business: 'd2000000-0000-4000-8000-000000000001',
  membership: 'd3000000-0000-4000-8000-000000000001', service: 'd4000000-0000-4000-8000-000000000001',
  staff: 'd5000000-0000-4000-8000-000000000001', assignment: '2026-09-14T10:00:00.000Z',
};
const state = {
  service: { id: ids.service, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, price_minor: 10000, currency: 'TRY', active: true, updated_at: '2026-09-14T10:00:00.000Z' },
  staff: { id: ids.staff, membership_id: null, name: 'Ada', phone: '5550000000', active: true, updated_at: '2026-09-14T10:00:00.000Z' },
  assignment: { staff_id: ids.staff, service_id: ids.service, active: true, updated_at: ids.assignment },
  businessHours: [{ id: 'bh-1', weekday: 1, starts_local: '09:00:00', ends_local: '17:00:00', active: true }],
  staffHours: [{ id: 'sh-1', staff_id: ids.staff, weekday: 1, starts_local: '09:00:00', ends_local: '17:00:00', active: true }],
  blocks: [], staleNextService: false, requests: [],
};
let testJs;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function catalog() {
  return {
    membership: { id: ids.membership, business_id: ids.business, role: 'owner', active: true },
    services: [state.service], staff: [state.staff], assignments: [state.assignment],
  };
}
function setup() {
  return {
    membership: { id: ids.membership, business_id: ids.business, role: 'owner', active: true },
    timezone: 'Europe/Istanbul', businessHours: state.businessHours, staffHours: state.staffHours, blocks: state.blocks,
  };
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(testJs); return; }
    if (url.pathname === '/harness') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>'); return; }
    const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await bodyOf(request);
    state.requests.push({ method: request.method, path: url.pathname, body });
    if (request.method === 'GET' && url.pathname === '/api/session') return sendJson(response, 200, {
      user: { id: ids.user, email: 'owner@example.test', fullName: 'Owner' }, memberships: [], activeBusinessId: ids.business,
    });
    if (request.method === 'GET' && url.pathname === '/api/catalog') return sendJson(response, 200, catalog());
    if (request.method === 'GET' && url.pathname === '/api/availability/setup') return sendJson(response, 200, setup());
    if (request.method === 'PATCH' && url.pathname === `/api/services/${ids.service}`) {
      if (state.staleNextService) { state.staleNextService = false; return sendJson(response, 409, { error: { code: 'STALE_WRITE', message: 'Bu kayıt başka bir oturumda değişti. Güncel bilgileri yükleyip tekrar deneyin.' } }); }
      assert.equal(body.expectedUpdatedAt, state.service.updated_at);
      state.service = {
        ...state.service,
        name: body.name ?? state.service.name,
        duration_minutes: body.durationMinutes ?? state.service.duration_minutes,
        buffer_before_minutes: body.bufferBeforeMinutes ?? state.service.buffer_before_minutes,
        buffer_after_minutes: body.bufferAfterMinutes ?? state.service.buffer_after_minutes,
        price_minor: body.priceMinor ?? state.service.price_minor,
        active: body.active ?? state.service.active,
        updated_at: new Date(Date.parse(state.service.updated_at) + 1000).toISOString(),
      };
      return sendJson(response, 200, { service: state.service });
    }
    if (request.method === 'PATCH' && url.pathname === `/api/staff/${ids.staff}`) {
      assert.equal(body.expectedUpdatedAt, state.staff.updated_at);
      state.staff = { ...state.staff, name: body.name ?? state.staff.name, phone: body.phone ?? state.staff.phone, active: body.active ?? state.staff.active, updated_at: new Date(Date.parse(state.staff.updated_at) + 1000).toISOString() };
      return sendJson(response, 200, { staff: state.staff });
    }
    if (request.method === 'PUT' && url.pathname === `/api/staff/${ids.staff}/services/${ids.service}`) {
      assert.equal(body.expectedUpdatedAt, state.assignment.updated_at);
      state.assignment = { ...state.assignment, active: body.active, updated_at: new Date(Date.parse(state.assignment.updated_at) + 1000).toISOString() };
      return sendJson(response, 200, { assignment: state.assignment });
    }
    if (request.method === 'PUT' && url.pathname === '/api/availability/business-hours/1') {
      assert.deepEqual(body.expectedIntervals, state.businessHours.map((row) => ({ start: row.starts_local.slice(0, 5), end: row.ends_local.slice(0, 5) })));
      state.businessHours = body.intervals.map((row, index) => ({ id: `bh-${index + 2}`, weekday: 1, starts_local: `${row.start}:00`, ends_local: `${row.end}:00`, active: true }));
      return sendJson(response, 200, { hours: state.businessHours });
    }
    if (request.method === 'POST' && url.pathname === '/api/availability/blocks') {
      const block = { id: 'block-1', staff_id: body.staffId, starts_at: `${body.date}T${body.start}:00+03:00`, ends_at: `${body.date}T${body.end}:00+03:00`, reason: body.reason, active: true };
      state.blocks = [block]; return sendJson(response, 201, { block });
    }
    if (request.method === 'GET' && url.pathname === '/api/availability/slots') return sendJson(response, 200, { slots: [] });
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `fixture missing ${url.pathname}` } });
  } catch (error) { return sendJson(response, 500, { error: { message: error.message } }); }
});

async function waitFor(fn, message, timeout = 7000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(60);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`);
}
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 1; this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)); if (!message.id) return;
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  static async connect(url) {
    const c = new Cdp(url);
    await Promise.race([new Promise((resolve, reject) => { c.ws.addEventListener('open', resolve, { once: true }); c.ws.addEventListener('error', reject, { once: true }); }), sleep(5000).then(() => { throw new Error('CDP connect timeout'); })]);
    return c;
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 7000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}
const call = (page, method, ...args) => page.eval(`window.__f10settings[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
const textHas = (page, value) => waitFor(async () => (await call(page, 'text')).includes(value), `UI missing ${value}`);

let chrome; let page;
try {
  await build({ configFile: false, root, publicDir: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: bundleDir, emptyOutDir: true, minify: false, lib: { entry: path.join(root, 'tests/browser/f10-catalog-settings.tsx'), formats: ['es'] }, rollupOptions: { output: { entryFileNames: 'test.js' } } } });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; const origin = `http://127.0.0.1:${port}`;
  const chromeBin = process.env.CHROME_BIN; assert.ok(chromeBin, 'CHROME_BIN required');
  const debugPort = 9333 + Math.floor(Math.random() * 300);
  chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  const browserInfo = await waitFor(async () => {
    const result = await fetch(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null);
    return result?.ok ? result.json() : null;
  }, 'Chrome debugging did not start');
  const browser = await Cdp.connect(browserInfo.webSocketDebuggerUrl);
  const created = await browser.send('Target.createTarget', { url: `${origin}/harness` });
  const targets = await browser.send('Target.getTargets');
  const target = targets.targetInfos.find((item) => item.targetId === created.targetId);
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await waitFor(() => page.eval("document.documentElement.dataset.f10SettingsReady === 'true' && !!window.__f10settings"), 'F10-04 harness not ready');
  await textHas(page, 'Hizmet, ekip ve çalışma düzeni'); await textHas(page, 'Kesim'); await textHas(page, 'Ada');

  assert.equal(await call(page, 'setInArticle', 'Kesim', 'duration', '45'), true);
  assert.equal(await call(page, 'setInArticle', 'Kesim', 'bufferBefore', '5'), true);
  assert.equal(await call(page, 'setInArticle', 'Kesim', 'bufferAfter', '10'), true);
  assert.equal(await call(page, 'setInArticle', 'Kesim', 'price', '125.50'), true);
  assert.equal(await call(page, 'submitInArticle', 'Kesim'), true);
  await waitFor(() => state.service.duration_minutes === 45 && state.service.price_minor === 12550, 'service edit not persisted');
  await textHas(page, '45 dk');

  state.staleNextService = true;
  assert.equal(await call(page, 'setInArticle', 'Kesim', 'price', '130.00'), true);
  assert.equal(await call(page, 'submitInArticle', 'Kesim'), true);
  await textHas(page, 'başka bir oturumda değişti');
  assert.equal(state.service.price_minor, 12550);

  assert.equal(await call(page, 'clickInArticle', 'Kesim', 'Arşivle'), true);
  await waitFor(() => state.service.active === false, 'service archive not persisted');
  await textHas(page, 'Geçmiş randevular değişmedi'); await textHas(page, 'Arşivde');
  assert.equal(await call(page, 'clickInArticle', 'Kesim', 'Etkinleştir'), true);
  await waitFor(() => state.service.active === true, 'service re-enable not persisted');

  assert.equal(await call(page, 'setInForm', 'Aralık ekle', 'start', '18:00'), true);
  assert.equal(await call(page, 'setInForm', 'Aralık ekle', 'end', '20:00'), true);
  assert.equal(await call(page, 'submit', 'Aralık ekle'), true);
  await waitFor(() => state.businessHours.length === 2, 'business hours append not persisted');
  await textHas(page, 'mevcut randevuları taşımaz');

  assert.ok(state.requests.some((item) => item.path === `/api/services/${ids.service}` && item.body.expectedUpdatedAt));
  assert.ok(state.requests.some((item) => item.path === '/api/availability/business-hours/1' && Array.isArray(item.body.expectedIntervals)));
  console.log('F10-04 Chrome settings acceptance passed.');
  browser.close();
} finally {
  page?.close(); chrome?.kill('SIGKILL');
  await new Promise((resolve) => server.close(resolve)).catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
