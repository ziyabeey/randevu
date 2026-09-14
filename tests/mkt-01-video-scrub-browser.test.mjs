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
    await sleep(80);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

function harnessHtmlPlugin() {
  return {
    name: 'mkt-scrub-harness-html',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/__mkt-scrub-harness.html') {
          next();
          return;
        }

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
      });
    },
  };
}

async function createHarnessServer() {
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    plugins: [harnessHtmlPlugin(), react()],
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

  const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about%3Ablank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5_000),
  });
  const target = await targetResponse.json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  return { chrome, page };
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

async function scrollToProgress(page, progress, expectedPhase) {
  await page.evaluate(`(() => {
    const section = document.querySelector('.mkt-transformation');
    if (!section) return false;
    const top = window.scrollY + section.getBoundingClientRect().top;
    const range = Math.max(1, section.offsetHeight - window.innerHeight);
    window.scrollTo(0, top + range * ${progress});
    return true;
  })()`);

  return waitFor(async () => {
    const state = await readScrubState(page);
    if (!state || state.phase !== expectedPhase || state.readyState < 1) return false;
    if (Math.abs(state.progress - progress) > 0.035) return false;
    if (Math.abs(state.currentTime - state.duration * progress) > 0.22) return false;
    return state;
  }, `Scrub did not settle at ${Math.round(progress * 100)}% / ${expectedPhase}`);
}

test('MKT-01 Chrome scrub maps real scroll to media time and story phases', { timeout: 35_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-video-scrub-'));
  const { server, origin } = await createHarnessServer();
  let chrome;
  let page;

  try {
    const url = `${origin}/__mkt-scrub-harness.html`;
    await waitFor(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    }, 'Scrub harness server did not become ready');

    ({ chrome, page } = await launchDebugChrome(chromeBin, work));
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 900,
    });
    await page.send('Page.navigate', { url });

    const initial = await waitFor(async () => {
      const state = await readScrubState(page);
      return state?.metadataReady ? state : false;
    }, 'Deterministic media harness did not initialize');

    assert.ok(Math.abs(initial.duration - 5.041667) < 0.0001);
    assert.equal(initial.readyState, 1);
    assert.equal(initial.paused, true, 'Scrub media must remain paused');
    assert.equal(initial.autoplay, false, 'Scrub media must never autoplay');

    const checkpoints = [
      [0.18, 'reminder'],
      [0.45, 'friction'],
      [0.72, 'sweep'],
      [0.92, 'pricing'],
    ];

    for (const [progress, phase] of checkpoints) {
      const state = await scrollToProgress(page, progress, phase);
      assert.equal(state.paused, true, `Media started playing at ${progress}`);
      assert.equal(state.autoplay, false, `Autoplay enabled at ${progress}`);
      assert.ok(state.phaseProgress >= 0 && state.phaseProgress <= 1, `Phase progress escaped bounds at ${progress}`);
    }

    const beforeShift = await scrollToProgress(page, 0.5, 'friction');
    await page.evaluate(`(() => {
      const spacer = document.querySelector('#mkt-scrub-spacer');
      if (!spacer) return false;
      spacer.style.height = '720px';
      return true;
    })()`);
    const afterShift = await scrollToProgress(page, 0.5, 'friction');
    assert.ok(Math.abs(beforeShift.currentTime - beforeShift.duration * 0.5) <= 0.22, 'Baseline midpoint scrub was not stable');
    assert.ok(Math.abs(afterShift.currentTime - afterShift.duration * 0.5) <= 0.22, 'Upstream layout shift left scrub geometry stale');

    const reverse = await scrollToProgress(page, 0.2, 'reminder');
    assert.ok(reverse.currentTime < reverse.duration * 0.3, 'Reverse scrub did not seek back toward the opening beat');
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
