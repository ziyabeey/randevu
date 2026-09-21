import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f12-operator-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const csrfToken = 'F'.repeat(43);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sockets = new Set();
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK0l8AAAAASUVORK5CYII=', 'base64');
let testJs = Buffer.alloc(0);
let testCss = Buffer.alloc(0);

const ids = {
  businessA: 'f1200000-0000-4000-8000-000000000001',
  businessB: 'f1200000-0000-4000-8000-000000000002',
  membershipA: 'f1210000-0000-4000-8000-000000000001',
  membershipB: 'f1210000-0000-4000-8000-000000000002',
};

function makeTenant(key) {
  const a = key === 'A';
  return {
    id: a ? ids.businessA : ids.businessB,
    membershipId: a ? ids.membershipA : ids.membershipB,
    name: a ? 'Salon A' : 'Salon B',
    slug: a ? 'salon-a' : 'salon-b',
    profile: {
      business_id: a ? ids.businessA : ids.businessB,
      public_name: a ? 'Salon A Public' : 'Salon B Public',
      short_description: a ? 'PRIVATE-OPERATOR-A' : 'PRIVATE-OPERATOR-B',
      long_description: 'Operator browser acceptance profile',
      public_phone: '+905551112233',
      public_email: 'operator@example.invalid',
      public_website: 'https://example.invalid',
      public_whatsapp: '+905551112233',
      address_text: a ? 'A Mahallesi' : 'B Mahallesi',
      show_work_hours: true,
      cover_media_id: null,
      media: [],
    },
    settings: {
      business_id: a ? ids.businessA : ids.businessB,
      enabled: true,
      step_minutes: 15,
      min_notice_minutes: 60,
      horizon_days: 60,
    },
    information: {
      business_id: a ? ids.businessA : ids.businessB,
      kvkk_notice_text: 'Bu metin yalnız browser fixture işletmesi tarafından yayınlanan test aydınlatma içeriğidir.',
      kvkk_notice_url: 'https://example.invalid/kvkk',
      privacy_policy_url: 'https://example.invalid/privacy',
      booking_terms_text: 'Browser fixture işletmesinin test randevu, iptal ve değişiklik koşulları.',
      booking_terms_url: 'https://example.invalid/terms',
    },
  };
}

const state = {
  selected: 'A',
  recovery: false,
  failUploadOnce: false,
  failDeleteOnce: false,
  failProfileReadOnce: false,
  delayAProfileOnceMs: 0,
  mediaSequence: 1,
  requests: [],
  tenants: { A: makeTenant('A'), B: makeTenant('B') },
};

function membership(tenant) {
  return { id: tenant.membershipId, business_id: tenant.id, role: 'owner', active: true };
}
function settingsPayload(tenant) {
  return {
    membership: membership(tenant),
    business: { id: tenant.id, name: tenant.name, slug: tenant.slug, timezone: 'Europe/Istanbul' },
    settings: tenant.settings,
  };
}
function profilePayload(tenant) {
  return { membership: membership(tenant), profile: tenant.profile };
}
function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch { return {}; }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(testJs); return; }
    if (url.pathname === '/style.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(testCss); return; }
    if (url.pathname === '/operator' || url.pathname === '/public-visibility') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/public/profile/media/') && url.pathname.endsWith('/content')) {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      response.end(pngBytes);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/public/media/f12-ready-public') {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      response.end(pngBytes);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken });

    const selectedKey = state.selected;
    const tenant = state.tenants[selectedKey];
    state.requests.push({ method: request.method, path: url.pathname, selected: selectedKey });

    if (request.method === 'GET' && url.pathname === '/api/public/settings') {
      if (state.recovery) return sendJson(response, 403, { error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Şifre güncellemesi gerekli.' } });
      return sendJson(response, 200, settingsPayload(tenant));
    }
    if (request.method === 'GET' && url.pathname === '/api/public/profile/information') {
      if (state.recovery) return sendJson(response, 403, { error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Şifre güncellemesi gerekli.' } });
      return sendJson(response, 200, { information: tenant.information });
    }
    if (request.method === 'GET' && url.pathname === '/api/public/profile') {
      const capturedKey = selectedKey;
      const captured = state.tenants[capturedKey];
      if (state.recovery) return sendJson(response, 403, { error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Şifre güncellemesi gerekli.' } });
      if (capturedKey === 'A' && state.delayAProfileOnceMs > 0) {
        const delay = state.delayAProfileOnceMs;
        state.delayAProfileOnceMs = 0;
        await sleep(delay);
      }
      if (state.failProfileReadOnce) {
        state.failProfileReadOnce = false;
        return sendJson(response, 503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Güncel salon durumu yüklenemedi.' } });
      }
      return sendJson(response, 200, profilePayload(captured));
    }

    const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readJson(request);
    if (request.method === 'PUT' && url.pathname === '/api/public/profile/information') {
      tenant.information = {
        ...tenant.information,
        kvkk_notice_text: String(body.kvkkNoticeText || '') || null,
        kvkk_notice_url: String(body.kvkkNoticeUrl || '') || null,
        privacy_policy_url: String(body.privacyPolicyUrl || '') || null,
        booking_terms_text: String(body.bookingTermsText || '') || null,
        booking_terms_url: String(body.bookingTermsUrl || '') || null,
      };
      return sendJson(response, 200, { information: tenant.information });
    }
    if (request.method === 'PUT' && url.pathname === '/api/public/profile') {
      const profile = tenant.profile;
      if ('publicName' in body) profile.public_name = String(body.publicName);
      if ('shortDescription' in body) profile.short_description = String(body.shortDescription || '') || null;
      if ('longDescription' in body) profile.long_description = String(body.longDescription || '') || null;
      if ('publicPhone' in body) profile.public_phone = String(body.publicPhone || '') || null;
      if ('publicEmail' in body) profile.public_email = String(body.publicEmail || '') || null;
      if ('publicWebsite' in body) profile.public_website = String(body.publicWebsite || '') || null;
      if ('publicWhatsapp' in body) profile.public_whatsapp = String(body.publicWhatsapp || '') || null;
      if ('addressText' in body) profile.address_text = String(body.addressText || '') || null;
      if ('showWorkHours' in body) profile.show_work_hours = Boolean(body.showWorkHours);
      if ('coverMediaId' in body) profile.cover_media_id = body.coverMediaId || null;
      return sendJson(response, 200, { profile });
    }
    if (request.method === 'POST' && url.pathname === '/api/public/profile/media') {
      if (state.failUploadOnce) {
        state.failUploadOnce = false;
        return sendJson(response, 503, { error: { code: 'UPLOAD_TEMPORARY', message: 'Fotoğraf yükleme geçici olarak başarısız. Yeniden deneyin.' } });
      }
      const mediaId = `f1220000-0000-4000-8000-${String(state.mediaSequence++).padStart(12, '0')}`;
      tenant.profile.media.push({ id: mediaId, alt_text: url.searchParams.get('alt') || null, sort_order: tenant.profile.media.length, width: 1, height: 1 });
      return sendJson(response, 201, { mediaId });
    }
    const deleteMatch = url.pathname.match(/^\/api\/public\/profile\/media\/([^/]+)$/);
    if (request.method === 'DELETE' && deleteMatch) {
      if (state.failDeleteOnce) {
        state.failDeleteOnce = false;
        return sendJson(response, 503, { error: { code: 'DELETE_TEMPORARY', message: 'Fotoğraf silme geçici olarak başarısız. Yeniden deneyin.' } });
      }
      tenant.profile.media = tenant.profile.media.filter((media) => media.id !== deleteMatch[1]);
      if (tenant.profile.cover_media_id === deleteMatch[1]) tenant.profile.cover_media_id = null;
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/api/public/business/visibility-salon/profile') {
      const internalMedia = [
        { id: 'f12-ready-public', status: 'ready', alt_text: 'READY-PUBLIC-MEDIA', sort_order: 0, width: 1600, height: 1000 },
        { id: 'f12-pending-private', status: 'pending', alt_text: 'PENDING-MUST-NOT-RENDER', sort_order: 1, width: 1600, height: 1000 },
        { id: 'f12-deleting-private', status: 'deleting', alt_text: 'DELETING-MUST-NOT-RENDER', sort_order: 2, width: 1600, height: 1000 },
        { id: 'f12-cleanup-private', status: 'cleanup', alt_text: 'CLEANUP-MUST-NOT-RENDER', sort_order: 3, width: 1600, height: 1000 },
      ];
      const media = internalMedia.filter((item) => item.status === 'ready').map(({ status: _status, ...item }) => item);
      return sendJson(response, 200, { profile: {
        public_name: 'Visibility Salon', short_description: 'Only ready media is public.', long_description: null,
        public_phone: null, public_email: null, public_website: null, public_whatsapp: null, address_text: null,
        show_work_hours: false, cover_media_id: 'f12-ready-public', work_hours: [], media,
      } });
    }
    if (request.method === 'GET' && url.pathname === '/api/public/business/visibility-salon') {
      return sendJson(response, 200, {
        business: { name: 'Visibility Salon', slug: 'visibility-salon', timezone: 'Europe/Istanbul', local_date: '2026-09-15', max_date: '2026-11-14', step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 },
        services: [], bookingClock: { serverNowEpochSeconds: 1789440000, submitWindowSeconds: 300 },
      });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Fixture route missing.' } });
  } catch (error) {
    sendJson(response, 500, { error: { code: 'FIXTURE_ERROR', message: error instanceof Error ? error.message : String(error) } });
  }
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
        client.ws.addEventListener('error', () => reject(new Error('F12 operator CDP WebSocket failed')), { once: true });
      }),
      sleep(5_000).then(() => { throw new Error('F12 operator CDP WebSocket timed out'); }),
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

function call(page, method, ...args) {
  return page.evaluate(`window.__f12operator[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function text(page) { return call(page, 'text'); }
async function waitText(page, value, timeoutMs = 10_000) {
  return waitFor(async () => (await text(page)).includes(value), `F12 operator UI did not contain ${value}`, timeoutMs);
}
async function waitOmit(page, value, timeoutMs = 10_000) {
  return waitFor(async () => !(await text(page)).includes(value), `F12 operator UI still contained ${value}`, timeoutMs);
}
async function openPage(debugUrl, origin, pathname, width, waitReady = true) {
  const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: true });
  await page.send('Page.navigate', { url: `${origin}${pathname}` });
  if (waitReady) await waitFor(() => page.evaluate('document.documentElement.dataset.f12OperatorReady === "true"'), `F12 operator ${pathname} did not become ready`);
  return page;
}
async function pressTab(page) {
  const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await sleep(35);
  return call(page, 'activeFocus');
}

let chrome;
let chromeFd;
try {
  await build({ configFile: false, root, publicDir: false, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { outDir: bundleDir, emptyOutDir: true, minify: false, lib: { entry: path.join(root, 'tests/browser/f12-public-operator.tsx'), formats: ['es'] }, rollupOptions: { output: { entryFileNames: 'test.js' } } } });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  const cssFile = readdirSync(bundleDir).find((name) => name.endsWith('.css'));
  assert.ok(cssFile, 'F12 operator browser bundle did not emit CSS');
  testCss = readFileSync(path.join(bundleDir, cssFile));

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chromeBin = process.env.CHROME_BIN;
  assert.ok(chromeBin, 'CHROME_BIN must identify the CI Chrome executable');
  const profileDir = path.join(work, 'profile');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', chromeFd, chromeFd] });
  const activePort = path.join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(() => { try { return readFileSync(activePort, 'utf8').split(/\r?\n/)[0] || false; } catch { return false; } }, 'F12 operator Chrome did not expose a debugging port');
  const debugUrl = `http://127.0.0.1:${port}`;

  state.selected = 'A';
  state.recovery = false;
  const page = await openPage(debugUrl, origin, '/operator', 390);
  await waitText(page, 'Salon profiliniz ve randevu bağlantınız');
  const metrics390 = await call(page, 'metrics');
  assert.equal(metrics390.layoutWidth, 390);
  assert.equal(metrics390.overflow, false, `390px operator overflow: ${JSON.stringify(metrics390)}`);
  assert.ok(metrics390.touchTargets.length >= 4, '390px operator critical controls were not discovered');
  assert.ok(metrics390.touchTargets.every((target) => target.height >= 44), `390px operator touch target below 44px: ${JSON.stringify(metrics390.touchTargets)}`);

  const focusPath = [];
  await page.evaluate('document.activeElement instanceof HTMLElement && document.activeElement.blur()');
  const focusableCount = await page.evaluate('document.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\\\"-1\\\"])").length');
  for (let index = 0; index < Math.min(Number(focusableCount) + 2, 48); index += 1) {
    const focused = await pressTab(page);
    if (focused.label) focusPath.push(focused);
    if (focusPath.some((item) => item.label.includes('Müşteri görünümünü aç'))) break;
  }
  const focusLabels = focusPath.map((item) => item.label);
  assert.ok(focusLabels.includes('publicName'), `keyboard did not reach profile name: ${JSON.stringify(focusLabels)}`);
  assert.ok(focusLabels.includes('photo'), `keyboard did not reach photo input: ${JSON.stringify(focusLabels)}`);
  assert.ok(focusLabels.some((label) => label.includes('Kopyala')), `keyboard did not reach copy control: ${JSON.stringify(focusLabels)}`);
  assert.ok(focusLabels.some((label) => label.includes('Müşteri görünümünü aç')), `keyboard did not reach preview link: ${JSON.stringify(focusLabels)}`);
  assert.ok(focusPath.every((item) => item.focusVisible && item.outlineStyle !== 'none' && item.outlineWidth !== '0px'), `keyboard focus was not visibly outlined: ${JSON.stringify(focusPath)}`);

  await call(page, 'setProfileName', 'Salon A Güncel');
  await call(page, 'submitProfile');
  await waitText(page, 'Salon profili kaydedildi.');

  state.failUploadOnce = true;
  await call(page, 'setPhoto');
  await call(page, 'submitUpload');
  await waitText(page, 'Fotoğraf yükleme geçici olarak başarısız. Yeniden deneyin.');
  assert.match(await text(page), /0\/20/);
  await call(page, 'submitUpload');
  await waitText(page, 'Fotoğraf eklendi.');
  await waitText(page, '1/20');

  await call(page, 'click', 'Kapak yap');
  await waitText(page, 'Kapak fotoğrafı güncellendi.');
  await waitText(page, 'Kapak fotoğrafı');

  state.failDeleteOnce = true;
  await call(page, 'click', 'Sil');
  await waitText(page, 'Fotoğraf silme geçici olarak başarısız. Yeniden deneyin.');
  await waitText(page, '1/20');
  await call(page, 'click', 'Sil');
  await waitText(page, 'Fotoğraf silindi.');
  await waitText(page, '0/20');

  state.failProfileReadOnce = true;
  await call(page, 'setPhoto');
  await call(page, 'submitUpload');
  await waitText(page, 'Yükleme sunucuda tamamlandı, ancak güncel salon durumu yeniden yüklenemedi. Tekrar yükleyin.');
  assert.doesNotMatch(await text(page), /Fotoğraf eklendi\./);
  await waitText(page, 'Çalışma alanı açılamadı.');
  await call(page, 'click', 'Tekrar yükle');
  await waitText(page, '1/20');
  await waitOmit(page, 'Çalışma alanı açılamadı.');

  state.failProfileReadOnce = true;
  await call(page, 'click', 'Sil');
  await waitText(page, 'Silme işlemi sunucuda tamamlandı, ancak güncel salon durumu yeniden yüklenemedi. Tekrar yükleyin.');
  assert.doesNotMatch(await text(page), /Fotoğraf silindi\./);
  await call(page, 'click', 'Tekrar yükle');
  await waitText(page, '0/20');
  const metricsAfter = await call(page, 'metrics');
  assert.equal(metricsAfter.overflow, false);
  assert.ok(metricsAfter.touchTargets.every((target) => target.height >= 44), `post-mutation touch target below 44px: ${JSON.stringify(metricsAfter.touchTargets)}`);
  assert.deepEqual(page.diagnostics, []);
  page.close();

  const page360 = await openPage(debugUrl, origin, '/operator', 360);
  const metrics360 = await call(page360, 'metrics');
  assert.equal(metrics360.layoutWidth, 360);
  assert.equal(metrics360.overflow, false, `360px operator overflow: ${JSON.stringify(metrics360)}`);
  assert.ok(metrics360.touchTargets.every((target) => target.height >= 44), `360px operator touch target below 44px: ${JSON.stringify(metrics360.touchTargets)}`);
  page360.close();

  state.recovery = true;
  const recoveryPage = await openPage(debugUrl, origin, '/operator', 390);
  await waitText(recoveryPage, 'Çalışma alanı açılamadı.');
  const recoveryHtml = await call(recoveryPage, 'html');
  assert.doesNotMatch(recoveryHtml, /PRIVATE-OPERATOR-A|PRIVATE-OPERATOR-B|Salon fotoğrafları/);
  assert.match(await text(recoveryPage), /Şifre güncellemesi gerekli\./);
  recoveryPage.close();

  state.recovery = false;
  state.selected = 'A';
  state.delayAProfileOnceMs = 800;
  const marker = state.requests.length;
  const stalePage = await openPage(debugUrl, origin, '/operator', 390, false);
  await waitFor(() => state.requests.slice(marker).some((item) => item.path === '/api/public/profile' && item.selected === 'A'), 'stale A profile request did not start');
  state.selected = 'B';
  await waitFor(() => stalePage.evaluate('Boolean(window.__f12operator)'), 'stale operator harness did not load');
  await call(stalePage, 'remount');
  await waitText(stalePage, 'Salon B · Europe/Istanbul');
  await sleep(950);
  assert.match(await text(stalePage), /Salon B · Europe\/Istanbul/);
  assert.doesNotMatch(await text(stalePage), /Salon A · Europe\/Istanbul/);
  stalePage.close();

  const publicPage = await openPage(debugUrl, origin, '/public-visibility', 390);
  await waitText(publicPage, 'Visibility Salon');
  await waitText(publicPage, 'Şu anda online randevuya açık hizmet bulunmuyor.');
  const publicHtml = await call(publicPage, 'html');
  assert.match(publicHtml, /READY-PUBLIC-MEDIA/);
  assert.doesNotMatch(publicHtml, /PENDING-MUST-NOT-RENDER|DELETING-MUST-NOT-RENDER|CLEANUP-MUST-NOT-RENDER/);
  publicPage.close();

  console.log('F12-02 operator browser passed: save/upload/cover/delete, retry and authoritative-refresh failure recovery, recovery/tenant isolation, 360/390 touch, keyboard focus and public ready-only media.');
} catch (error) {
  let chromeDiagnostics = '';
  try { chromeDiagnostics = `\nChrome log:\n${readFileSync(chromeLog, 'utf8').slice(-4000)}`; } catch { /* noop */ }
  throw new Error(`${error instanceof Error ? error.message : String(error)}${chromeDiagnostics}`);
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
