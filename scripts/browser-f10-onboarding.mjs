import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f10-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const csrfToken = 'C'.repeat(43);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ids = {
  user: 'c1000000-0000-4000-8000-000000000001',
  a: 'c2000000-0000-4000-8000-000000000001',
  b: 'c2000000-0000-4000-8000-000000000002',
  ma: 'c3000000-0000-4000-8000-000000000001',
  mb: 'c3000000-0000-4000-8000-000000000002',
  serviceA: 'c4000000-0000-4000-8000-000000000001',
  serviceB: 'c4000000-0000-4000-8000-000000000002',
  staffA: 'c5000000-0000-4000-8000-000000000001',
  staffB: 'c5000000-0000-4000-8000-000000000002',
};

const state = {
  selected: ids.a,
  requests: [],
  businesses: {
    [ids.a]: {
      id: ids.a,
      membershipId: ids.ma,
      name: 'Salon A',
      slug: 'salon-a',
      services: [{ id: ids.serviceA, name: 'A Only Service', duration_minutes: 30, price_minor: 25000, currency: 'TRY', active: true }],
      staff: [{ id: ids.staffA, membership_id: ids.ma, name: 'A Owner', phone: null, active: true }],
      assignments: [{ staff_id: ids.staffA, service_id: ids.serviceA, active: true }],
      businessHours: [{ id: 'bha', weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00', active: true }],
      staffHours: [{ id: 'sha', staff_id: ids.staffA, weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00', active: true }],
      enabled: false,
    },
  },
};

let testJs;
const sockets = new Set();

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function memberships() {
  return Object.values(state.businesses).map((business) => ({
    id: business.membershipId,
    business_id: business.id,
    role: 'owner',
    active: true,
    businesses: { id: business.id, name: business.name, slug: business.slug, timezone: 'Europe/Istanbul' },
  }));
}

function readiness(business) {
  const services = business.services.filter((item) => item.active);
  const staff = business.staff.filter((item) => item.active);
  const assignments = business.assignments.filter((item) => item.active
    && services.some((service) => service.id === item.service_id)
    && staff.some((person) => person.id === item.staff_id));
  const hasBusinessHours = business.businessHours.length > 0;
  const hasStaffHours = business.staffHours.some((hours) => assignments.some((item) => item.staff_id === hours.staff_id));
  const overlap = business.businessHours.some((bh) => business.staffHours.some((sh) => sh.weekday === bh.weekday
    && assignments.some((item) => item.staff_id === sh.staff_id)
    && bh.starts_local < sh.ends_local && sh.starts_local < bh.ends_local));
  const flags = {
    has_active_service: services.length > 0,
    has_active_staff: staff.length > 0,
    has_active_assignment: assignments.length > 0,
    has_business_hours: hasBusinessHours,
    has_staff_hours: hasStaffHours,
    has_overlapping_hours: overlap,
  };
  const missing = [];
  if (!flags.has_active_service) missing.push('SERVICE_REQUIRED');
  if (!flags.has_active_staff) missing.push('STAFF_REQUIRED');
  if (!flags.has_active_assignment) missing.push('ASSIGNMENT_REQUIRED');
  if (!flags.has_business_hours) missing.push('BUSINESS_HOURS_REQUIRED');
  if (!flags.has_staff_hours) missing.push('STAFF_HOURS_REQUIRED');
  if (!flags.has_overlapping_hours) missing.push('OVERLAPPING_HOURS_REQUIRED');
  return { business_id: business.id, ...flags, publishable: missing.length === 0, missing_reasons: missing };
}

function snapshot() {
  const business = state.businesses[state.selected];
  return {
    membership: { id: business.membershipId, business_id: business.id, role: 'owner', active: true },
    business: { id: business.id, name: business.name, slug: business.slug, timezone: 'Europe/Istanbul' },
    services: business.services,
    staff: business.staff,
    assignments: business.assignments,
    businessHours: business.businessHours,
    staffHours: business.staffHours,
    settings: { business_id: business.id, enabled: business.enabled, step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 },
    readiness: readiness(business),
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
    if (url.pathname === '/setup' || url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
      return;
    }

    const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readJson(request);
    state.requests.push({ method: request.method, path: url.pathname, body });

    if (request.method === 'GET' && url.pathname === '/api/session') {
      return sendJson(response, 200, {
        user: { id: ids.user, email: 'browser-owner@example.test', fullName: 'Browser Owner' },
        memberships: memberships(),
        activeBusinessId: state.selected,
        passwordRecovery: false,
        csrfToken,
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/onboarding') return sendJson(response, 200, snapshot());

    if (request.method === 'POST' && url.pathname === '/api/businesses') {
      assert.equal(body.name, 'Salon B');
      state.businesses[ids.b] = {
        id: ids.b,
        membershipId: ids.mb,
        name: 'Salon B',
        slug: 'salon-b',
        services: [],
        staff: [],
        assignments: [],
        businessHours: [],
        staffHours: [],
        enabled: false,
      };
      state.selected = ids.b;
      return sendJson(response, 201, { business: { id: ids.b, name: 'Salon B', slug: 'salon-b', timezone: 'Europe/Istanbul', role: 'owner' } });
    }

    if (request.method === 'POST' && url.pathname === '/api/businesses/select') {
      if (!state.businesses[body.businessId]) return sendJson(response, 403, { error: { code: 'TENANT_FORBIDDEN' } });
      state.selected = body.businessId;
      return sendJson(response, 200, { ok: true });
    }

    const business = state.businesses[state.selected];
    if (request.method === 'POST' && url.pathname === '/api/services') {
      const service = { id: ids.serviceB, name: body.name, duration_minutes: body.durationMinutes, price_minor: body.priceMinor, currency: 'TRY', active: true };
      business.services = [service];
      return sendJson(response, 201, { service });
    }
    if (request.method === 'POST' && url.pathname === '/api/staff') {
      const staff = { id: ids.staffB, membership_id: null, name: body.name, phone: body.phone || null, active: true };
      business.staff = [staff];
      return sendJson(response, 201, { staff });
    }
    if (request.method === 'PUT' && url.pathname === `/api/staff/${ids.staffB}/services/${ids.serviceB}`) {
      business.assignments = [{ staff_id: ids.staffB, service_id: ids.serviceB, active: true }];
      return sendJson(response, 200, { assignment: business.assignments[0] });
    }
    if (request.method === 'PUT' && url.pathname === `/api/team/staff/${ids.staffB}/membership`) {
      assert.equal(body.membershipId, ids.mb);
      business.staff[0].membership_id = ids.mb;
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'PUT' && /^\/api\/availability\/business-hours\/\d$/.test(url.pathname)) {
      business.businessHours = [{ id: 'bhb', weekday: Number(url.pathname.split('/').at(-1)), starts_local: `${body.intervals[0].start}:00`, ends_local: `${body.intervals[0].end}:00`, active: true }];
      return sendJson(response, 200, { hours: business.businessHours });
    }
    if (request.method === 'PUT' && url.pathname === `/api/availability/staff/${ids.staffB}/hours/1`) {
      business.staffHours = [{ id: 'shb', staff_id: ids.staffB, weekday: 1, starts_local: `${body.intervals[0].start}:00`, ends_local: `${body.intervals[0].end}:00`, active: true }];
      return sendJson(response, 200, { hours: business.staffHours });
    }
    if (request.method === 'GET' && url.pathname === '/api/availability/slots') {
      return sendJson(response, 200, { slots: [{ staff_id: ids.staffB, staff_name: 'Browser Owner', starts_at: '2026-09-21T07:00:00.000Z', ends_at: '2026-09-21T07:45:00.000Z', timezone: 'Europe/Istanbul' }] });
    }
    if (request.method === 'PUT' && url.pathname === '/api/public/settings') {
      if (body.enabled && !readiness(business).publishable) return sendJson(response, 409, { error: { code: 'PUBLIC_BOOKING_NOT_READY', message: 'Kurulum eksik.' } });
      business.enabled = body.enabled;
      return sendJson(response, 200, { settings: { ...snapshot().settings, enabled: business.enabled } });
    }

    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Fixture route missing.' } });
  } catch (error) {
    return sendJson(response, 500, { error: { message: error.message } });
  }
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

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
  return page.evaluate(`window.__f10[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}

async function uiContains(page, text, timeoutMs = 7_000) {
  return waitFor(async () => (await call(page, 'text')).includes(text), `UI did not contain ${text}`, timeoutMs);
}

async function uiOmits(page, text, timeoutMs = 7_000) {
  return waitFor(async () => !(await call(page, 'text')).includes(text), `UI still contained ${text}`, timeoutMs);
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
      lib: { entry: path.join(root, 'tests/browser/f10-onboarding.tsx'), formats: ['es'] },
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
    try { return readFileSync(activePort, 'utf8').split(/\r?\n/)[0] || false; }
    catch { return false; }
  }, 'Chrome did not expose a debugging port', 10_000);
  const debugUrl = `http://127.0.0.1:${port}`;
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(`${origin}/setup`)}`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await waitFor(() => page.evaluate('document.documentElement.dataset.f10Ready === "true"'), 'F10 harness did not boot');
  await uiContains(page, 'A Only Service');

  await page.evaluate('document.querySelector("summary")?.click()');
  assert.equal(await call(page, 'set', 'name', 'Salon B'), true);
  assert.equal(await call(page, 'submit', 'Oluştur'), true);
  await uiContains(page, 'Salon B');
  await uiOmits(page, 'A Only Service');
  assert.equal(state.selected, ids.b);

  assert.equal(await call(page, 'set', 'name', 'B Only Service'), true);
  assert.equal(await call(page, 'set', 'duration', '45'), true);
  assert.equal(await call(page, 'set', 'price', '350'), true);
  assert.equal(await call(page, 'submit', 'İlk hizmeti ekle'), true);
  await uiContains(page, 'B Only Service');

  assert.equal(await call(page, 'set', 'name', 'Browser Owner'), true);
  assert.equal(await call(page, 'check', 'ownerAsStaff', true), true);
  assert.equal(await call(page, 'submit', 'Personeli ekle'), true);
  await uiContains(page, 'Personel eklendi.');
  assert.equal(state.businesses[ids.b].staff[0].membership_id, ids.mb);

  assert.equal(await call(page, 'submit', 'Çalışma gününü kaydet'), true);
  await uiContains(page, 'Çalışma saatleri kaydedildi.');
  await uiContains(page, 'Yayına hazır');

  assert.equal(await call(page, 'set', 'date', '2026-09-21'), true);
  assert.equal(await call(page, 'submit', 'Saatleri önizle'), true);
  await uiContains(page, '10:00');

  assert.equal(await call(page, 'click', 'Rezervasyon sayfasını yayınla'), true);
  await uiContains(page, 'Rezervasyon sayfanız yayında.');
  assert.equal(state.businesses[ids.b].enabled, true);
  assert.ok((await call(page, 'links')).includes('/r/salon-b'));

  assert.equal(await call(page, 'click', 'Salon A'), true);
  await uiContains(page, 'A Only Service');
  await uiOmits(page, 'B Only Service');
  assert.equal(state.selected, ids.a);

  const paths = state.requests.map((item) => `${item.method} ${item.path}`);
  for (const expected of [
    'POST /api/businesses',
    `PUT /api/team/staff/${ids.staffB}/membership`,
    'PUT /api/availability/business-hours/1',
    `PUT /api/availability/staff/${ids.staffB}/hours/1`,
    'PUT /api/public/settings',
    'POST /api/businesses/select',
  ]) assert.ok(paths.includes(expected), `browser flow missed ${expected}`);

  console.log('F10-03 browser passed: second business create, owner-as-staff, hours, preview, publish and A/B switch without setup-state leakage.');
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
