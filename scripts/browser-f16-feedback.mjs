import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F16-04 real-Chrome acceptance at 390px: customer rates a completed
// appointment through the management link, a not-completed link gets no form,
// the salon page shows only published masked reviews, and the business
// publishes a consented review while a private one cannot be published.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f16-feedback-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = {
  user: 'f1640000-0000-4000-8000-000000000501', business: 'f1640000-0000-4000-8000-000000000502',
  membership: 'f1640000-0000-4000-8000-000000000503',
  consented: 'f1640000-0000-4000-8000-000000000511', privateOnly: 'f1640000-0000-4000-8000-000000000512',
};
const state = {
  requests: [],
  submitted: null,
  feedback: [
    { id: ids.consented, groupId: ids.business, customerName: 'Ayşe Nur Demir', displayName: 'Ayşe D.', rating: 5, comment: 'Çok memnun kaldım', publishConsent: true, status: 'pending', createdAt: '2026-09-24T10:00:00.000Z', publishedAt: null, moderatedAt: null, appointmentStartsAt: '2026-09-23T10:00:00.000Z', serviceNames: 'Kesim', canModerate: true },
    { id: ids.privateOnly, groupId: ids.business, customerName: 'Mehmet Kaya', displayName: 'Mehmet K.', rating: 2, comment: 'Beklemek zorunda kaldım', publishConsent: false, status: 'pending', createdAt: '2026-09-24T09:00:00.000Z', publishedAt: null, moderatedAt: null, appointmentStartsAt: '2026-09-22T10:00:00.000Z', serviceNames: 'Boya', canModerate: true },
  ],
};
let testJs;
let testCss;
const sockets = new Set();
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(testJs); return; }
    if (url.pathname === '/style.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(testCss); return; }
    if (url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
      return;
    }
    const body = request.method === 'GET' ? null : await bodyOf(request);
    state.requests.push({ method: request.method, path: url.pathname, search: url.search, body, csrf: request.headers['x-yzt-csrf'] ?? null });
    if (url.pathname === '/api/csrf') return sendJson(response, 200, { csrfToken: 'C'.repeat(43) });
    if (url.pathname === '/api/session') return sendJson(response, 200, {
      user: { id: ids.user, email: 'owner@example.test', fullName: 'Owner' },
      memberships: [{ id: ids.membership, business_id: ids.business, role: 'owner', active: true, businesses: { id: ids.business, name: 'Yorum Salon', slug: 'salon-a', timezone: 'Europe/Istanbul' } }],
      activeBusinessId: ids.business, passwordRecovery: false, csrfToken: 'C'.repeat(43),
    });
    if (url.pathname === '/api/manage/feedback/view') {
      if (body.token === 'O'.repeat(43)) return sendJson(response, 200, { feedback: { eligible: false, reason: 'not_completed', rating: null, comment: null, publishConsent: null, status: null, submittedAt: null } });
      return sendJson(response, 200, { feedback: state.submitted
        ? { eligible: false, reason: 'submitted', ...state.submitted }
        : { eligible: true, reason: null, rating: null, comment: null, publishConsent: null, status: null, submittedAt: null } });
    }
    if (url.pathname === '/api/manage/feedback') {
      assert.equal(body.token, 'D'.repeat(43));
      state.submitted = { rating: body.rating, comment: body.comment, publishConsent: body.publishConsent, status: 'pending', submittedAt: '2026-09-24T12:00:00.000Z' };
      return sendJson(response, 201, { feedback: { eligible: false, reason: 'submitted', ...state.submitted } });
    }
    if (url.pathname === '/api/public/business/salon-a/reviews') return sendJson(response, 200, {
      reviews: [
        { displayName: 'Ayşe D.', rating: 5, comment: 'Çok memnun kaldım', publishedAt: '2026-09-24T10:00:00.000Z' },
        { displayName: 'Can', rating: 4, comment: null, publishedAt: '2026-09-23T10:00:00.000Z' },
      ],
      summary: { count: 2, average: 4.5 },
    });
    if (url.pathname === '/api/public/business/salon-empty/reviews') return sendJson(response, 200, { reviews: [], summary: { count: 0, average: null } });
    if (url.pathname === '/api/feedback' && request.method === 'GET') {
      const status = url.searchParams.get('status');
      return sendJson(response, 200, { feedback: state.feedback.filter((item) => !status || item.status === status), next: null });
    }
    const moderate = url.pathname.match(/^\/api\/feedback\/([^/]+)\/moderate$/);
    if (moderate && request.method === 'POST') {
      const item = state.feedback.find((row) => row.id === moderate[1]);
      assert.equal(body.expectedStatus, item.status);
      if (body.action === 'publish' && !item.publishConsent) return sendJson(response, 409, { error: { code: 'FEEDBACK_CONSENT_MISSING', message: 'Müşteri bu yorumun yayınlanmasına izin vermedi.' } });
      item.status = body.action === 'publish' ? 'published' : 'hidden';
      return sendJson(response, 200, { feedback: { id: item.id, status: item.status } });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `fixture missing ${request.method} ${url.pathname}` } });
  } catch (error) {
    return sendJson(response, 500, { error: { message: error instanceof Error ? error.message : 'fixture error' } });
  }
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

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
  return page.evaluate(`window.__f1604[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 10_000);
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
      lib: { entry: path.join(root, 'tests/browser/f16-feedback.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js', assetFileNames: 'style.css' } },
    },
  });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  testCss = readFileSync(path.join(bundleDir, 'style.css'));
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
  await waitFor(() => page.evaluate('document.documentElement.dataset.f1604Ready === "true"'), 'F16-04 harness did not boot');

  // Not-completed appointment: explanation only, no form.
  await scopeContains(page, 'open', 'tamamlandıktan sonra');
  assert.deepEqual(await call(page, 'buttons', 'open'), []);

  // Completed appointment: rating is required, then rating + comment + consent submit once.
  await scopeContains(page, 'done', 'Deneyiminizi değerlendirin');
  assert.ok((await call(page, 'buttons', 'done')).includes('Değerlendirmeyi gönder'));
  assert.equal(await call(page, 'click', 'done', 'Değerlendirmeyi gönder'), false, 'submit enabled without a rating');
  assert.equal(await call(page, 'rate', 'done', 4), true);
  assert.equal(await call(page, 'setComment', 'done', '  Güler yüzlü ekip  '), true);
  assert.equal(await call(page, 'consent', 'done'), true);
  assert.equal(await call(page, 'click', 'done', 'Değerlendirmeyi gönder'), true);
  await scopeContains(page, 'done', 'Değerlendirmeniz işletmeye iletildi.');
  const submit = state.requests.find((item) => item.path === '/api/manage/feedback');
  assert.deepEqual(submit.body, { token: 'D'.repeat(43), rating: 4, comment: 'Güler yüzlü ekip', publishConsent: true });
  assert.equal(submit.csrf, null, 'capability feedback must not depend on a cookie CSRF session');
  assert.equal(state.requests.filter((item) => item.path === '/api/manage/feedback').length, 1);

  // Public salon reviews: average, masked names, empty state.
  await scopeContains(page, 'reviews', '4.5');
  await scopeContains(page, 'reviews', '2 yorum');
  await scopeContains(page, 'reviews', 'Ayşe D.');
  await scopeContains(page, 'empty-reviews', 'Henüz yayınlanmış yorum yok.');

  // Business list: consented review can be published, private one cannot.
  await scopeContains(page, 'business', 'Ayşe Nur Demir');
  await scopeContains(page, 'business', 'Müşteri yayın izni vermedi');
  assert.equal(await call(page, 'clickInItem', 'business', 'Mehmet Kaya', 'Yayınla'), false, 'private feedback exposed a publish action');
  assert.equal(await call(page, 'clickInItem', 'business', 'Ayşe Nur Demir', 'Yayınla'), true);
  await scopeContains(page, 'business', 'Yorum salon sayfasında yayınlandı.');
  await scopeContains(page, 'business', 'Yayında');
  const publish = state.requests.find((item) => item.path === `/api/feedback/${ids.consented}/moderate`);
  assert.deepEqual(publish.body, { action: 'publish', expectedStatus: 'pending' });
  assert.equal(publish.csrf, 'C'.repeat(43));
  assert.equal(await call(page, 'setStatus', 'published'), true);
  await waitFor(() => state.requests.some((item) => item.path === '/api/feedback' && item.search.includes('status=published')), 'status filter did not reach the API');
  await waitFor(async () => !(await call(page, 'text', 'business')).includes('Mehmet Kaya'), 'published filter kept private feedback');

  const layout = await call(page, 'layout');
  assert.ok(layout.overflow <= 1, `F16-04 surfaces overflow at 390px by ${layout.overflow}px`);
  assert.deepEqual(layout.shortTargets, [], 'F16-04 touch targets below 44px');
  console.log('F16-04 Chrome acceptance passed: 390px capability feedback (rating/consent), not-completed guard, masked public reviews and consent-bound business publishing.');
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
