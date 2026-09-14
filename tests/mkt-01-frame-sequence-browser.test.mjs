import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FRAME_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZSPcAAAAASUVORK5CYII=',
  'base64',
);

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
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

function createFrameStats() {
  return {
    requests: 0,
    active: 0,
    maxActive: 0,
    byVariant: { desktop: 0, mobile: 0 },
  };
}

function resetFrameStats(stats) {
  stats.requests = 0;
  stats.active = 0;
  stats.maxActive = 0;
  stats.byVariant.desktop = 0;
  stats.byVariant.mobile = 0;
}

function frameHarnessPlugin(stats) {
  return {
    name: 'mkt-frame-sequence-harness',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        if (pathname === '/__mkt-frame-sequence-harness.html') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>html,body,#root{margin:0;min-height:100%;}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/tests/fixtures/mkt-frame-sequence-harness.jsx"></script>
  </body>
</html>`);
          return;
        }

        const match = pathname.match(/^\/marketing\/transformation\/frames\/(desktop|mobile)\/frame-\d{3}\.webp$/);
        if (!match) {
          next();
          return;
        }

        const variant = match[1];
        stats.requests += 1;
        stats.byVariant[variant] += 1;
        stats.active += 1;
        stats.maxActive = Math.max(stats.maxActive, stats.active);

        setTimeout(() => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Content-Length', String(FRAME_BYTES.length));
          res.end(FRAME_BYTES);
          stats.active -= 1;
        }, 18);
      });
    },
  };
}

async function createHarnessServer(stats) {
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    plugins: [frameHarnessPlugin(stats), react()],
    appType: 'mpa',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === 'object');
  return { server, origin: `http://127.0.0.1:${address.port}` };
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
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}, timeoutMs = 5_000) {
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

  async evaluate(expression, timeoutMs = 5_000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed');
    }
    return result.result.value;
  }

  close() { this.ws.close(); }
}

async function launchDebugChrome(chromeBin, work) {
  const profile = path.join(work, 'profile');
  const chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { cwd: repoRoot, stdio: 'ignore' });

  const activePortFile = path.join(profile, 'DevToolsActivePort');
  const port = await waitFor(() => {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode} during startup`);
    try {
      const value = readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0];
      return /^\d+$/.test(value) ? value : false;
    } catch {
      return false;
    }
  }, 'Chrome did not expose a debugging port');

  const response = await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5_000),
  });
  const target = await response.json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  return { chrome, page };
}

async function readFrameState(page) {
  return page.evaluate(`(() => {
    const section = document.querySelector('.mkt-transformation');
    const canvas = document.querySelector('.mkt-transformation-frame-canvas');
    if (!section || !canvas) return null;
    return {
      phase: section.dataset.phase ?? null,
      ready: section.dataset.frameReady === 'true',
      failed: section.dataset.frameFailed === 'true',
      variant: section.dataset.frameVariant ?? null,
      frameIndex: Number(section.dataset.frameIndex),
      progress: Number(section.style.getPropertyValue('--mkt-progress')),
      requestCount: Number(section.dataset.frameRequestCount || 0),
      compressedBytes: Number(section.dataset.frameCompressedBytes || 0),
      cachePeak: Number(section.dataset.frameCachePeak || 0),
      staleCount: Number(section.dataset.frameStaleCount || 0),
      failureCount: Number(section.dataset.frameFailureCount || 0),
      firstDrawMs: Number(section.dataset.frameFirstDrawMs || 0),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  })()`);
}

async function navigateHarness(page, url, viewport) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await page.send('Page.navigate', { url });
  await waitFor(
    () => page.evaluate('document.readyState === "complete" && Boolean(document.querySelector(".mkt-transformation"))'),
    `Frame harness did not render at ${viewport.width}px`,
  );
}

async function scrollToProgress(page, progress, expectedPhase) {
  await page.evaluate(`(() => {
    const section = document.querySelector('.mkt-transformation');
    if (!section) return false;
    const top = window.scrollY + section.getBoundingClientRect().top;
    const range = Math.max(1, section.offsetHeight - window.innerHeight);
    window.scrollTo(0, top + range * ${progress});
    return true;
  })()`);

  const expectedIndex = Math.round(progress * 120);
  return waitFor(async () => {
    const state = await readFrameState(page);
    if (!state || !state.ready || state.failed || state.phase !== expectedPhase) return false;
    if (Math.abs(state.frameIndex - expectedIndex) > 1) return false;
    return state;
  }, `Frame scrub did not settle at ${Math.round(progress * 100)}% / ${expectedPhase}`);
}

test('MKT-01 frame renderer maps scroll directly to bounded cached frames in real Chrome', { timeout: 45_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const stats = createFrameStats();
  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-frames-'));
  const { server, origin } = await createHarnessServer(stats);
  let chrome;
  let page;

  try {
    const url = `${origin}/__mkt-frame-sequence-harness.html`;
    await waitFor(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    }, 'Frame harness server did not become ready');

    ({ chrome, page } = await launchDebugChrome(chromeBin, work));
    await navigateHarness(page, url, { width: 1440, height: 900, mobile: false });
    await waitFor(async () => (await readFrameState(page))?.ready, 'Desktop frame renderer did not draw its opening frame');

    const checkpoints = [
      [0.18, 'reminder'],
      [0.45, 'friction'],
      [0.72, 'sweep'],
      [0.92, 'pricing'],
    ];

    for (const [progress, phase] of checkpoints) {
      await scrollToProgress(page, progress, phase);
    }
    const reverse = await scrollToProgress(page, 0.2, 'reminder');

    assert.equal(reverse.variant, 'desktop');
    assert.equal(reverse.failureCount, 0);
    assert.ok(reverse.requestCount > 0, 'Frame renderer did not request compressed frames');
    assert.ok(reverse.compressedBytes > 0, 'Frame renderer did not record compressed bytes');
    assert.ok(reverse.cachePeak > 0 && reverse.cachePeak <= 8, `Decoded cache escaped its 8-frame bound: ${reverse.cachePeak}`);
    assert.ok(reverse.firstDrawMs >= 0, 'Frame renderer did not record first draw latency');
    assert.ok(reverse.canvasWidth > 0 && reverse.canvasHeight > 0, 'Canvas never received a drawable backing store');
    assert.ok(reverse.scrollWidth <= reverse.clientWidth + 1, 'Frame renderer introduced horizontal overflow');
    assert.ok(stats.maxActive <= 4, `Frame fetch concurrency escaped the bound: ${stats.maxActive}`);
    assert.ok(stats.byVariant.desktop > 0, 'Desktop renderer did not use desktop frame URLs');

    await waitFor(() => stats.active === 0, 'Desktop frame requests did not settle');
    resetFrameStats(stats);
    await navigateHarness(page, `${url}?mobile=1`, { width: 390, height: 844, mobile: true });
    const mobile = await waitFor(async () => {
      const state = await readFrameState(page);
      return state?.ready && state.variant === 'mobile' ? state : false;
    }, 'Mobile frame renderer did not select the mobile sequence');
    assert.equal(mobile.failed, false);
    assert.ok(stats.byVariant.mobile > 0, 'Mobile renderer did not use mobile frame URLs');
    assert.equal(stats.byVariant.desktop, 0, 'Mobile renderer fetched desktop sequence bytes');
    assert.ok(stats.maxActive <= 4, `Mobile frame fetch concurrency escaped the bound: ${stats.maxActive}`);

    await waitFor(() => stats.active === 0, 'Mobile frame requests did not settle');
    resetFrameStats(stats);
    await navigateHarness(page, `${url}?reduced=1`, { width: 390, height: 844, mobile: true });
    await sleep(400);
    assert.equal(stats.requests, 0, 'Disabled/reduced-motion frame renderer must fetch zero sequence frames');
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
