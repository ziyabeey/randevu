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
const failedResolveOnce = new Set();
const browserChunks = new Map();
const servedChunks = new Set();
let testJs = Buffer.alloc(0);
let testCss = Buffer.alloc(0);
let chrome;
let chromeFd;

const serviceA = '41000000-0000-4000-8000-000000000011';
const serviceB = '41000000-0000-4000-8000-000000000012';
const staffA = '51000000-0000-4000-8000-000000000011';
const staffB = '51000000-0000-4000-8000-000000000012';
const staffC = '51000000-0000-4000-8000-000000000013';
const appointmentA = '81000000-0000-4000-8000-000000000011';
const appointmentB = '81000000-0000-4000-8000-000000000012';
const groupId = '61000000-0000-4000-8000-000000000011';
const customerId = '91000000-0000-4000-8000-000000000011';
const preF12SingleRecoveryId = '71000000-0000-4000-8000-000000000011';
const preF12SingleManagementToken = 'P'.repeat(43);
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

const mutationKinds = ['service', 'end', 'price-type', 'price-min', 'price-max'];

function mutationScenario(slug) {
  const match = slug.match(/^(create|automatic|manual)-invalid-(service|end|price-type|price-min|price-max)-salon$/);
  return match ? { phase: match[1], kind: match[2] } : null;
}

function mutateGroupLine(group, kind) {
  const line = group.lines[1];
  if (kind === 'service') line.serviceId = serviceA;
  if (kind === 'end') line.endsAt = '2026-09-20T08:45:00.000Z';
  if (kind === 'price-type') line.priceType = 'range';
  if (kind === 'price-min') line.priceMinMinor = 9999;
  if (kind === 'price-max') line.priceMaxMinor = 10001;
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
    notification: { channel: 'email', status: 'queued' },
    notification: { channel: 'email', status: 'queued' },
    management: { url: `/m#${saved.managementToken}` },
    recovery: { expiresAt: '2026-09-23T07:00:00.000Z' },
  };
}

function scalarRecoveryResponse(saved, recoveryId) {
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
      price_minor: anchor.priceMinMinor,
      currency: saved.group.currency,
    },
    management: { url: `/m#${saved.managementToken}` },
    recovery: { expiresAt: '2026-09-23T07:00:00.000Z' },
  };
}

function preF12SingleRecoveryResponse() {
  return {
    resolution: 'committed',
    recoveryId: preF12SingleRecoveryId,
    appointment: {
      appointment_id: appointmentB,
      business_name: 'F12 Salon',
      status: 'scheduled',
      starts_at: '2026-09-20T07:00:00.000Z',
      ends_at: '2026-09-20T07:30:00.000Z',
      timezone: 'Europe/Istanbul',
      service_name: 'Kesim',
      staff_name: 'Deniz',
      price_minor: 10000,
      currency: 'TRY',
    },
    notification: { channel: 'email', status: 'queued' },
    management: { url: `/m#${preF12SingleManagementToken}` },
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
  const chunk = browserChunks.get(url.pathname);
  if (chunk) {
    servedChunks.add(url.pathname);
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(chunk);
    return;
  }
  if (url.pathname.startsWith('/r/') || url.pathname === '/m' || url.pathname === '/m/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
    return;
  }
  if (url.pathname === '/seed') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><html><body>seed</body></html>');
    return;
  }

  const body = request.method === 'POST' ? await readJson(request) : {};
  requests.push({ method: request.method, path: url.pathname, body, idempotencyKey: request.headers['idempotency-key'] ?? null });
  const profileMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/profile$/);
  if (request.method === 'GET' && profileMatch) {
    if (profileMatch[1] === 'loading-salon') await sleep(500);
    return sendJson(response, 200, { profile: {
    public_name: 'F12 Salon', short_description: 'Çoklu hizmet rezervasyonu', long_description: null,
    public_phone: '+90 555 000 11 22', public_email: 'destek@f12.example.test', public_website: 'https://f12.example.test', public_whatsapp: '+905550001122',
    address_text: 'İstanbul', show_work_hours: false, cover_media_id: null, work_hours: [], media: [],
    kvkk_notice_text: 'F12 browser fixture aydınlatma metni.', kvkk_notice_url: 'https://f12.example.test/kvkk',
    privacy_policy_url: 'https://f12.example.test/privacy', booking_terms_text: 'F12 browser fixture randevu koşulları.', booking_terms_url: 'https://f12.example.test/terms',
    } });
  }
  const catalogMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/services-v2$/);
  if (request.method === 'GET' && catalogMatch) {
    if (catalogMatch[1] === 'legacy-salon') return sendJson(response, 503, { error: { code: 'PUBLIC_SERVICE_UNAVAILABLE', message: 'Çoklu hizmet planı hazırlanamadı.' } });
    return sendJson(response, 200, catalog());
  }
  const staffMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/staff$/);
  if (request.method === 'GET' && staffMatch) {
    const range = url.searchParams.get('serviceId') === serviceA;
    return sendJson(response, 200, { staff: [{ staff_id: range ? staffA : staffB, staff_name: range ? 'Ayşe' : 'Deniz' }] });
  }
  const slotMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/group-slots$/);
  if (request.method === 'POST' && slotMatch) {
    const slot = availability(body.lines);
    if (slotMatch[1] === 'invalid-slot-timezone-salon') slot.timezone = 'Mars/Olympus';
    return sendJson(response, 200, { slots: [slot] });
  }
  const singleSlotMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/slots$/);
  if (request.method === 'GET' && singleSlotMatch) return sendJson(response, 200, { slots: [{
    staff_id: staffB, staff_name: 'Deniz', starts_at: '2026-09-20T07:00:00.000Z',
    ends_at: '2026-09-20T07:30:00.000Z', timezone: 'Europe/Istanbul',
  }] });
  const bookMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/group-book$/);
  if (request.method === 'POST' && bookMatch) {
    const group = createdGroup(body.lines);
    const mutation = mutationScenario(bookMatch[1]);
    if (bookMatch[1] === 'reassign-salon' || bookMatch[1] === 'invalid-pinned-salon') {
      group.lines[0].staffId = staffC;
      group.lines[0].staffName = 'Ece';
    }
    if (bookMatch[1] === 'invalid-line-salon') {
      group.lines[1].startsAt = '2026-09-20T08:15:00.000Z';
    }
    if (bookMatch[1] === 'invalid-timezone-salon') {
      group.timezone = 'Mars/Olympus';
    }
    if (mutation?.phase === 'create') mutateGroupLine(group, mutation.kind);
    if (bookMatch[1] === 'closed-salon') {
      return sendJson(response, 503, { error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Rezervasyon sonucu şu anda doğrulanamıyor.' } });
    }
    const saved = { group, managementToken: body.managementToken, slug: bookMatch[1], mutation };
    recoveries.set(body.recoveryId, saved);
    if (bookMatch[1] === 'recovery-salon' || bookMatch[1] === 'reload-salon' || bookMatch[1] === 'scalar-reload-salon' || bookMatch[1] === 'changed-plan-salon' || bookMatch[1] === 'confirmed-recovery-salon' || bookMatch[1] === 'completed-recovery-salon' || bookMatch[1] === 'no-show-recovery-salon' || bookMatch[1] === 'cancelled-recovery-salon' || bookMatch[1] === 'partial-recovery-salon' || bookMatch[1] === 'manual-invalid-salon' || mutation?.phase === 'automatic' || mutation?.phase === 'manual') {
      return sendJson(response, 503, { error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Rezervasyon sonucu şu anda doğrulanamıyor.' } });
    }
    return sendJson(response, 201, {
      group,
      appointmentId: group.lines[0].appointmentId,
      notification: { channel: 'email', status: 'queued' },
      management: { url: `/m#${body.managementToken}` },
      recovery: { expiresAt: '2026-09-23T07:00:00.000Z' },
    });
  }
  if (request.method === 'POST' && url.pathname === '/api/public/booking/resolve') {
    if (body.recoveryId === preF12SingleRecoveryId) return sendJson(response, 200, preF12SingleRecoveryResponse());
    const saved = recoveries.get(body.recoveryId);
    if ((saved?.slug === 'reload-salon' || saved?.slug === 'changed-plan-salon' || saved?.slug === 'manual-invalid-salon' || saved?.mutation?.phase === 'manual') && !failedResolveOnce.has(body.recoveryId)) {
      failedResolveOnce.add(body.recoveryId);
      if (saved.slug === 'manual-invalid-salon') saved.group.lines[1].startsAt = '2026-09-20T08:15:00.000Z';
      return sendJson(response, 503, { error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Randevu sonucu henüz doğrulanamıyor.' } });
    }
    if (saved?.mutation?.phase === 'automatic' || saved?.mutation?.phase === 'manual') {
      mutateGroupLine(saved.group, saved.mutation.kind);
    }
    if (saved?.slug === 'confirmed-recovery-salon') {
      saved.group.status = 'confirmed';
      for (const line of saved.group.lines) line.status = 'confirmed';
    }
    if (saved?.slug === 'cancelled-recovery-salon') {
      saved.group.status = 'cancelled';
      for (const line of saved.group.lines) line.status = 'cancelled';
    }
    if (saved?.slug === 'completed-recovery-salon') {
      saved.group.status = 'completed';
      for (const line of saved.group.lines) line.status = 'completed';
    }
    if (saved?.slug === 'no-show-recovery-salon') {
      saved.group.status = 'no_show';
      for (const line of saved.group.lines) line.status = 'no_show';
    }
    if (saved?.slug === 'partial-recovery-salon') {
      saved.group.status = 'partial';
      saved.group.lines[1].status = 'cancelled';
    }
    if (saved?.slug === 'scalar-reload-salon') return sendJson(response, 200, scalarRecoveryResponse(saved, body.recoveryId));
    return saved
      ? sendJson(response, 200, recoveryResponse(saved, body.recoveryId))
      : sendJson(response, 200, { resolution: 'closed_absent', recoveryId: body.recoveryId });
  }
  const singleBookMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/book$/);
  if (request.method === 'POST' && singleBookMatch) return sendJson(response, 201, {
    appointment: {
      appointment_id: appointmentB, business_name: 'F12 Salon', status: 'scheduled',
      starts_at: body.startsAt, ends_at: '2026-09-20T07:30:00.000Z', timezone: 'Europe/Istanbul',
      service_name: 'Kesim', staff_name: 'Deniz', price_minor: 10000, currency: 'TRY',
    },
    notification: { channel: 'email', status: 'queued' },
    management: { url: `/m#${body.managementToken}` },
    recovery: { expiresAt: '2026-09-23T07:00:00.000Z' },
  });
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
        support_slug: saved.slug,
        support_phone: '+90 555 000 11 22', support_email: 'destek@f12.example.test',
        support_website: 'https://f12.example.test', support_whatsapp: '+905550001122',
        support_address: 'İstanbul',
      },
      group: managedProjection(saved.group),
      notification: { channel: 'email', status: 'accepted' },
    });
  }
  const businessMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)$/);
  if (request.method === 'GET' && businessMatch) {
    if (businessMatch[1] === 'loading-salon') await sleep(500);
    return sendJson(response, 200, {
    business: { name: 'F12 Salon', slug: businessMatch[1], timezone: 'Europe/Istanbul', local_date: '2026-09-20', max_date: '2026-11-19', step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 },
    services: businessMatch[1] === 'legacy-salon'
      ? [{ service_id: serviceB, name: 'Kesim', duration_minutes: 30, price_minor: 10000, currency: 'TRY' }]
      : [],
    bookingClock: { serverNowEpochSeconds: Math.floor(Date.now() / 1000), submitWindowSeconds: 300 },
    });
  }
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

async function runScenario(name, run) {
  console.log(`[F12-05 scenario: ${name}] START`);
  try {
    await run();
    console.log(`[F12-05 scenario: ${name}] PASS`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[F12-05 scenario: ${name}] ${message}`, { cause: error });
  }
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

async function openRoute(debugUrl, origin, pathname, width) {
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent(`${origin}${pathname}`)}`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: true });
  return page;
}

async function pressTab(page) {
  const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await sleep(35);
  return page.evaluate('(() => { const node=document.activeElement; const style=getComputedStyle(node); return {name:node?.getAttribute?.("name")||"",className:node?.className||"",focusVisible:Boolean(node?.matches?.(":focus-visible")),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth}; })()');
}

async function preparePlan(page, slug, pinFirstStaff = false, checkKeyboard = true) {
  await waitFor(() => page.evaluate('document.querySelectorAll(".public-service-choice").length === 2'), `${slug} catalog did not load`);
  if (checkKeyboard) {
    await page.evaluate('document.activeElement instanceof HTMLElement && document.activeElement.blur()');
    let serviceFocus = null;
    const tabBudget = await page.evaluate('document.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\\\"-1\\\"])").length');
    for (let index = 0; index < Math.min(Number(tabBudget) + 2, 40); index += 1) {
      const focus = await pressTab(page);
      if (String(focus.className).includes('public-service-choice')) { serviceFocus = focus; break; }
    }
    assert.ok(serviceFocus?.focusVisible && serviceFocus.outlineStyle !== 'none' && serviceFocus.outlineWidth !== '0px', `${slug} service choice did not receive visible keyboard focus: ${JSON.stringify(serviceFocus)}`);
  }
  await page.evaluate('Array.from(document.querySelectorAll(".public-service-choice")).forEach((button) => button.click())');
  await waitFor(() => page.evaluate('document.querySelectorAll(".public-selected-line").length === 2'), `${slug} services were not selected`);
  if (pinFirstStaff) {
    await waitFor(() => page.evaluate(`Boolean(document.querySelector('.public-selected-line select option[value="${staffA}"]'))`), `${slug} pinned staff option did not load`);
    await page.evaluate(`(() => { const select=document.querySelector('.public-selected-line select'); select.value='${staffA}'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  }
  await page.evaluate('Array.from(document.querySelectorAll("button")).find((button) => button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
  await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-group-slot"))'), `${slug} group slot did not load`);
  await page.evaluate('document.querySelector(".public-group-slot")?.click()');
  await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-group-customer-card input[name=customerName]"))'), `${slug} contact form did not open`);
}

async function submitContact(page) {
  await page.evaluate('(() => { const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; const name=document.querySelector("input[name=customerName]"); const phone=document.querySelector("input[name=customerPhone]"); setter.call(name,"Deniz Örnek"); name.dispatchEvent(new Event("input",{bubbles:true})); setter.call(phone,"05550001122"); phone.dispatchEvent(new Event("input",{bubbles:true})); Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Planı onayla"))?.click(); })()');
}

async function runJourney(debugUrl, origin, slug, width, expectsRecovery) {
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, width);
  try {
    await preparePlan(page, slug);

    const information=await page.evaluate('(() => ({origin:location.origin,links:Array.from(document.querySelectorAll(".public-information-links a")).map((a)=>({text:a.textContent.trim(),href:a.href,target:a.target})),text:document.querySelector(".public-booking-information")?.innerText||""}))()');
    assert.deepEqual(information.links.map((item)=>item.text),['Aydınlatma ve KVKK','Gizlilik','Randevu koşulları','Destek']);
    assert.deepEqual(information.links.map((item)=>new URL(item.href).pathname),[`/r/${slug}/kvkk`,`/r/${slug}/privacy`,`/r/${slug}/terms`,`/r/${slug}/support`]);
    assert.ok(information.links.every((item)=>item.target==='_blank'), `${slug} information links should not replace the active booking surface`);
    assert.match(information.text,/F12 Salon/);
    assert.match(information.text,/\+90 555 000 11 22/);

    await page.evaluate('document.querySelector("input[name=customerName]")?.focus()');
    const contactFocus = await pressTab(page);
    assert.equal(contactFocus.name, 'customerPhone', `${slug} keyboard did not advance into contact fields`);
    assert.ok(contactFocus.focusVisible && contactFocus.outlineStyle !== 'none' && contactFocus.outlineWidth !== '0px', `${slug} contact field did not receive visible keyboard focus: ${JSON.stringify(contactFocus)}`);

    await page.evaluate('(() => { const input=document.querySelector("input[name=customerName]"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter.call(input,"Deniz Örnek"); input.dispatchEvent(new Event("input",{bubbles:true})); Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Planı onayla"))?.click(); })()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector("#public-contact-error"))'), `${slug} contact relation error did not appear`);
    const relation = await page.evaluate('(() => { const input=document.querySelector("input[name=customerPhone]"); const error=document.querySelector("#public-contact-error"); const email=document.querySelector("input[name=customerEmail]"); return {invalid:input.getAttribute("aria-invalid"),required:input.getAttribute("aria-required"),describedBy:input.getAttribute("aria-describedby"),emailRequired:email.getAttribute("aria-required"),role:error?.getAttribute("role")}; })()');
    assert.deepEqual(relation, { invalid: 'true', required: 'true', describedBy: 'public-contact-help public-contact-error', emailRequired: null, role: 'alert' });

    await page.evaluate('(() => { const input=document.querySelector("input[name=customerPhone]"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter.call(input,"05550001122"); input.dispatchEvent(new Event("input",{bubbles:true})); Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Planı onayla"))?.click(); })()');
    await waitFor(() => page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), `${slug} confirmation did not appear`);
    const result = await page.evaluate('(() => { const root=document.documentElement; const controls=Array.from(document.querySelectorAll("button,input,textarea,a.public-primary")); const status=document.querySelector(".public-result-status"); const marker=document.querySelector(".public-result-mark"); return {text:document.body.innerText,overflow:root.scrollWidth>root.clientWidth+1,targets:controls.length>0&&controls.every((node)=>node.getBoundingClientRect().height>=44),shortControls:controls.map((node)=>({tag:node.tagName,className:node.className,text:(node.textContent||node.name||"").trim(),height:node.getBoundingClientRect().height})).filter((item)=>item.height<44),planner:Boolean(document.querySelector(".public-multi-service")),href:document.querySelector("a.public-primary")?.getAttribute("href"),statusClass:status?.className,markerClass:marker?.className}; })()');
    assert.equal(result.overflow, false, `${slug} overflowed at ${width}px`);
    assert.equal(result.targets, true, `${slug} has a control below 44px at ${width}px: ${JSON.stringify(result.shortControls)}`);
    assert.equal(result.planner, false, `${slug} left the planner visible behind the result`);
    assert.match(result.text, /Renk Bakımı/);
    assert.match(result.text, /Kesim/);
    assert.match(result.text, /Tahmini/);
    assert.match(result.text, /Kesin tahsilat tutarı değildir/);
    assert.match(result.text, /Kayıt durumu:/);
    assert.match(result.text, /Bildirim durumu:/);
    assert.match(result.text, /E-posta gönderim sırasına alındı/);
    assert.doesNotMatch(result.text, /Bu ekran SMS veya e-posta teslimini doğrulamaz/);
    assert.match(result.text, /Aydınlatma ve KVKK/);
    assert.match(result.text, /Destek ve iletişim/);
    assert.match(result.text, /\+90 555 000 11 22/);
    assert.match(result.href, /^\/m#[A-Za-z0-9_-]{43}$/);
    assert.match(result.statusClass, /\bis-active\b/, `${slug} active result did not use the active status tone`);
    assert.match(result.markerClass, /\bis-active\b/, `${slug} active result did not use the active marker tone`);

    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, `${slug} sent duplicate group create requests`);
    assert.equal(journeyRequests.some((item) => item.path === '/api/public/booking/resolve'), expectsRecovery, `${slug} recovery request mismatch`);
    const create = journeyRequests.find((item) => item.path.endsWith('/group-book'));
    assert.ok(create.idempotencyKey);
    assert.deepEqual(create.body.lines, [{ serviceId: serviceA, staffId: null }, { serviceId: serviceB, staffId: null }]);
    assert.equal(create.body.customerPhone, '05550001122');
    assert.equal(create.body.customerEmail, null, 'email must stay optional when phone is present');

    await page.evaluate('document.querySelector("a.public-primary")?.click()');
    await waitFor(() => page.evaluate('location.pathname === "/m" && document.body.innerText.includes("RANDEVUMU YÖNET")'), `${slug} management journey did not open`);
    const managed = await page.evaluate('document.body.innerText');
    assert.match(managed, /Rezervasyon bilgileri/);
    assert.match(managed, /2/);
    assert.match(managed, /Renk Bakımı/);
    assert.match(managed, /Kesim/);
    assert.match(managed, /Bildirim durumu:/);
    assert.match(managed, /E-posta sağlayıcı tarafından kabul edildi/);
    assert.match(managed, /Teslim edildiği doğrulanmaz/);
    assert.match(managed, /Aydınlatma ve KVKK/);
    assert.match(managed, /Destek ve iletişim/);
    assert.match(managed, /destek@f12\.example\.test/);
    const managementLinks=await page.evaluate('Array.from(document.querySelectorAll(".public-information-links a")).map((a)=>({path:new URL(a.href).pathname,target:a.target}))');
    assert.deepEqual(managementLinks.map((item)=>item.path),[`/r/${slug}/kvkk`,`/r/${slug}/privacy`,`/r/${slug}/terms`,`/r/${slug}/support`]);
    assert.ok(managementLinks.every((item)=>item.target==='_blank'), `${slug} management information links must preserve the capability page`);
    assert.match(await page.evaluate('location.hash'), /^#[A-Za-z0-9_-]{43}$/, `${slug} management capability hash was not preserved`);
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runClosedAbsent(debugUrl, origin) {
  const slug = 'closed-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug);
    await submitContact(page);
    await waitFor(() => page.evaluate('document.body.innerText.includes("güvenli olarak kapatıldı")'), 'closed_absent receipt did not appear');
    await waitFor(() => requests.slice(start).filter((item) => item.path.endsWith('/group-slots')).length >= 2, 'closed_absent did not refresh group availability');
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, 'closed_absent sent duplicate group create requests');
    assert.equal(journeyRequests.filter((item) => item.path === '/api/public/booking/resolve').length, 1, 'closed_absent did not resolve exactly once');
    assert.equal(await page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false);
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runReloadRecovery(debugUrl, origin) {
  const slug = 'reload-salon';
  const start = requests.length;
  const first = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(first, slug);
    await submitContact(first);
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 1, 'reload recovery first resolve did not fail once');
    await waitFor(() => first.evaluate('document.body.innerText.includes("henüz doğrulanamıyor")'), 'reload recovery did not retain an unresolved result');
  } finally {
    first.close();
  }

  const second = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await waitFor(() => second.evaluate('document.body.innerText.includes("Önceki randevu işleminizin sonucu")'), 'reload did not restore the unresolved receipt');
    await second.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Sonucu tekrar kontrol et"))?.click()');
    await waitFor(() => second.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), 'reload recovery did not restore the committed group');
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, 'reload recovery sent duplicate group create requests');
    assert.equal(journeyRequests.filter((item) => item.path === '/api/public/booking/resolve').length, 2, 'reload recovery resolve count mismatch');
    assert.deepEqual(second.diagnostics, []);
  } finally {
    second.close();
  }
}

async function runRejectedScalarReloadRecovery(debugUrl, origin) {
  const slug = 'scalar-reload-salon';
  const start = requests.length;
  const first = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(first, slug);
    await submitContact(first);
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 1, 'scalar reload recovery automatic resolve did not run');
    await waitFor(() => first.evaluate('document.body.innerText.includes("Randevu sonucu doğrulanamadı")'), 'scalar group recovery did not fail closed before reload');
    assert.equal(await first.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false, 'scalar group recovery reached the result before reload');
  } finally {
    first.close();
  }

  const second = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await waitFor(() => second.evaluate('document.body.innerText.includes("Önceki randevu işleminizin sonucu")'), 'scalar reload did not restore the persisted group intent');
    await second.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Sonucu tekrar kontrol et"))?.click()');
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 2, 'scalar reload retry did not resolve again');
    await waitFor(() => second.evaluate('document.body.innerText.includes("Randevu sonucu doğrulanamadı")'), 'persisted group kind did not reject scalar recovery after reload');
    assert.equal(await second.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false, 'scalar reload recovery reached the result screen');
    assert.equal(requests.slice(start).filter((item) => item.path.endsWith('/group-book')).length, 1, 'scalar reload recovery sent duplicate group create requests');
    assert.deepEqual(second.diagnostics, []);
  } finally {
    second.close();
  }
}

async function runChangedPlanRecovery(debugUrl, origin) {
  const slug = 'changed-plan-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug);
    await submitContact(page);
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 1, 'changed-plan automatic resolve did not fail once');
    await waitFor(() => page.evaluate('document.body.innerText.includes("henüz doğrulanamıyor")'), 'changed-plan intent did not remain unresolved');

    await page.evaluate('document.querySelector(\'button[aria-label="Renk Bakımı hizmetini aşağı taşı"]\')?.click()');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button) => button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-group-slot"))'), 'changed-plan replacement slot did not load');
    await page.evaluate('document.querySelector(".public-group-slot")?.click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-group-summary"))'), 'changed-plan replacement selection was not committed');

    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Sonucu tekrar kontrol et"))?.click()');
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 2, 'changed-plan manual retry did not resolve again');
    await waitFor(() => page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), 'recovery did not use the immutable original group plan');
    assert.equal(requests.slice(start).filter((item) => item.path.endsWith('/group-book')).length, 1, 'changed-plan recovery sent duplicate group create requests');
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runProductionLoadingState(debugUrl, origin) {
  const page = await openRoute(debugUrl, origin, '/r/loading-salon', 390);
  try {
    await waitFor(() => page.evaluate(`Boolean(
      document.querySelector('.public-salon-hero-loading[aria-busy="true"]')
      && document.body.innerText.includes('Uygun saatler hazırlanıyor…')
    )`), 'production loading state did not render');
    const loading = await page.evaluate(`(() => ({
      hero: Boolean(document.querySelector('.public-salon-hero-loading[aria-busy="true"]')),
      booking: document.body.innerText.includes('Uygun saatler hazırlanıyor…'),
    }))()`);
    assert.deepEqual(loading, { hero: true, booking: true }, 'production route did not expose both salon and booking loading states');
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-service-choice").length === 2'), 'production loading route did not settle into the service catalog');
    assert.equal(await page.evaluate('document.body.innerText.includes("Uygun saatler hazırlanıyor…")'), false, 'production booking loading state did not clear');
    assert.deepEqual(page.diagnostics, [], 'production loading route emitted browser diagnostics');
  } finally {
    page.close();
  }
}

async function runLifecycleStateRecovery(debugUrl, origin, slug, expectedKicker, expectedTone) {
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug);
    await submitContact(page);
    await waitFor(() => page.evaluate(`document.body.innerText.includes(${JSON.stringify(expectedKicker)})`), `${slug} did not render its status-specific recovery outcome`);
    const result = await page.evaluate('(() => { const status=document.querySelector(".public-result-status"); const marker=document.querySelector(".public-result-mark"); return {text:document.body.innerText,statusClass:status?.className,statusBackground:status ? getComputedStyle(status).backgroundColor : null,markerClass:marker?.className,markerBackground:marker ? getComputedStyle(marker).backgroundColor : null}; })()');
    assert.match(result.statusClass, new RegExp(`\\bis-${expectedTone}\\b`), `${slug} did not use the ${expectedTone} status tone`);
    assert.match(result.markerClass, new RegExp(`\\bis-${expectedTone}\\b`), `${slug} did not use the ${expectedTone} marker tone`);
    if (expectedTone === 'active') {
      assert.equal(result.statusBackground, 'rgb(238, 249, 242)', `${slug} did not use the green active status surface`);
      assert.equal(result.markerBackground, 'rgb(230, 247, 237)', `${slug} did not use the green active marker surface`);
    } else {
      assert.doesNotMatch(result.statusClass, /\bis-active\b/, `${slug} retained the active success status tone`);
      assert.doesNotMatch(result.markerClass, /\bis-active\b/, `${slug} retained the active success marker tone`);
      assert.notEqual(result.statusBackground, 'rgb(238, 249, 242)', `${slug} retained the green active status surface`);
      assert.notEqual(result.markerBackground, 'rgb(230, 247, 237)', `${slug} retained the green active marker surface`);
    }
    assert.doesNotMatch(result.text, /RANDEVU OLUŞTURULDU/, `${slug} rendered create-success copy`);
    if (slug === 'partial-recovery-salon') {
      assert.match(result.text, /Durum: Planlandı/);
      assert.match(result.text, /Durum: İptal edildi/);
    }
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, `${slug} issued duplicate creates`);
    assert.equal(journeyRequests.filter((item) => item.path === '/api/public/booking/resolve').length, 1, `${slug} resolve count mismatch`);
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runPreF12SingleRecoveryWithGroupSelection(debugUrl, origin) {
  const slug = 'pre-f12-single-salon';
  const start = requests.length;
  const seedPage = await openRoute(debugUrl, origin, '/seed', 390);
  try {
    await seedPage.evaluate(`new Promise((resolve, reject) => {
      const request = indexedDB.open('yzt-public-booking-pending-v2', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('booking-intents', { keyPath: 'id' });
        store.createIndex('by-slug', 'slug', { unique: false });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('booking-intents', 'readwrite');
        transaction.oncomplete = () => { database.close(); resolve(true); };
        transaction.onerror = () => reject(transaction.error);
        transaction.objectStore('booking-intents').put({
          id: 'v2:pre-f12-single', slug: '${slug}', version: 2, source: 'v2', status: 'unresolved',
          idempotencyKey: 'pre-f12-single-key', recoveryId: '${preF12SingleRecoveryId}', recoverySecret: '${'A'.repeat(43)}',
          requestFingerprint: '${'f'.repeat(64)}', sampledAtEpochMs: Date.now() - 1000,
          expiresAtEpochMs: Date.now() + 7200000, submitDeadlineEpochSeconds: Math.floor(Date.now() / 1000) + 300,
          settleAfterEpochMs: Date.now() - 1, ownerId: 'pre-f12-owner',
          createdAtEpochMs: Date.now() - 1000, updatedAtEpochMs: Date.now() - 1000,
        });
      };
    })`);
  } finally {
    seedPage.close();
  }

  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug, false, false);
    await waitFor(() => page.evaluate('document.body.innerText.includes("Önceki randevu işleminizin sonucu")'), 'pre-F12 single pending record did not block group create');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Sonucu tekrar kontrol et"))?.click()');
    await waitFor(() => page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), 'pre-F12 single recovery was poisoned by the current group selection');
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path === '/api/public/booking/resolve').length, 1, 'pre-F12 single recovery did not resolve exactly once');
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book') || item.path.endsWith('/book')).length, 0, 'pre-F12 single recovery issued a new create');
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runLegacyFallback(debugUrl, origin) {
  const slug = 'legacy-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await waitFor(() => page.evaluate(`Boolean(document.querySelector('.public-picker-form select option[value="${serviceB}"]'))`), 'legacy populated catalog did not remain available');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button) => button.textContent.includes("Uygun saatleri göster"))?.click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-slot"))'), 'legacy slot did not load');
    await page.evaluate('document.querySelector(".public-slot")?.click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-customer-card input[name=customerName]"))'), 'legacy contact form did not open');
    await page.evaluate('(() => { const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; const name=document.querySelector("input[name=customerName]"); const phone=document.querySelector("input[name=customerPhone]"); setter.call(name,"Deniz Örnek"); name.dispatchEvent(new Event("input",{bubbles:true})); setter.call(phone,"05550001122"); phone.dispatchEvent(new Event("input",{bubbles:true})); Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Randevuyu oluştur"))?.click(); })()');
    await waitFor(() => page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), 'legacy /book fallback did not complete');
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/book')).length, 1, 'legacy fallback did not issue one /book create');
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 0, 'legacy fallback issued group-book');
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runRejectedLineMutation(debugUrl, origin) {
  const slug = 'invalid-line-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug);
    await submitContact(page);
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 1, 'invalid-line response was not checked through one-shot recovery');
    await waitFor(() => page.evaluate('document.body.innerText.includes("Randevu sonucu doğrulanamadı")'), 'invalid-line response did not remain fail closed');
    assert.equal(await page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false, 'invalid-line response reached the result screen');
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, 'invalid-line response sent duplicate group create requests');
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

// Availability is formatted with the slot's own zone before anything is
// booked, so a malformed zone there must be dropped, not rendered: rendering it
// throws a RangeError inside Intl and takes the whole public page down.
async function runRejectedSlotTimezone(debugUrl, origin) {
  const slug = 'invalid-slot-timezone-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-service-choice").length === 2'), `${slug} catalog did not load`);
    await page.evaluate('Array.from(document.querySelectorAll(".public-service-choice")).forEach((button) => button.click())');
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-selected-line").length === 2'), `${slug} services were not selected`);
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button) => button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
    await waitFor(() => requests.slice(start).some((item) => item.path.endsWith('/group-slots')), `${slug} group availability was not requested`);
    await waitFor(() => page.evaluate('document.body.innerText.includes("Uygunluk yanıtı doğrulanamadı")'), `${slug} malformed slot was not rejected as an unverifiable response`);
    assert.equal(await page.evaluate('Array.from(document.querySelectorAll("button")).some((button) => button.textContent.includes("Uygun saatleri tekrar dene"))'), true, 'the rejected availability offered no retry');
    assert.equal(await page.evaluate('Boolean(document.querySelector(".public-group-slot"))'), false, 'a slot with a malformed timezone was offered');
    assert.deepEqual(page.diagnostics, [], 'a malformed slot timezone threw in the public page');
    assert.equal(requests.slice(start).filter((item) => item.path.endsWith('/group-book')).length, 0, 'a malformed slot reached group create');
  } finally {
    page.close();
  }
}

async function runRejectedTimezone(debugUrl, origin) {
  const slug = 'invalid-timezone-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug);
    await submitContact(page);
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 1, 'invalid-timezone response was not checked through one-shot recovery');
    await waitFor(() => page.evaluate('document.body.innerText.includes("Randevu sonucu doğrulanamadı")'), 'invalid-timezone response did not remain fail closed');
    assert.equal(await page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false, 'invalid-timezone response reached the result screen');
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, 'invalid-timezone response sent duplicate group create requests');
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runRejectedPinnedReassignment(debugUrl, origin) {
  const slug = 'invalid-pinned-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug, true);
    await submitContact(page);
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 1, 'pinned reassignment was not checked through one-shot recovery');
    await waitFor(() => page.evaluate('document.body.innerText.includes("Randevu sonucu doğrulanamadı")'), 'pinned reassignment did not remain fail closed');
    assert.equal(await page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false, 'pinned reassignment reached the result screen');
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, 'pinned reassignment sent duplicate group create requests');
    assert.deepEqual(journeyRequests.find((item) => item.path.endsWith('/group-book')).body.lines, [{ serviceId: serviceA, staffId: staffA }, { serviceId: serviceB, staffId: null }]);
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runRejectedManualRecoveryMutation(debugUrl, origin) {
  const slug = 'manual-invalid-salon';
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug);
    await submitContact(page);
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 1, 'manual-invalid automatic resolve did not fail once');
    await waitFor(() => page.evaluate('document.body.innerText.includes("henüz doğrulanamıyor")'), 'manual-invalid did not retain the unresolved result');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Sonucu tekrar kontrol et"))?.click()');
    await waitFor(() => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === 2, 'manual-invalid retry did not resolve again');
    await waitFor(() => page.evaluate('document.body.innerText.includes("Randevu sonucu doğrulanamadı")'), 'manual-invalid recovery did not compare the selected plan');
    assert.equal(await page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false, 'manual-invalid recovery reached the result screen');
    assert.equal(requests.slice(start).filter((item) => item.path.endsWith('/group-book')).length, 1, 'manual-invalid recovery sent duplicate group create requests');
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function runRejectedPlanMutation(debugUrl, origin, phase, kind) {
  const slug = `${phase}-invalid-${kind}-salon`;
  const start = requests.length;
  const page = await openRoute(debugUrl, origin, `/r/${slug}`, 390);
  try {
    await preparePlan(page, slug, false, false);
    await submitContact(page);
    const expectedResolveCount = phase === 'manual' ? 2 : 1;
    await waitFor(
      () => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length >= 1,
      `${slug} did not run automatic recovery`,
    );
    if (phase === 'manual') {
      await waitFor(() => page.evaluate('document.body.innerText.includes("henüz doğrulanamıyor")'), `${slug} did not retain the unresolved result before manual retry`);
      await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Sonucu tekrar kontrol et"))?.click()');
      await waitFor(
        () => requests.slice(start).filter((item) => item.path === '/api/public/booking/resolve').length === expectedResolveCount,
        `${slug} manual retry did not resolve again`,
      );
    }
    await waitFor(() => page.evaluate('document.body.innerText.includes("Randevu sonucu doğrulanamadı")'), `${slug} did not reject the mutated group result`);
    assert.equal(await page.evaluate('document.body.innerText.includes("RANDEVU OLUŞTURULDU")'), false, `${slug} reached the result screen`);
    const journeyRequests = requests.slice(start);
    assert.equal(journeyRequests.filter((item) => item.path.endsWith('/group-book')).length, 1, `${slug} sent duplicate group create requests`);
    assert.equal(journeyRequests.filter((item) => item.path === '/api/public/booking/resolve').length, expectedResolveCount, `${slug} resolve count mismatch`);
    assert.deepEqual(page.diagnostics, [], `${slug} emitted browser diagnostics`);
  } finally {
    page.close();
  }
}

try {
  await build({ configFile: false, root, publicDir: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: bundleDir, emptyOutDir: true, minify: false, lib: { entry: path.join(root, 'tests/browser/f12-public-group-booking.tsx'), formats: ['es'] }, rollupOptions: { output: { entryFileNames: 'test.js', chunkFileNames: '[name]-[hash].js' } } } });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  for (const file of readdirSync(bundleDir).filter((name) => name.endsWith('.js') && name !== 'test.js')) {
    browserChunks.set(`/${file}`, readFileSync(path.join(bundleDir, file)));
  }
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

  await runScenario('production loading state', () => runProductionLoadingState(debugUrl, origin));
  await runScenario('360px create and management journey', () => runJourney(debugUrl, origin, 'success-salon', 360, false));
  await runScenario('390px lost-response recovery journey', () => runJourney(debugUrl, origin, 'recovery-salon', 390, true));
  await runScenario('unpinned staff reassignment', () => runJourney(debugUrl, origin, 'reassign-salon', 390, false));
  await runScenario('closed_absent availability refresh', () => runClosedAbsent(debugUrl, origin));
  await runScenario('reload recovery', () => runReloadRecovery(debugUrl, origin));
  await runScenario('scalar group recovery rejection', () => runRejectedScalarReloadRecovery(debugUrl, origin));
  await runScenario('immutable changed-plan recovery', () => runChangedPlanRecovery(debugUrl, origin));
  await runScenario('confirmed active lifecycle outcome', () => runLifecycleStateRecovery(debugUrl, origin, 'confirmed-recovery-salon', 'RANDEVU ONAYLANDI', 'active'));
  await runScenario('completed neutral lifecycle outcome', () => runLifecycleStateRecovery(debugUrl, origin, 'completed-recovery-salon', 'RANDEVU TAMAMLANDI', 'neutral'));
  await runScenario('no-show attention lifecycle outcome', () => runLifecycleStateRecovery(debugUrl, origin, 'no-show-recovery-salon', 'RANDEVUYA GELİNMEDİ', 'attention'));
  await runScenario('cancelled attention lifecycle outcome', () => runLifecycleStateRecovery(debugUrl, origin, 'cancelled-recovery-salon', 'RANDEVU İPTAL EDİLDİ', 'attention'));
  await runScenario('partial attention lifecycle outcome', () => runLifecycleStateRecovery(debugUrl, origin, 'partial-recovery-salon', 'RANDEVU PLANI KISMEN DEĞİŞTİ', 'attention'));
  await runScenario('pre-F12 single recovery with group selection', () => runPreF12SingleRecoveryWithGroupSelection(debugUrl, origin));
  await runScenario('populated legacy single-service fallback', () => runLegacyFallback(debugUrl, origin));
  await runScenario('start-time mutation rejection', () => runRejectedLineMutation(debugUrl, origin));
  await runScenario('timezone mutation rejection', () => runRejectedTimezone(debugUrl, origin));
  await runScenario('malformed slot timezone rejection', () => runRejectedSlotTimezone(debugUrl, origin));
  await runScenario('pinned staff reassignment rejection', () => runRejectedPinnedReassignment(debugUrl, origin));
  await runScenario('legacy manual recovery mutation rejection', () => runRejectedManualRecoveryMutation(debugUrl, origin));
  for (const phase of ['create', 'automatic', 'manual']) {
    for (const kind of mutationKinds) {
      await runScenario(`${phase} ${kind} mutation rejection`, () => runRejectedPlanMutation(debugUrl, origin, phase, kind));
    }
  }
  await runScenario('production lazy chunk boundaries', async () => {
    assert.ok([...servedChunks].some((name) => /PublicSalonPage-.*\.js$/.test(name)), `production public route lazy chunk was not requested: ${JSON.stringify([...servedChunks])}`);
    assert.ok([...servedChunks].some((name) => /ManageAppointmentPage-.*\.js$/.test(name)), `production management route lazy chunk was not requested: ${JSON.stringify([...servedChunks])}`);
  });
  console.log('F12-05 public group browser passed: named production-route loading/lazy chunks, 360/390 create, legacy /book fallback, immutable recovery, all lifecycle tones, create/automatic/manual service/end/price mutation rejection, malformed slot timezone, closed_absent and /m management.');
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
