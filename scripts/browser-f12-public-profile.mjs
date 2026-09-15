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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function profile(slug) {
  const broken = slug === 'broken-salon';
  return {
    public_name: broken ? 'Kırık Görsel Salon' : 'Fotoğrafsız Salon',
    short_description: 'Gerçek salon bilgileriyle sade online randevu.',
    long_description: 'Bahçeşehir’de hizmet veren salonun gerçek profil açıklaması.',
    public_phone: '+905551112233', public_email: 'salon@example.invalid', public_website: null, public_whatsapp: null,
    address_text: 'Bahçeşehir, İstanbul', show_work_hours: true,
    cover_media_id: broken ? brokenMediaId : null,
    work_hours: [{ weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00' }],
    media: broken ? [{ id: brokenMediaId, alt_text: 'Salon giriş alanı', sort_order: 0, width: 1600, height: 1000 }] : [],
  };
}
function bookingPayload(slug) {
  return {
    business: { name: slug === 'broken-salon' ? 'Kırık Görsel Salon' : 'Fotoğrafsız Salon', slug, timezone: 'Europe/Istanbul', local_date: '2026-09-14', max_date: '2026-11-13', step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 },
    services: [], bookingClock: { serverNowEpochSeconds: 1789360000, submitWindowSeconds: 300 },
  };
}
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  requests.push(`${request.method} ${url.pathname}`);
  if (url.pathname === '/test.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(testJs); return; }
  if (url.pathname === '/style.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(testCss); return; }
  if (url.pathname.startsWith('/harness/')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
    return;
  }
  const profileMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)\/profile$/);
  if (request.method === 'GET' && profileMatch) return sendJson(response, 200, { profile: profile(decodeURIComponent(profileMatch[1])) });
  const bookingMatch = url.pathname.match(/^\/api\/public\/business\/([^/]+)$/);
  if (request.method === 'GET' && bookingMatch) return sendJson(response, 200, bookingPayload(decodeURIComponent(bookingMatch[1])));
  if (request.method === 'GET' && url.pathname === `/api/public/media/${brokenMediaId}`) return sendJson(response, 404, { error: { code: 'PUBLIC_MEDIA_NOT_FOUND' } });
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
      ? 'document.documentElement.dataset.f12Ready === "true" && document.body.innerText.includes("Fotoğraf yüklenemedi")'
      : 'document.documentElement.dataset.f12Ready === "true"';
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

function assertCommon(result, width) {
  assert.equal(result.layoutWidth, width, `requested ${width}px layout viewport rendered as ${result.layoutWidth}px (innerWidth ${result.innerWidth}px)`);
  assert.equal(result.overflow, false, `${width}px salon page overflowed horizontally: layout=${result.layoutWidth}, scroll=${result.scrollWidth}, offenders=${JSON.stringify(result.offenders)}`);
  assert.equal(result.touch, true, `${width}px salon navigation touch targets fell below 44px`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.html, />Hizmetler</);
  assert.match(result.html, />Bilgiler</);
  assert.match(result.html, /Şu anda online randevuya açık hizmet bulunmuyor\./);
  assert.doesNotMatch(result.html, />Yorumlar</);
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

  assert.ok(requests.includes('GET /api/public/business/missing-salon/profile'));
  assert.ok(requests.includes('GET /api/public/business/missing-salon'));
  assert.ok(requests.includes('GET /api/public/business/broken-salon/profile'));
  assert.ok(requests.includes(`GET /api/public/media/${brokenMediaId}`));
  console.log('F12-02 browser passed: exact 360/390 layout viewports, missing/broken media fallback and preserved booking surface.');
} catch (error) {
  let chromeDiagnostics = '';
  try { chromeDiagnostics = `\nChrome log:\n${readFileSync(chromeLog, 'utf8').slice(-4000)}`; } catch { /* noop */ }
  throw new Error(`${error.message}${chromeDiagnostics}`);
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
  if (chromeFd !== undefined) closeSync(chromeFd);
  rmSync(work, { recursive: true, force: true });
}
