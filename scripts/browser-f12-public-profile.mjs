import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f12-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const requests = [];
const sockets = new Set();
let testJs = Buffer.alloc(0);
let testCss = Buffer.alloc(0);
const brokenMediaId = 'e1000000-0000-4000-8000-000000000001';
const serviceA = 'fa300000-0000-4000-8000-000000000001';
const serviceB = 'fa300000-0000-4000-8000-000000000002';
const staffA = 'fa400000-0000-4000-8000-000000000001';
const staffB = 'fa400000-0000-4000-8000-000000000002';
const requestDetails = [];
let retryCatalogCalls = 0;
let retryStaffCalls = 0;
let retrySlotCalls = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function profile(slug) {
  const broken = slug === 'broken-salon';
  const multi = ['multi-salon', 'retry-salon', 'empty-salon'].includes(slug);
  return {
    public_name: multi ? 'Çoklu Salon' : broken ? 'Kırık Görsel Salon' : 'Fotoğrafsız Salon',
    short_description: 'Gerçek salon bilgileriyle sade online randevu.',
    long_description: 'Bahçeşehir’de hizmet veren salonun gerçek profil açıklaması.',
    public_phone: '+905551112233', public_email: 'salon@example.invalid', public_website: null, public_whatsapp: null,
    address_text: 'Bahçeşehir, İstanbul', show_work_hours: true,
    cover_media_id: broken ? brokenMediaId : null,
    work_hours: [{ weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00' }],
    media: broken ? [{ id: brokenMediaId, alt_text: 'Salon giriş alanı', sort_order: 0, width: 1600, height: 1000 }] : [],
    kvkk_notice_text: 'F12 public profile browser fixture aydınlatma metni.',
    kvkk_notice_url: 'https://salon.example.test/kvkk',
    privacy_policy_url: 'https://salon.example.test/privacy',
    booking_terms_text: 'F12 public profile browser fixture randevu koşulları.',
    booking_terms_url: 'https://salon.example.test/terms',
  };
}
function bookingPayload(slug) {
  const multi = ['multi-salon', 'retry-salon', 'empty-salon'].includes(slug);
  return {
    business: { name: multi ? 'Çoklu Salon' : slug === 'broken-salon' ? 'Kırık Görsel Salon' : 'Fotoğrafsız Salon', slug, timezone: 'Europe/Istanbul', local_date: multi ? '2026-09-20' : '2026-09-14', max_date: '2026-11-13', step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 },
    services: [], bookingClock: { serverNowEpochSeconds: 1789360000, submitWindowSeconds: 300 },
  };
}

function multiCatalog() {
  return { services: [
    { service_id: serviceA, name: 'Renk Paketi', category: 'Renk', sort_order: 20, duration_minutes: 60, price_type: 'range', price_min_minor: 12000, price_max_minor: 18000, currency: 'TRY', price_policy_version: 2 },
    { service_id: serviceB, name: 'Kesim', category: 'Saç', sort_order: 10, duration_minutes: 30, price_type: 'fixed', price_min_minor: 5000, price_max_minor: 5000, currency: 'TRY', price_policy_version: 1 },
  ] };
}

function groupSlots(body) {
  if (body.date === '2026-09-22') return { slots: [] };
  const newer = body.date === '2026-09-21';
  const startsAt = newer ? '2026-09-21T07:00:00Z' : '2026-09-20T06:00:00Z';
  const catalog = new Map(multiCatalog().services.map((service) => [service.service_id, service]));
  let cursor = Date.parse(startsAt);
  const lines = body.lines.map((line, index) => {
    const service = catalog.get(line.serviceId);
    const person = line.staffId
      ? { id: line.staffId, name: line.staffId === staffA ? 'Ada' : 'Bora' }
      : line.serviceId === serviceA ? { id: staffA, name: 'Ada' } : { id: staffB, name: 'Bora' };
    const lineStart = new Date(cursor).toISOString();
    cursor += service.duration_minutes * 60_000;
    return {
      lineOrdinal: index + 1, serviceId: service.service_id, serviceName: service.name,
      staffId: person.id, staffName: person.name, startsAt: lineStart, endsAt: new Date(cursor).toISOString(),
      priceType: service.price_type, priceMinMinor: service.price_min_minor, priceMaxMinor: service.price_max_minor,
    };
  });
  return { slots: [{
    startsAt, endsAt: new Date(cursor).toISOString(), timezone: 'Europe/Istanbul', currency: 'TRY',
    estimateMinMinor: lines.reduce((sum, line) => sum + line.priceMinMinor, 0),
    estimateMaxMinor: lines.reduce((sum, line) => sum + line.priceMaxMinor, 0),
    lines,
  }] };
}
function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  requests.push(`${request.method} ${url.pathname}`);
  if (url.pathname === '/test.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(testJs); return; }
  if (url.pathname === '/style.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(testCss); return; }
  if (url.pathname.startsWith('/harness/') || url.pathname.startsWith('/r/')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
    return;
  }
  const body = request.method === 'POST' ? await readJson(request) : {};
  requestDetails.push({ method: request.method, path: url.pathname, search: url.search, body });
  const profileMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/profile$/);
  if (request.method === 'GET' && profileMatch) return sendJson(response, 200, { profile: profile(decodeURIComponent(profileMatch[1])) });
  if (request.method === 'GET' && url.pathname === '/api/public/business/multi-salon/services-v2') return sendJson(response, 200, multiCatalog());
  if (request.method === 'GET' && url.pathname === '/api/public/business/empty-salon/services-v2') return sendJson(response, 200, { services: [] });
  if (request.method === 'GET' && url.pathname === '/api/public/business/retry-salon/services-v2') {
    retryCatalogCalls += 1;
    return retryCatalogCalls === 1
      ? sendJson(response, 503, { error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Hizmetler geçici olarak yüklenemedi.' } })
      : sendJson(response, 200, multiCatalog());
  }
  if (request.method === 'GET' && /^\/api\/public\/business\/[^/]+\/services-v2$/.test(url.pathname)) {
    return sendJson(response, 200, { services: [] });
  }
  if (request.method === 'GET' && ['/api/public/business/multi-salon/staff', '/api/public/business/retry-salon/staff'].includes(url.pathname)) {
    if (url.pathname.includes('retry-salon')) {
      retryStaffCalls += 1;
      if (retryStaffCalls === 1) return sendJson(response, 503, { error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Personel geçici olarak yüklenemedi.' } });
    }
    const serviceId = url.searchParams.get('serviceId');
    return sendJson(response, 200, { staff: serviceId === serviceA
      ? [{ staff_id: staffA, staff_name: 'Ada' }]
      : serviceId === serviceB ? [{ staff_id: staffB, staff_name: 'Bora' }] : [] });
  }
  if (request.method === 'POST' && url.pathname === '/api/public/business/multi-salon/group-slots') {
    if (body.date === '2026-09-23') {
      retrySlotCalls += 1;
      if (retrySlotCalls % 2 === 1) return sendJson(response, 503, { error: { code: 'PUBLIC_BOOKING_UNAVAILABLE', message: 'Uygun saatler geçici olarak yüklenemedi.' } });
    }
    const payload = groupSlots(body);
    if (body.date === '2026-09-20') await sleep(900);
    return sendJson(response, 200, payload);
  }
  const bookingMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)$/);
  if (request.method === 'GET' && bookingMatch) return sendJson(response, 200, bookingPayload(decodeURIComponent(bookingMatch[1])));
  if (request.method === 'GET' && url.pathname === `/api/public/media/${brokenMediaId}`) return sendJson(response, 404, { error: { code: 'PUBLIC_MEDIA_NOT_FOUND' } });
  // F16-04: the salon page now reads published reviews; this fixture has none.
  if (request.method === 'GET' && /^\/api\/public\/business\/[^/]+\/reviews$/.test(url.pathname)) {
    return sendJson(response, 200, { reviews: [], summary: { count: 0, average: null } });
  }
  return sendJson(response, 404, { error: { code: 'NOT_FOUND' } });
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

async function waitFor(read, message, timeoutMs = 10_000) {
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
        client.ws.addEventListener('error', () => reject(new Error('F12 CDP WebSocket failed')), { once: true });
      }),
      sleep(5_000).then(() => { throw new Error('F12 CDP WebSocket timed out'); }),
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
  send(method, params = {}, timeoutMs = 7_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, timeoutMs = 7_000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async tab() {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
  close() { this.ws.close(); }
}

async function inspectViewport(debugUrl, origin, slug, width) {
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
    await page.send('Page.navigate', { url: `${origin}/harness/${slug}` });
    const readyExpression = slug === 'broken-salon'
      ? 'document.documentElement.dataset.f12Ready === "true" && Boolean(document.querySelector(".public-salon-section-nav")) && document.body.innerText.includes("Fotoğraf yüklenemedi")'
      : 'document.documentElement.dataset.f12Ready === "true" && Boolean(document.querySelector(".public-salon-section-nav"))';
    await waitFor(() => page.evaluate(readyExpression), `F12 ${width}px harness did not become ready`);
    const result = await page.evaluate(`(() => {
      const root = document.documentElement;
      const layoutWidth = root.clientWidth;
      const offenders = Array.from(document.querySelectorAll('body *')).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          id: node.id || '',
          className: typeof node.className === 'string' ? node.className : '',
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          text: (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
        };
      }).filter((item) => item.right > layoutWidth + 1 || item.left < -1 || item.scrollWidth > item.clientWidth + 1).slice(0, 16);
      return {
        html: root.outerHTML,
        layoutWidth,
        innerWidth: window.innerWidth,
        scrollWidth: root.scrollWidth,
        overflow: root.scrollWidth > layoutWidth + 1,
        offenders,
        touch: Array.from(document.querySelectorAll('.public-salon-section-nav a')).every((node) => node.getBoundingClientRect().height >= 44)
      };
    })()`);
    return { ...result, diagnostics: page.diagnostics };
  } finally { page.close(); }
}


async function inspectMultiSelection(debugUrl, origin, width) {
  const requestStart = requestDetails.length;
  const targetUrl = origin + '/r/multi-salon?customer=secret#private';
  const target = await (await fetch(debugUrl + '/json/new?' + encodeURIComponent(targetUrl), { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: true });
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-service-choice").length === 2'), 'F12-04 catalog did not become ready');

    const viewport = await page.evaluate('(() => { const root=document.documentElement; const controls=Array.from(document.querySelectorAll(".public-multi-service button, .public-multi-service select, .public-multi-service input, .public-salon-actions button")); return { width:root.clientWidth, overflow:root.scrollWidth>root.clientWidth+1, targets:controls.length>0&&controls.every((node)=>node.getBoundingClientRect().height>=44), body:document.body.innerText }; })()');
    assert.equal(viewport.width, width);
    assert.equal(viewport.overflow, false, 'F12-04 planner overflowed at ' + width + 'px');
    assert.equal(viewport.targets, true, 'F12-04 planner has a sub-44px control at ' + width + 'px');
    assert.match(viewport.body, /Renk Paketi/);
    assert.match(viewport.body, /Kesim/);

    await page.evaluate('(() => { const buttons=Array.from(document.querySelectorAll(".public-salon-actions button")); buttons.find((button)=>button.textContent.includes("Favoriye"))?.click(); buttons.find((button)=>button.textContent.includes("Paylaş"))?.click(); })()');
    await waitFor(() => page.evaluate('document.documentElement.dataset.f12SharedUrl || false'), 'F12-04 share did not execute');
    const actions = await page.evaluate('(() => ({ favorite:localStorage.getItem("randevu-kolay:favorite-salon:multi-salon"), shared:document.documentElement.dataset.f12SharedUrl }))()');
    assert.equal(actions.favorite, '1');
    assert.equal(actions.shared, origin + '/r/multi-salon');

    await page.evaluate('Array.from(document.querySelectorAll(".public-service-choice")).forEach((button)=>button.click())');
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-selected-line").length === 2'), 'F12-04 did not select two services');
    await waitFor(() => page.evaluate('document.querySelector(".public-selected-line select")?.options.length > 1'), 'F12-04 staff options did not load');

    await page.evaluate('(() => { const firstSelect=document.querySelector(".public-selected-line select"); firstSelect.value="' + staffA + '"; firstSelect.dispatchEvent(new Event("change",{bubbles:true})); const up=Array.from(document.querySelectorAll(".public-line-actions button")).find((button)=>button.getAttribute("aria-label")?.includes("Kesim hizmetini yukarı")); up?.click(); })()');
    await waitFor(() => page.evaluate('document.querySelector(".public-selected-line strong")?.textContent === "Kesim"'), 'F12-04 reorder did not persist');

    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
    await waitFor(() => requestDetails.slice(requestStart).some((item) => item.path.endsWith('/group-slots') && item.body.date === '2026-09-20'), 'F12-04 old-date request missing');

    await page.evaluate('(() => { const input=document.querySelector(".public-multi-date-row input[type=date]"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter.call(input,"2026-09-21"); input.dispatchEvent(new Event("input",{bubbles:true})); input.dispatchEvent(new Event("change",{bubbles:true})); })()');
    await waitFor(() => page.evaluate('document.querySelector(".public-multi-date-row input")?.value === "2026-09-21"'), 'F12-04 date change did not apply');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
    await waitFor(() => requestDetails.slice(requestStart).some((item) => item.path.endsWith('/group-slots') && item.body.date === '2026-09-21'), 'F12-04 new-date request missing');
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-group-slot").length === 1'), 'F12-04 new-date slot missing');

    const latest = [...requestDetails.slice(requestStart)].reverse().find((item) => item.path.endsWith('/group-slots') && item.body.date === '2026-09-21');
    assert.deepEqual(latest.body.lines, [
      { serviceId: serviceB, staffId: null },
      { serviceId: serviceA, staffId: staffA },
    ]);

    await page.evaluate('document.querySelector(".public-group-slot")?.click()');
    await waitFor(() => page.evaluate('Boolean(document.querySelector(".public-group-summary"))'), 'F12-04 summary missing');
    await sleep(1000);
    const summary = await page.evaluate('document.querySelector(".public-group-summary")?.innerText ?? ""');
    assert.match(summary, /Kesim/);
    assert.match(summary, /Renk Paketi/);
    assert.match(summary, /10:00/);
    assert.doesNotMatch(summary, /09:00/);

    const completedViewport = await page.evaluate('(() => { const root=document.documentElement; const controls=Array.from(document.querySelectorAll(".public-multi-service button, .public-multi-service select, .public-multi-service input, .public-salon-actions button")); const offenders=Array.from(document.querySelectorAll("body *")).map((node)=>{const rect=node.getBoundingClientRect();return {tag:node.tagName,className:typeof node.className==="string"?node.className:"",right:rect.right,left:rect.left,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};}).filter((item)=>item.right>root.clientWidth+1||item.left<-1||item.scrollWidth>item.clientWidth+1).slice(0,12); return {overflow:root.scrollWidth>root.clientWidth+1,offenders,targets:controls.length>0&&controls.every((node)=>node.getBoundingClientRect().height>=44)}; })()');
    assert.equal(completedViewport.overflow, false, 'F12-04 completed planner overflowed at ' + width + 'px: ' + JSON.stringify(completedViewport.offenders));
    assert.equal(completedViewport.targets, true, 'F12-04 completed planner has a sub-44px control at ' + width + 'px');

    await page.evaluate('document.body.tabIndex=-1; document.body.focus()');
    const keyboard = { action: false, service: false, staff: false, date: false, submit: false, slot: false };
    for (let index = 0; index < 80; index += 1) {
      await page.tab();
      const focus = await page.evaluate('(() => { const node=document.activeElement; const visible=Boolean(node?.matches?.(":focus-visible")); return {visible,action:Boolean(node?.closest?.(".public-salon-actions")),service:Boolean(node?.classList?.contains("public-service-choice")),staff:node?.tagName==="SELECT",date:node?.getAttribute?.("type")==="date",submit:Boolean(node?.classList?.contains("public-primary")),slot:Boolean(node?.classList?.contains("public-group-slot"))}; })()');
      if (focus.visible) {
        for (const key of Object.keys(keyboard)) keyboard[key] ||= focus[key];
      }
      if (Object.values(keyboard).every(Boolean)) break;
    }
    assert.deepEqual(keyboard, { action: true, service: true, staff: true, date: true, submit: true, slot: true }, 'F12-04 keyboard focus did not reach every planner control family');

    await page.evaluate('(() => { const input=document.querySelector(".public-multi-date-row input[type=date]"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter.call(input,"2026-09-22"); input.dispatchEvent(new Event("input",{bubbles:true})); input.dispatchEvent(new Event("change",{bubbles:true})); })()');
    await waitFor(() => page.evaluate('document.querySelector(".public-multi-date-row input")?.value === "2026-09-22" && !document.querySelector(".public-group-summary")'), 'F12-04 selected plan survived a date change');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
    await waitFor(() => page.evaluate('document.body.innerText.includes("Bu seçim için uygun ortak saat bulunamadı. Başka bir tarih seçin.")'), 'F12-04 empty-slot state missing');
    assert.equal(await page.evaluate('document.querySelectorAll(".public-group-slot").length'), 0);

    await page.evaluate('(() => { const input=document.querySelector(".public-multi-date-row input[type=date]"); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set; setter.call(input,"2026-09-23"); input.dispatchEvent(new Event("input",{bubbles:true})); input.dispatchEvent(new Event("change",{bubbles:true})); })()');
    await waitFor(() => page.evaluate('document.querySelector(".public-multi-date-row input")?.value === "2026-09-23"'), 'F12-04 retry date change did not apply');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Birlikte uygun saatleri bul"))?.click()');
    await waitFor(() => page.evaluate('Array.from(document.querySelectorAll("button")).some((button)=>button.textContent.includes("Uygun saatleri tekrar dene"))'), 'F12-04 slot retry action missing');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Uygun saatleri tekrar dene"))?.click()');
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-group-slot").length === 1'), 'F12-04 slot retry did not recover');
    assert.deepEqual(page.diagnostics, []);
    return { favorite: actions.favorite };
  } finally {
    page.close();
  }
}

async function inspectRetryRecovery(debugUrl, origin) {
  const target = await (await fetch(debugUrl + '/json/new?' + encodeURIComponent(origin + '/r/retry-salon'), { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
    await waitFor(() => page.evaluate('Array.from(document.querySelectorAll("button")).some((button)=>button.textContent.trim()==="Tekrar dene")'), 'F12-04 catalog retry action missing');
    assert.match(await page.evaluate('document.body.innerText'), /Hizmetler geçici olarak yüklenemedi/);
    assert.equal(await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.trim()==="Tekrar dene")?.getBoundingClientRect().height >= 44'), true);
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.trim()==="Tekrar dene")?.click()');
    await waitFor(() => page.evaluate('document.querySelectorAll(".public-service-choice").length === 2'), 'F12-04 catalog retry did not recover');

    await page.evaluate('document.querySelector(".public-service-choice")?.click()');
    await waitFor(() => page.evaluate('Array.from(document.querySelectorAll("button")).some((button)=>button.textContent.includes("Personeli tekrar yükle"))'), 'F12-04 staff retry action missing');
    await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Personeli tekrar yükle"))?.click()');
    await waitFor(() => page.evaluate('document.querySelector(".public-selected-line select")?.options.length > 1'), 'F12-04 staff retry did not recover');
    assert.equal(retryCatalogCalls, 2);
    assert.equal(retryStaffCalls, 2);
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

async function inspectEmptyCatalog(debugUrl, origin) {
  const target = await (await fetch(debugUrl + '/json/new?' + encodeURIComponent(origin + '/r/empty-salon'), { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: true });
    await waitFor(() => page.evaluate('document.body.innerText.includes("Şu anda seçilebilecek hizmet bulunmuyor.")'), 'F12-04 empty catalog state missing');
    assert.equal(await page.evaluate('Array.from(document.querySelectorAll("button")).find((button)=>button.textContent.includes("Hizmetleri yenile"))?.getBoundingClientRect().height >= 44'), true);
    assert.equal(await page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'), false);
    assert.deepEqual(page.diagnostics, []);
  } finally {
    page.close();
  }
}

function assertCommon(result, width) {
  assert.equal(result.layoutWidth, width, `requested ${width}px layout viewport rendered as ${result.layoutWidth}px (innerWidth ${result.innerWidth}px)`);
  assert.equal(result.overflow, false, `${width}px salon page overflowed horizontally: layout=${result.layoutWidth}, scroll=${result.scrollWidth}, offenders=${JSON.stringify(result.offenders)}`);
  assert.equal(result.touch, true, `${width}px salon navigation touch targets fell below 44px`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.html, />Hizmetler</);
  assert.match(result.html, />Bilgiler</);
  assert.match(result.html, /Şu anda seçilebilecek hizmet bulunmuyor\./);
  // F16-04 made reviews real: the section is present with an honest empty state.
  assert.match(result.html, />Yorumlar</);
  assert.match(result.html, /Henüz yayınlanmış yorum yok\./);
  assert.doesNotMatch(result.html, /\btenant\b|\bRPC\b|\bFAZ\b/i);
}

let chrome;
let chromeFd;
try {
  await build({ configFile: false, root, publicDir: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: bundleDir, emptyOutDir: true, minify: false, lib: { entry: path.join(root, 'tests/browser/f12-public-profile.tsx'), formats: ['es'] }, rollupOptions: { output: { entryFileNames: 'test.js' } } } });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  const cssFile = readdirSync(bundleDir).find((name) => name.endsWith('.css'));
  assert.ok(cssFile, 'F12 browser bundle did not emit CSS');
  testCss = readFileSync(path.join(bundleDir, cssFile));

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chromeBin = process.env.CHROME_BIN;
  assert.ok(chromeBin, 'CHROME_BIN must identify the CI Chrome executable');
  const profileDir = path.join(work, 'profile');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', chromeFd, chromeFd] });
  const activePort = path.join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(() => { try { return readFileSync(activePort, 'utf8').split(/\r?\n/)[0] || false; } catch { return false; } }, 'F12 Chrome did not expose a debugging port');
  const debugUrl = `http://127.0.0.1:${port}`;

  const missing360 = await inspectViewport(debugUrl, origin, 'missing-salon', 360);
  assertCommon(missing360, 360);
  assert.match(missing360.html, /Fotoğraf henüz eklenmedi/);
  assert.match(missing360.html, /Fotoğrafsız Salon/);
  assert.match(missing360.html, /Bahçeşehir, İstanbul/);

  const broken390 = await inspectViewport(debugUrl, origin, 'broken-salon', 390);
  assertCommon(broken390, 390);
  assert.match(broken390.html, /Fotoğraf yüklenemedi/);
  assert.match(broken390.html, /Kırık Görsel Salon/);

  await inspectMultiSelection(debugUrl, origin, 360);
  await inspectMultiSelection(debugUrl, origin, 390);
  await inspectRetryRecovery(debugUrl, origin);
  await inspectEmptyCatalog(debugUrl, origin);

  assert.ok(requests.includes('GET /api/public/business/missing-salon/profile'));
  assert.ok(requests.includes('GET /api/public/business/missing-salon'));
  assert.ok(requests.includes('GET /api/public/business/broken-salon/profile'));
  assert.ok(requests.includes(`GET /api/public/media/${brokenMediaId}`));
  console.log('F12 public browser passed: F12-02 media fallbacks plus F12-04 360/390 multi-service, stale/empty/error retry and keyboard acceptance.');
} catch (error) {
  let chromeDiagnostics = '';
  try { chromeDiagnostics = `\nChrome log:\n${readFileSync(chromeLog, 'utf8').slice(-4000)}`; } catch { /* noop */ }
  throw new Error(`${error.message}${chromeDiagnostics}`);
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
  if (chromeFd !== undefined) closeSync(chromeFd);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(work, { recursive: true, force: true });
      break;
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 5) throw error;
      await sleep(100 * (attempt + 1));
    }
  }
}
