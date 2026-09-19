import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f1205-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sockets = new Set();
const requests = [];
const recoveries = new Map();
let testJs = Buffer.alloc(0);
let testCss = Buffer.alloc(0);
let chrome;
let chromeFd;

const serviceA = '41000000-0000-4000-8000-000000000011';
const serviceB = '41000000-0000-4000-8000-000000000012';
const staffA = '51000000-0000-4000-8000-000000000011';
const staffB = '51000000-0000-4000-8000-000000000012';
const appointmentA = '81000000-0000-4000-8000-000000000011';
const appointmentB = '81000000-0000-4000-8000-000000000012';
const groupId = '61000000-0000-4000-8000-000000000011';
const customerId = '91000000-0000-4000-8000-000000000011';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function catalog() {
  return { services: [
    { service_id: serviceA, name: 'Renk Bakımı', category: 'Renk', sort_order: 10, duration_minutes: 60, price_type: 'range', price_min_minor: 20000, price_max_minor: 35000, currency: 'TRY', price_policy_version: 1 },
    { service_id: serviceB, name: 'Kesim', category: 'Saç', sort_order: 20, duration_minutes: 30, price_type: 'fixed', price_min_minor: 10000, price_max_minor: 10000, currency: 'TRY', price_policy_version: 1 },
  ] };
}

function slotLines(lines, startsAt = '2026-09-20T07:00:00.000Z') {
  let cursor = Date.parse(startsAt);
  return lines.map((requested, index) => {
    const range = requested.serviceId === serviceA;
    const duration = range ? 60 : 30;
    const start = new Date(cursor).toISOString();
    cursor += duration * 60_000;
    return {
      lineOrdinal: index + 1,
      serviceId: requested.serviceId,
      serviceName: range ? 'Renk Bakımı' : 'Kesim',
      staffId: requested.staffId ?? (range ? staffA : staffB),
      staffName: range ? 'Ayşe' : 'Deniz',
      startsAt: start,
      endsAt: new Date(cursor).toISOString(),
      priceType: range ? 'range' : 'fixed',
      priceMinMinor: range ? 20000 : 10000,
      priceMaxMinor: range ? 35000 : 10000,
    };
  });
}

function availability(lines) {
  const planned = slotLines(lines);
  return {
    startsAt: planned[0].startsAt,
    endsAt: planned.at(-1).endsAt,
    timezone: 'Europe/Istanbul',
    currency: 'TRY',
    estimateMinMinor: planned.reduce((sum, line) => sum + line.priceMinMinor, 0),
    estimateMaxMinor: planned.reduce((sum, line) => sum + line.priceMaxMinor, 0),
    lines: planned,
  };
}

function createdGroup(lines) {
  const available = availability(lines);
  return {
    groupId,
    status: 'scheduled',
    source: 'public',
    version: 1,
    customerId,
    startsAt: available.startsAt,
    endsAt: available.endsAt,
    timezone: available.timezone,
    currency: available.currency,
    estimateMinMinor: available.estimateMinMinor,
    estimateMaxMinor: available.estimateMaxMinor,
    lines: available.lines.map((line, index) => ({
      ...line,
      appointmentId: index === 0 ? appointmentA : appointmentB,
      status: 'scheduled',
      occupiedStartsAt: line.startsAt,
      occupiedEndsAt: line.endsAt,
      processingCapacityPolicy: 'HOLD',
      passiveWaitMinutes: 0,
      processingPolicyVersion: 1,
      priceMinor: line.priceType === 'fixed' ? line.priceMinMinor : null,
      currency: 'TRY',
      pricePolicyVersion: 1,
    })),
  };
}

function recoveryResponse(saved, recoveryId) {
  const anchor = saved.group.lines[0];
  return {
    resolution: 'committed',
    recoveryId,
    appointment: {
      appointment_id: anchor.appointmentId,
      business_name: 'F12 Salon',
      status: anchor.status,
      starts_at: anchor.startsAt,
      ends_at: anchor.endsAt,
      timezone: saved.group.timezone,
      service_name: anchor.serviceName,
      staff_name: anchor.staffName,
      price_minor: anchor.priceMinor,
      currency: saved.group.currency,
    },
    group: saved.group,
    management: { url: `/m#${saved.managementToken}` },
    recovery: { expiresAt: '2026-09-23T07:00:00.000Z' },
  };
}

function managedProjection(group) {
  return {
    groupId: group.groupId,
    status: group.status,
    version: group.version,
    startsAt: group.startsAt,
    endsAt: group.endsAt,
    timezone: group.timezone,
    currency: group.currency,
    estimateMinMinor: group.estimateMinMinor,
    estimateMaxMinor: group.estimateMaxMinor,
    lineCount: group.lines.length,
    canRescheduleGroup: true,
    canCancelGroup: true,
    lines: group.lines.map((line) => ({
      appointmentId: line.appointmentId,
      lineOrdinal: line.lineOrdinal,
      serviceName: line.serviceName,
      staffName: line.staffName,
      startsAt: line.startsAt,
      endsAt: line.endsAt,
      status: line.status,
      priceType: line.priceType,
      priceMinMinor: line.priceMinMinor,
      priceMaxMinor: line.priceMaxMinor,
      priceMinor: line.priceMinor,
      currency: line.currency,
    })),
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/test.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(testJs);
    return;
  }
  if (url.pathname === '/style.css') {
    response.writeHead(200, { 'Content-Type': 'text/css' });
    response.end(testCss);
    return;
  }
  if (url.pathname.startsWith('/r/') || url.pathname === '/m' || url.pathname === '/m/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
    return;
  }

  const body = request.method === 'POST' ? await readJson(request) : {};
  requests.push({ method: request.method, path: url.pathname, body, idempotencyKey: request.headers['idempotency-key'] ?? null });
  const profileMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/profile$/);
  if (request.method === 'GET' && profileMatch) return sendJson(response, 200, { profile: {
    public_name: 'F12 Salon', short_description: 'Çoklu hizmet rezervasyonu', long_description: null,
    public_phone: null, public_email: null, public_website: null, public_whatsapp: null,
    address_text: 'İstanbul', show_work_hours: false, cover_media_id: null, work_hours: [], media: [],
  } });
  const catalogMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/services-v2$/);
  if (request.method === 'GET' && catalogMatch) return sendJson(response, 200, catalog());
  const staffMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/staff$/);
  if (request.method === 'GET' && staffMatch) {
    const range = url.searchParams.get('serviceId') === serviceA;
    return sendJson(response, 200, { staff: [{ staff_id: range ? staffA : staffB, staff_name: range ? 'Ayşe' : 'Deniz' }] });
  }
  const slotMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/group-slots$/);
  if (request.method === 'POST' && slotMatch) return sendJson(response, 200, { slots: [availability(body.lines)] });
  const bookMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/group-book$/);
  if (request.method === 'POST' && bookMatch) {
    const group = createdGroup(body.lines);
    const saved = { group, managementToken: body.managementToken, slug: bookMatch[1] };
    recoveries.set(body.recoveryId, saved);
    if (bookMatch[1] === 'recovery-salon') {
      return sendJson(response, 503, { error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Rezervasyon sonucu şu anda doğrulanamıyor.' } });
    }
    return sendJson(response, 201, {
      group,
      appointmentId: group.lines[0].appointmentId,
      management: { url: `/m#${body.managementToken}` },
      recovery: { expiresAt: '2026-09-23T07:00:00.000Z' },
    });
  }
  if (request.method === 'POST' && url.pathname === '/api/public/booking/resolve') {
    const saved = recoveries.get(body.recoveryId);
    return saved
      ? sendJson(response, 200, recoveryResponse(saved, body.recoveryId))
      : sendJson(response, 200, { resolution: 'closed_absent', recoveryId: body.recoveryId });
  }
  if (request.method === 'POST' && url.pathname === '/api/manage/view') {
    const saved = [...recoveries.values()].find((item) => item.managementToken === body.token);
    if (!saved) return sendJson(response, 404, { error: { code: 'MANAGEMENT_LINK_INVALID', message: 'Bağlantı geçerli değil.' } });
    const anchor = saved.group.lines[0];
    return sendJson(response, 200, {
      appointment: {
        appointment_id: anchor.appointmentId, business_name: 'F12 Salon', status: anchor.status,
        starts_at: anchor.startsAt, ends_at: anchor.endsAt, timezone: saved.group.timezone,
        service_name: anchor.serviceName, staff_name: anchor.staffName, price_minor: anchor.priceMinMinor,
        currency: saved.group.currency, can_reschedule: true, can_cancel: true,
        local_date: '2026-09-20', max_date: '2026-11-19',
      },
      group: managedProjection(saved.group),
    });
  }
  const businessMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)$/);
  if (request.method === 'GET' && businessMatch) return sendJson(response, 200, {
    business: { name: 'F12 Salon', slug: businessMatch[1], timezone: 'Europe/Istanbul', local_date: '2026-09-20', max_date: '2026-11-19', step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 },
    services: [], bookingClock: { serverNowEpochSeconds: Math.floor(Date.now() / 1000), submitWindowSeconds: 300 },
  });
  return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Fixture route missing.' } });
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

async function waitFor(read, message, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; } catch (error) { lastError = error; }
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
        client.ws.addEventListener('error', () => reject(new Error('F12-05 CDP WebSocket failed')), { once: true });
      }),
      sleep(5_000).then(() => { throw new Error('F12-05 CDP WebSocket timed out'); }),
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
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  send(method, params = {}, timeoutMs = 8_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, timeoutMs);
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

async function runJourney(debugUrl, origin, slug, width, expectsRecovery) {
  const start = requests.length;
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(`${origin}/r/${slug}`)}`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: true });
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-service-choice").length === 2'), `${slug} catalog did not load`);
    await page.evaluate('Array.from(document.querySelectorAll(".public-service-choice")).forEach((button) => button.click())');
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-selected-line").length === 2'), `${slug} services were not selected`);
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button) => button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-group-slot"))'), `${slug} group slot did not load`);
    await page.evaluate('document.querySelector(".public-group-slot")?.click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-group-customer-card input[name=customerName]"))'), `${slug} contact form did not open`);

    await page.evaluate('(() => { const input=document.querySelector("input[name=customerName]"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter.call(input,"Deniz Örnek"); input.dispatchEvent(new Event("input",{bubbles:true})); Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Planı onayla"))?.click(); })()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#public-contact-error"))'), `${slug} contact relation error did not appear`);
    const relation = await page.evaluate('(() => { const input=document.querySelector("input[name=customerEmail]"); const error=document.querySelector("#public-contact-error"); return {invalid:input.getAttribute("aria-invalid"),describedBy:input.getAttribute("aria-describedby"),role:error?.getAttribute("role")}; })()');
    assert.deepEqual(relation, { invalid: 'true', describedBy: 'public-contact-help public-contact-error', role: 'alert' });

    await page.evaluate('(() => { const input=document.querySelector("input[name=customerEmail]"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter.call(input,"deniz@example.test"); input.dispatchEvent(new Event("input",{bubbles:true})); Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Planı onayla"))?.click(); })()');
    await waitFor(() => page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), `${slug} confirmation did not appear`);
    const result = await page.evaluate('(() => { const root=document.documentElement; const controls=Array.from(document.querySelectorAll("button,input,textarea,a.public-primary")); return {text:document.body.innerText,overflow:root.scrollWidth>root.clientWidth+1,targets:controls.length>0&&controls.every((node)=>node.getBoundingClientRect().height>=44),shortControls:controls.map((node)=>({tag:node.tagName,className:node.className,text:(node.textContent||node.name||"").trim(),height:node.getBoundingClientRect().height})).filter((item)=>item.height<44),planner:Boolean(document.querySelector(".public-multi-service")),href:document.querySelector("a.public-primary")?.getAttribute("href")}; })()');
    assert.equal(result.overflow, false, `${slug} overflowed at ${width}px`);
    assert.equal(result.targets, true, `${slug} has a control below 44px at ${width}px: ${JSON.stringify(result.shortControls)}`);
    assert.equal(result.planner, false, `${slug} left the planner visible behind the result`);
    assert.match(result.text, /Renk Bakımı/);
    assert.match(result.text, /Kesim/);
    assert.match(result.text, /Tahmini/);
    assert.match(result.text, /Kesin tahsilat tutarı değildir/);
    assert.match(result.text, /Kayıt durumu:/);
    assert.match(result.text, /Mesaj durumu:/);
    assert.match(result.href, /^\/m#[A-Za-z0-9_-]{43}$/);

    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, `${slug} sent duplicate group create requests`);
    assert.equal(journeyRequests.some((item) => item.path === '/api/public/booking/resolve'), expectsRecovery, `${slug} recovery request mismatch`);
    const create = journeyRequests.find((item) => item.path.endsWith('/group-book'));
    assert.ok(create.idempotencyKey);
    assert.deepEqual(create.body.lines, [{ serviceId: serviceA, staffId: null }, { serviceId: serviceB, staffId: null }]);
    assert.equal(create.body.customerEmail, 'deniz@example.test');

    await page.evaluate('document.querySelector("a.public-primary")?.click()');
    await waitFor(() => page.evaluate('location.pathname === "/m" && document.body.innerText.includes("RANDEVUMU YÖNET")'), `${slug} management journey did not open`);
    const managed = await page.evaluate('document.body.innerText');
    assert.match(managed, /Rezervasyon bilgileri/);
    assert.match(managed, /2/);
    assert.match(managed, /Renk Bakımı/);
    assert.match(managed, /Kesim/);
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

try {
  await build({ configFile: false, root, publicDir: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: bundleDir, emptyOutDir: true, minify: false, lib: { entry: path.join(root, 'tests/browser/f12-public-group-booking.tsx'), formats: ['es'] }, rollupOptions: { output: { entryFileNames: 'test.js' } } } });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  const cssFile = readdirSync(bundleDir).find((name) => name.endsWith('.css'));
  assert.ok(cssFile, 'F12-05 browser bundle did not emit CSS');
  testCss = readFileSync(path.join(bundleDir, cssFile));

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chromeBin = process.env.CHROME_BIN;
  assert.ok(chromeBin, 'CHROME_BIN must identify the CI Chrome executable');
  const profileDir = path.join(work, 'profile');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', chromeFd, chromeFd] });
  const activePort = path.join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(() => { try { return readFileSync(activePort, 'utf8').split(/\r?\n/)[0] || false; } catch { return false; } }, 'F12-05 Chrome did not expose a debugging port');
  const debugUrl = `http://127.0.0.1:${port}`;

  await runJourney(debugUrl, origin, 'success-salon', 360, false);
  await runJourney(debugUrl, origin, 'recovery-salon', 390, true);
  console.log('F12-05 public group browser passed: 360/390 create, result, one-shot recovery and /m management journey.');
} catch (error) {
  let diagnostics = '';
  try { diagnostics = `\nChrome log:\n${readFileSync(chromeLog, 'utf8').slice(-4000)}`; } catch { /* noop */ }
  throw new Error(`${error.message}${diagnostics}`);
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
  if (chromeFd !== undefined) closeSync(chromeFd);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { rmSync(work, { recursive: true, force: true }); break; } catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 5) throw error;
      await sleep(100 * (attempt + 1));
    }
  }
}
