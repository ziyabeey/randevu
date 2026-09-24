import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F16-03 real-Chrome acceptance: appointment photo tab upload -> view ->
// consent-bound publish -> delete, broken-image fallback, 10-photo cap and the
// service-photo archive at 390px.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f16-media-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = {
  group: 'f1603000-0000-4000-8000-00000000a001',
  full: 'f1603000-0000-4000-8000-00000000a002',
  boya: 'f1603000-0000-4000-8000-00000000b001',
  kesim: 'f1603000-0000-4000-8000-00000000b002',
  broken: 'f1603000-0000-4000-8000-00000000d001',
};
const serviceNames = { [ids.boya]: 'Boya', [ids.kesim]: 'Kesim' };
const state = { photos: [], requests: [], sequence: 0 };
function addPhoto(groupId, fields = {}) {
  state.sequence += 1;
  const photo = {
    id: fields.id ?? `f1603000-0000-4000-8000-0000000e${String(state.sequence).padStart(4, '0')}`,
    groupId, serviceId: fields.serviceId ?? null, caption: fields.caption ?? null, width: 800, height: 600,
    createdAt: new Date(Date.UTC(2026, 8, 24, 10, state.sequence)).toISOString(), published: false,
    customerName: groupId === ids.group ? 'Ayşe Demir' : 'Dolu Randevu', bytes: fields.bytes ?? null,
  };
  state.photos.push(photo);
  return photo;
}
addPhoto(ids.group, { id: ids.broken, caption: 'Eski kayıt', serviceId: ids.boya });
for (let index = 0; index < 10; index += 1) addPhoto(ids.full, { caption: `Dolu ${index + 1}` });

function view(photo) {
  return {
    id: photo.id, groupId: photo.groupId, serviceId: photo.serviceId, serviceName: photo.serviceId ? serviceNames[photo.serviceId] : null,
    customerName: photo.customerName, caption: photo.caption, width: photo.width, height: photo.height,
    createdAt: photo.createdAt, published: photo.published, canDelete: true, canPublish: true,
    contentUrl: `/api/private-media/${photo.id}/content`,
  };
}
let testJs;
const sockets = new Set();
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function rawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(testJs);
      return;
    }
    if (url.pathname.endsWith('.css')) {
      response.writeHead(200, { 'Content-Type': 'text/css' });
      response.end(readFileSync(path.join(bundleDir, path.basename(url.pathname))));
      return;
    }
    if (url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
      return;
    }
    const raw = request.method === 'GET' ? Buffer.alloc(0) : await rawBody(request);
    const body = request.headers['content-type']?.startsWith('application/json') && raw.length ? JSON.parse(raw.toString('utf8')) : null;
    state.requests.push({ method: request.method, path: url.pathname, search: url.search, body, contentType: request.headers['content-type'] ?? null, size: raw.length, csrf: request.headers['x-yzt-csrf'] ?? null });
    if (request.method === 'GET' && url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: 'C'.repeat(43) });
    const groupMatch = url.pathname.match(/^\/api\/bookings\/groups\/([^/]+)\/photos$/);
    if (groupMatch && request.method === 'GET') {
      return sendJson(response, 200, { photos: state.photos.filter((item) => item.groupId === groupMatch[1]).map(view), limit: 10 });
    }
    if (groupMatch && request.method === 'POST') {
      assert.equal(request.headers['content-type'], 'image/webp');
      assert.equal(raw.subarray(0, 4).toString('ascii'), 'RIFF');
      assert.equal(raw.subarray(8, 12).toString('ascii'), 'WEBP');
      assert.equal(request.headers['x-yzt-csrf'], 'C'.repeat(43));
      if (state.photos.filter((item) => item.groupId === groupMatch[1]).length >= 10) {
        return sendJson(response, 409, { error: { code: 'PRIVATE_MEDIA_LIMIT_EXCEEDED', message: 'Bir randevuya en fazla 10 fotoğraf eklenebilir.' } });
      }
      const photo = addPhoto(groupMatch[1], { serviceId: url.searchParams.get('serviceId') || null, caption: url.searchParams.get('caption'), bytes: raw });
      return sendJson(response, 201, { photo: view(photo) });
    }
    const contentMatch = url.pathname.match(/^\/api\/private-media\/([^/]+)\/content$/);
    if (contentMatch && request.method === 'GET') {
      const photo = state.photos.find((item) => item.id === contentMatch[1]);
      if (!photo?.bytes) return sendJson(response, 404, { error: { code: 'PRIVATE_MEDIA_NOT_FOUND', message: 'Fotoğraf bulunamadı.' } });
      response.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' });
      response.end(photo.bytes);
      return;
    }
    const publishMatch = url.pathname.match(/^\/api\/private-media\/([^/]+)\/publish$/);
    if (publishMatch && request.method === 'POST') {
      assert.equal(body?.consentConfirmed, true);
      const photo = state.photos.find((item) => item.id === publishMatch[1]);
      photo.published = true;
      return sendJson(response, 201, { published: true, publicMediaId: 'f1603000-0000-4000-8000-00000000f001' });
    }
    const deleteMatch = url.pathname.match(/^\/api\/private-media\/([^/]+)$/);
    if (deleteMatch && request.method === 'DELETE') {
      state.photos = state.photos.filter((item) => item.id !== deleteMatch[1]);
      return sendJson(response, 200, { deleted: true });
    }
    if (url.pathname === '/api/private-media' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '25');
      const serviceId = url.searchParams.get('serviceId');
      const rows = state.photos
        .filter((item) => !serviceId || item.serviceId === serviceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const beforeId = url.searchParams.get('beforeId');
      const start = beforeId ? rows.findIndex((item) => item.id === beforeId) + 1 : 0;
      const page = rows.slice(start, start + limit);
      const next = rows.length > start + limit ? { beforeCreatedAt: page.at(-1).createdAt, beforeId: page.at(-1).id } : null;
      return sendJson(response, 200, { photos: page.map(view), next });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `fixture missing ${request.method} ${url.pathname}` } });
  } catch (error) {
    return sendJson(response, 500, { error: { message: error instanceof Error ? error.message : 'fixture error' } });
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
  return page.evaluate(`window.__f1603[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
}
async function scopeContains(page, scope, text, timeoutMs = 7_000) {
  return waitFor(async () => (await call(page, 'text', scope)).includes(text), `${scope} did not contain ${text}`, timeoutMs);
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
      cssCodeSplit: false,
      lib: { entry: path.join(root, 'tests/browser/f16-private-media.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js', assetFileNames: 'style.css' } },
    },
  });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
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
  const target = await (await fetch(`${debugUrl}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Page.navigate', { url: `${origin}/harness` });
  await waitFor(() => page.evaluate('document.documentElement.dataset.f1603Ready === "true"'), 'F16-03 harness did not boot');

  // Existing photo whose object is gone renders a fallback instead of breaking the tab.
  await scopeContains(page, 'group', '1/10');
  await waitFor(async () => (await call(page, 'fallbacks', 'group')) === 1, 'broken private image did not fall back');
  await scopeContains(page, 'group', 'Eski kayıt');

  // Upload: PNG is re-encoded to WebP in the browser, service and caption carried.
  assert.equal(await call(page, 'choosePng', 'group', 1200, 900), true);
  assert.equal(await call(page, 'setField', 'group', 'Hizmet', 'Kesim'), true);
  assert.equal(await call(page, 'setField', 'group', 'Açıklama', 'İşlem sonrası'), true);
  assert.equal(await call(page, 'click', 'group', 'Fotoğraf ekle'), true);
  await scopeContains(page, 'group', 'Fotoğraf eklendi.');
  await scopeContains(page, 'group', '2/10');
  const upload = state.requests.find((item) => item.method === 'POST' && item.path === `/api/bookings/groups/${ids.group}/photos`);
  assert.ok(upload, 'upload request missing');
  assert.equal(upload.contentType, 'image/webp');
  const uploadQuery = new URLSearchParams(upload.search);
  assert.equal(uploadQuery.get('serviceId'), ids.kesim);
  assert.equal(uploadQuery.get('caption'), 'İşlem sonrası');
  assert.ok(upload.size > 0 && upload.size <= 5 * 1024 * 1024);
  await waitFor(async () => (await call(page, 'loadedImages', 'group')) === 1, 'uploaded private photo did not render through the content endpoint');

  // Publish requires explicit consent before the action is even enabled.
  assert.equal(await call(page, 'clickInTile', 'group', 'İşlem sonrası', 'Galeride yayınla'), true);
  await waitFor(async () => (await call(page, 'buttonDisabled', 'group', 'Onaylı yayınla')) === true, 'publish was enabled without consent');
  assert.equal(await call(page, 'checkConsent', 'group'), true);
  assert.equal(await call(page, 'click', 'group', 'Onaylı yayınla'), true);
  await scopeContains(page, 'group', 'Salon galerisinde yayında');
  const publish = state.requests.find((item) => item.method === 'POST' && item.path.endsWith('/publish'));
  assert.equal(publish.body.consentConfirmed, true);
  assert.equal(publish.body.altText, 'İşlem sonrası');

  // Delete the broken record; the tab stays usable.
  const before = state.requests.length;
  assert.equal(await call(page, 'clickInTile', 'group', 'Eski kayıt', 'Sil'), true);
  await waitFor(() => state.requests.slice(before).some((item) => item.method === 'DELETE' && item.path === `/api/private-media/${ids.broken}`), 'delete did not target the broken record');
  await scopeContains(page, 'group', '1/10');
  await waitFor(async () => (await call(page, 'fallbacks', 'group')) === 0, 'deleted photo still rendered');

  // A full appointment hides the upload form and explains the cap.
  await scopeContains(page, 'full', '10/10');
  assert.equal(await call(page, 'hasUploadForm', 'full'), false);
  await scopeContains(page, 'full', 'en fazla 10 fotoğraf');

  // Archive: newest first, customer context, service filter reaches the API.
  await scopeContains(page, 'archive', 'Hizmet fotoğraf arşivi');
  await scopeContains(page, 'archive', 'Ayşe Demir');
  assert.equal(await call(page, 'setField', 'archive', 'Hizmet', 'Kesim'), true);
  await waitFor(() => state.requests.some((item) => item.path === '/api/private-media' && item.search.includes(`serviceId=${ids.kesim}`)), 'archive service filter did not reach the API');
  await waitFor(async () => !(await call(page, 'text', 'archive')).includes('Dolu 1'), 'archive filter kept other services');
  await scopeContains(page, 'archive', 'İşlem sonrası');

  const layout = await call(page, 'layout');
  assert.ok(layout.overflow <= 1, `F16-03 photo surfaces overflow at 390px by ${layout.overflow}px`);
  assert.deepEqual(layout.shortTargets, [], 'F16-03 touch targets below 44px');
  assert.ok(state.requests.filter((item) => item.method !== 'GET').every((item) => item.csrf === 'C'.repeat(43)), 'a photo mutation omitted CSRF');
  console.log('F16-03 Chrome acceptance passed: 390px upload/webp/view/consent publish/delete, broken-image fallback, 10-photo cap and service archive filter.');
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
