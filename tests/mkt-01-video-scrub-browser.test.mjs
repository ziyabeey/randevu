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
const fixturePath = path.join(repoRoot, 'tests/fixtures/mkt-scrub-fixture.mp4');
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

function mediaFixturePlugin() {
  const bytes = readFileSync(fixturePath);
  return {
    name: 'mkt-scrub-media-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        const isFixtureTarget = pathname.endsWith('/randevu-transformation-master.mp4')
          || pathname.endsWith('/randevu-transformation-mobile.mp4');
        if (!isFixtureTarget) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');
        const range = req.headers.range;
        const match = typeof range === 'string' ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;

        if (match) {
          const start = Number(match[1]);
          const requestedEnd = match[2] ? Number(match[2]) : bytes.length - 1;
          const end = Math.min(bytes.length - 1, requestedEnd);
          if (!Number.isFinite(start) || start < 0 || start > end) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${bytes.length}`);
            res.end();
            return;
          }
          const chunk = bytes.subarray(start, end + 1);
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
          res.setHeader('Content-Length', String(chunk.length));
          res.end(chunk);
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Length', String(bytes.length));
        res.end(bytes);
      });
    },
  };
}

async function createPreviewServer() {
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    plugins: [mediaFixturePlugin(), react()],
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

async function scrollToProgress(page, progress, expectedPhase) {
  await page.evaluate(`(() => {
    const section = document.querySelector('.mkt-transformation');
    if (!section) return false;
    const rect = section.getBoundingClientRect();
    const top = window.scrollY + rect.top;
    const range = Math.max(1, section.offsetHeight - window.innerHeight);
    window.scrollTo(0, top + range * ${progress});
    return true;
  })()`);

  return waitFor(async () => {
    const state = await page.evaluate(`(() => {
      const section = document.querySelector('.mkt-transformation');
      const video = document.querySelector('video.mkt-transformation-video');
      if (!section || !video) return null;
      return {
        phase: section.dataset.phase ?? null,
        progress: Number(section.style.getPropertyValue('--mkt-progress')),
        currentTime: video.currentTime,
        duration: video.duration,
        paused: video.paused,
        autoplay: video.autoplay,
        readyState: video.readyState,
      };
    })()`);
    if (!state || state.phase !== expectedPhase || state.readyState < 1) return false;
    if (Math.abs(state.progress - progress) > 0.035) return false;
    if (Math.abs(state.currentTime - state.duration * progress) > 0.22) return false;
    return state;
  }, `Scrub did not settle at ${Math.round(progress * 100)}% / ${expectedPhase}`);
}

test('MKT-01 normal-motion Chrome scrub maps scroll to real video time and story phases', { timeout: 40_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-video-scrub-'));
  const { server, origin } = await createPreviewServer();
  let chrome;
  let page;

  try {
    const url = `${origin}/marketing-preview.html?clean=1`;
    await waitFor(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    }, 'Marketing preview server did not become ready');

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

    const media = await waitFor(async () => {
      const state = await page.evaluate(`(() => {
        const video = document.querySelector('video.mkt-transformation-video');
        if (!video) return null;
        return {
          duration: video.duration,
          readyState: video.readyState,
          paused: video.paused,
          autoplay: video.autoplay,
          fallback: Boolean(document.querySelector('.mkt-transformation-fallback')),
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      })()`);
      return state && state.readyState >= 1 && Number.isFinite(state.duration) ? state : false;
    }, 'Chrome did not load scrub fixture metadata');

    assert.equal(media.reduced, false, 'Positive scrub acceptance must run in normal-motion mode');
    assert.equal(media.fallback, false, 'Fixture video unexpectedly fell back');
    assert.ok(Math.abs(media.duration - 5.041667) < 0.08, `Unexpected fixture duration ${media.duration}`);
    assert.equal(media.paused, true, 'Scrub video must remain paused');
    assert.equal(media.autoplay, false, 'Scrub video must never autoplay');

    const checkpoints = [
      [0.18, 'reminder'],
      [0.45, 'friction'],
      [0.72, 'sweep'],
      [0.92, 'pricing'],
    ];

    for (const [progress, phase] of checkpoints) {
      const state = await scrollToProgress(page, progress, phase);
      assert.equal(state.paused, true, `Video started playing at ${progress}`);
      assert.equal(state.autoplay, false, `Autoplay enabled at ${progress}`);
    }

    const reverse = await scrollToProgress(page, 0.2, 'reminder');
    assert.ok(reverse.currentTime < reverse.duration * 0.3, 'Reverse scrub did not seek back toward the opening beat');
    assert.equal(await page.evaluate('Boolean(document.querySelector(".mkt-transformation-fallback"))'), false);
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
