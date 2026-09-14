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
    await sleep(70);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

function createFrameStats() {
  return {
    requests: 0,
    active: 0,
    maxActive: 0,
    failFrames: false,
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

function harnessPlugin(frameStats) {
  return {
    name: 'mkt-renderer-browser-harness',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        if (pathname === '/__mkt-scrub-harness.html') {
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
    <script type="module" src="/tests/fixtures/mkt-scrub-harness.jsx"></script>
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
        frameStats.requests += 1;
        frameStats.byVariant[variant] += 1;

        if (frameStats.failFrames) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('frame unavailable');
          return;
        }

        frameStats.active += 1;
        frameStats.maxActive = Math.max(frameStats.maxActive, frameStats.active);
        setTimeout(() => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Content-Length', String(FRAME_BYTES.length));
          res.end(FRAME_BYTES);
          frameStats.active -= 1;
        }, 18);
      });
    },
  };
}

async function createHarnessServer(frameStats) {
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    plugins: [harnessPlugin(frameStats), react()],
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

async function setViewport(page, viewport) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
}

async function isolatePage(page, frameStats, message) {
  await page.send('Page.navigate', { url: 'about:blank' });
  await waitFor(() => page.evaluate('location.href === "about:blank"'), `${message}: blank navigation did not settle`);
  await waitFor(() => frameStats.active === 0, `${message}: previous frame requests did not settle`);
  await sleep(80);
  resetFrameStats(frameStats);
}

async function navigatePreview(page, url, viewport) {
  await setViewport(page, viewport);
  await page.send('Page.navigate', { url });
  await waitFor(
    () => page.evaluate('document.readyState === "complete" && Boolean(document.querySelector("#mkt-main"))'),
    `Marketing preview did not render at ${viewport.width}px`,
  );
}

async function readScrubState(page) {
  return page.evaluate(`(() => {
    const section = document.querySelector('.mkt-transformation');
    const video = document.querySelector('video.mkt-transformation-video');
    if (!section || !video) return null;
    return {
      phase: section.dataset.phase ?? null,
      metadataReady: section.dataset.metadataReady === 'true',
      progress: Number(section.style.getPropertyValue('--mkt-progress')),
      phaseProgress: Number(section.style.getPropertyValue('--mkt-phase-progress')),
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      autoplay: video.autoplay,
      readyState: video.readyState,
    };
  })()`);
}

async function readFrameState(page) {
  return page.evaluate(`(() => {
    const section = document.querySelector('.mkt-transformation');
    const canvas = document.querySelector('.mkt-transformation-frame-canvas');
    if (!section || !canvas) return null;
    return {
      phase: section.dataset.phase ?? null,
      frameIndex: Number(section.dataset.frameIndex),
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

async function scrollSectionToProgress(page, progress) {
  await page.evaluate(`(() => {
    const section = document.querySelector('.mkt-transformation');
    if (!section) return false;
    const top = window.scrollY + section.getBoundingClientRect().top;
    const range = Math.max(1, section.offsetHeight - window.innerHeight);
    window.scrollTo(0, top + range * ${progress});
    return true;
  })()`);
}

async function scrollVideoToProgress(page, progress, expectedPhase) {
  await scrollSectionToProgress(page, progress);
  return waitFor(async () => {
    const state = await readScrubState(page);
    if (!state || state.phase !== expectedPhase || state.readyState < 1) return false;
    if (Math.abs(state.progress - progress) > 0.035) return false;
    if (Math.abs(state.currentTime - state.duration * progress) > 0.22) return false;
    return state;
  }, `Video scrub did not settle at ${Math.round(progress * 100)}% / ${expectedPhase}`);
}

async function scrollFramesToProgress(page, progress, expectedPhase) {
  await scrollSectionToProgress(page, progress);
  const expectedIndex = Math.round(progress * 120);
  return waitFor(async () => {
    const state = await readFrameState(page);
    if (!state || state.failureCount !== 0 || state.phase !== expectedPhase) return false;
    if (state.canvasWidth <= 0 || state.canvasHeight <= 0) return false;
    if (Math.abs(state.frameIndex - expectedIndex) > 1) return false;
    return state;
  }, `Frame scrub did not settle at ${Math.round(progress * 100)}% / ${expectedPhase}`);
}

test('MKT-01 Chrome video control and frame renderer preserve scroll parity and bounded media behavior', { timeout: 60_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const frameStats = createFrameStats();
  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-renderers-'));
  const { server, origin } = await createHarnessServer(frameStats);
  let chrome;
  let page;

  try {
    const videoUrl = `${origin}/__mkt-scrub-harness.html`;
    await waitFor(async () => {
      const response = await fetch(videoUrl, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    }, 'Renderer harness server did not become ready');

    ({ chrome, page } = await launchDebugChrome(chromeBin, work));
    await setViewport(page, { width: 1440, height: 900, mobile: false });
    await page.send('Page.navigate', { url: videoUrl });

    const initial = await waitFor(async () => {
      const state = await readScrubState(page);
      return state?.metadataReady ? state : false;
    }, 'Deterministic video harness did not initialize');
    assert.ok(Math.abs(initial.duration - 5.041667) < 0.0001);
    assert.equal(initial.paused, true);
    assert.equal(initial.autoplay, false);

    const checkpoints = [
      [0.18, 'reminder'],
      [0.45, 'friction'],
      [0.72, 'sweep'],
      [0.92, 'pricing'],
    ];

    for (const [progress, phase] of checkpoints) {
      const state = await scrollVideoToProgress(page, progress, phase);
      assert.equal(state.paused, true, `Video started playing at ${progress}`);
      assert.ok(state.phaseProgress >= 0 && state.phaseProgress <= 1);
    }

    const beforeShift = await scrollVideoToProgress(page, 0.5, 'friction');
    await page.evaluate(`(() => {
      const spacer = document.querySelector('#mkt-scrub-spacer');
      if (!spacer) return false;
      spacer.style.height = '720px';
      return true;
    })()`);
    const afterShift = await scrollVideoToProgress(page, 0.5, 'friction');
    assert.ok(Math.abs(beforeShift.currentTime - beforeShift.duration * 0.5) <= 0.22);
    assert.ok(Math.abs(afterShift.currentTime - afterShift.duration * 0.5) <= 0.22, 'Upstream layout shift left video scrub geometry stale');
    const videoReverse = await scrollVideoToProgress(page, 0.2, 'reminder');
    assert.ok(videoReverse.currentTime < videoReverse.duration * 0.3);

    await isolatePage(page, frameStats, 'desktop frame isolation');
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    frameStats.failFrames = false;
    const framePreview = `${origin}/marketing-preview.html?renderer=frames&clean=1`;
    await navigatePreview(page, `${framePreview}&run=desktop`, { width: 1440, height: 900, mobile: false });
    for (const [progress, phase] of checkpoints) await scrollFramesToProgress(page, progress, phase);
    await scrollSectionToProgress(page, 0.1);
    await scrollSectionToProgress(page, 0.92);
    const desktopReverse = await scrollFramesToProgress(page, 0.2, 'reminder');
    assert.ok(desktopReverse.requestCount > 0);
    assert.ok(desktopReverse.compressedBytes > 0);
    assert.ok(desktopReverse.cachePeak > 0 && desktopReverse.cachePeak <= 8, `Decoded cache escaped bound: ${desktopReverse.cachePeak}`);
    assert.ok(desktopReverse.firstDrawMs >= 0);
    assert.ok(desktopReverse.staleCount >= 0 && desktopReverse.staleCount <= desktopReverse.requestCount);
    assert.ok(desktopReverse.scrollWidth <= desktopReverse.clientWidth + 1);
    assert.ok(frameStats.maxActive <= 4, `Desktop frame concurrency escaped bound: ${frameStats.maxActive}`);
    assert.ok(frameStats.byVariant.desktop > 0);

    await isolatePage(page, frameStats, 'mobile frame isolation');
    await navigatePreview(page, `${framePreview}&run=mobile`, { width: 390, height: 844, mobile: true });
    const mobile = await scrollFramesToProgress(page, 0.45, 'friction');
    assert.equal(mobile.failureCount, 0);
    assert.ok(frameStats.byVariant.mobile > 0);
    assert.equal(frameStats.byVariant.desktop, 0, 'Mobile renderer fetched desktop frame bytes');
    assert.ok(frameStats.maxActive <= 4, `Mobile frame concurrency escaped bound: ${frameStats.maxActive}`);

    await isolatePage(page, frameStats, 'reduced-motion isolation');
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await navigatePreview(page, `${framePreview}&run=reduced`, { width: 390, height: 844, mobile: true });
    await waitFor(
      () => page.evaluate('Boolean(document.querySelector(".mkt-transformation-fallback"))'),
      'Reduced-motion frame preview did not render static fallback',
    );
    assert.equal(
      await page.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),
      true,
      'Browser reduced-motion preference was not active',
    );
    await sleep(250);
    assert.equal(frameStats.requests, 0, 'Reduced-motion frame renderer must fetch zero sequence frames');

    await isolatePage(page, frameStats, 'frame failure isolation');
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Network.clearBrowserCache');
    frameStats.failFrames = true;
    await navigatePreview(page, `${framePreview}&run=failure`, { width: 1440, height: 900, mobile: false });
    await scrollSectionToProgress(page, 0.2);
    const fallback = await waitFor(() => page.evaluate(`(() => {
      const fallback = document.querySelector('.mkt-transformation-fallback');
      if (!fallback) return null;
      return {
        text: fallback.textContent ?? '',
        canvas: Boolean(document.querySelector('.mkt-transformation-frame-canvas')),
        video: Boolean(document.querySelector('video.mkt-transformation-video')),
      };
    })()`), 'Failed frame request did not degrade to static fallback');
    assert.ok(frameStats.requests > 0);
    assert.equal(fallback.canvas, false);
    assert.equal(fallback.video, false);
    assert.match(fallback.text, /Karışıklık gider, düzen kalır\./);
    frameStats.failFrames = false;
    await page.send('Network.setCacheDisabled', { cacheDisabled: false });
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
