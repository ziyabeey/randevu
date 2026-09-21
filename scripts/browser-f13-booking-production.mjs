import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f1303-production-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const servedAssets = new Set();
const sockets = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let chrome;
let chromeFd;
let server;

const USER = 'f3000000-0000-4000-8000-000000000001';
const BUSINESS = 'f3010000-0000-4000-8000-000000000001';
const MEMBERSHIP = 'f3020000-0000-4000-8000-000000000001';
const SERVICE = 'f3030000-0000-4000-8000-000000000001';
const STAFF = 'f3040000-0000-4000-8000-000000000001';
const CSRF = 'F'.repeat(43);

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function findChrome() {
  for (const candidate of [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome executable not found');
}

async function waitFor(read, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
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
      sleep(5_000).then(() => { throw new Error('CDP WebSocket timeout'); }),
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
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params?.exceptionDetails;
          this.diagnostics.push(String(details?.exception?.description ?? details?.text ?? 'browser exception').slice(0, 2000));
        }
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
  send(method, params = {}, timeoutMs = 8_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

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
      lib: { entry: path.join(root, 'src/main.tsx'), formats: ['es'] },
      rollupOptions: {
        output: { entryFileNames: 'app.js', chunkFileNames: '[name]-[hash].js' },
      },
    },
  });

  const bundleRoot = path.resolve(bundleDir);
  const appJs = readFileSync(path.join(bundleDir, 'app.js'));
  const cssFile = readdirSync(bundleDir).find((name) => name.endsWith('.css'));
  assert.ok(cssFile, 'production main build did not emit CSS');
  const appCss = readFileSync(path.join(bundleDir, cssFile));

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/app.js') {
      servedAssets.add('/app.js');
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(appJs);
      return;
    }
    if (url.pathname === '/app.css') {
      servedAssets.add('/app.css');
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(appCss);
      return;
    }
    if (!url.pathname.startsWith('/api/') && path.extname(url.pathname)) {
      let relative;
      try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
      catch {
        response.writeHead(400); response.end('bad asset'); return;
      }
      const assetPath = path.resolve(bundleRoot, relative);
      if (!assetPath.startsWith(`${bundleRoot}${path.sep}`) || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
        response.writeHead(404); response.end('asset not found'); return;
      }
      servedAssets.add(url.pathname);
      response.writeHead(200, { 'Content-Type': contentType(assetPath), 'Cache-Control': 'no-store' });
      response.end(readFileSync(assetPath));
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/session') {
      return sendJson(response, 200, {
        user: { id: USER, email: 'f13-prod@example.test', fullName: 'F13 Prod' },
        memberships: [{
          id: MEMBERSHIP, business_id: BUSINESS, role: 'owner', active: true,
          businesses: { id: BUSINESS, name: 'F13 Production Salon', slug: 'f13-prod', timezone: 'Europe/Istanbul' },
        }],
        activeBusinessId: BUSINESS,
        passwordRecovery: false,
        csrfToken: CSRF,
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog') {
      return sendJson(response, 200, {
        membership: { id: MEMBERSHIP, business_id: BUSINESS, role: 'owner', active: true },
        services: [{
          id: SERVICE, name: 'Kesim', duration_minutes: 30, buffer_before_minutes: 0,
          buffer_after_minutes: 0, price_minor: 10000, currency: 'TRY', active: true,
          price_type: 'fixed', price_min_minor: 10000, price_max_minor: 10000, price_policy_version: 1,
        }],
        staff: [{ id: STAFF, name: 'Ada', active: true }],
        assignments: [{ staff_id: STAFF, service_id: SERVICE, active: true }],
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/availability/setup') {
      return sendJson(response, 200, { timezone: 'Europe/Istanbul' });
    }
    if (request.method === 'GET' && url.pathname === '/api/bookings/groups') {
      return sendJson(response, 200, {
        membership: { id: MEMBERSHIP, business_id: BUSINESS, role: 'owner', active: true },
        bookings: [],
        page: { limit: 25, hasMore: false, nextCursor: null },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/csrf') {
      return sendJson(response, 200, { csrfToken: CSRF });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: `unmapped production fixture: ${url.pathname}` } });
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const chromeBin = findChrome();
  const profileDir = path.join(work, 'profile');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: ['ignore', chromeFd, chromeFd] });

  const activePort = path.join(profileDir, 'DevToolsActivePort');
  const port = await waitFor(() => {
    try { return readFileSync(activePort, 'utf8').split(/\r?\n/)[0] || false; }
    catch { return false; }
  }, 'F13-03 production Chrome did not expose a debugging port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`, { method: 'PUT' })).json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: `${origin}/bookings` });

  await waitFor(
    () => page.evaluate('location.pathname === "/bookings" && document.body.innerText.includes("RANDEVU YÖNETİMİ") && document.body.innerText.includes("YENİ RANDEVU")'),
    'production /bookings lazy route did not render BookingPage',
  );

  assert.ok(
    [...servedAssets].some((name) => /\/BookingPage-[^/]+\.js$/.test(name)),
    `production /bookings did not request BookingPage lazy chunk: ${JSON.stringify([...servedAssets])}`,
  );
  assert.equal(await page.evaluate("document.querySelector('a[aria-current=\"page\"]')?.textContent"), 'Randevular');
  assert.deepEqual(page.diagnostics, []);
  page.close();

  console.log('F13-03 production-entry browser passed: src/main.tsx /bookings route requested BookingPage lazy chunk and rendered workspace UI.');
} catch (error) {
  let diagnostics = '';
  try { diagnostics = `\nChrome log:\n${readFileSync(chromeLog, 'utf8').slice(-4000)}`; } catch { /* noop */ }
  throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostics}`);
} finally {
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(1000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  if (chromeFd !== undefined) closeSync(chromeFd);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { rmSync(work, { recursive: true, force: true }); break; }
    catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 5) throw error;
      await sleep(100 * (attempt + 1));
    }
  }
}
