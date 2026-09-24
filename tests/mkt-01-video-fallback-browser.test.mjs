import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { holdBrowserSlot } from './helpers/marketing-chrome.mjs';

holdBrowserSlot();

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

async function createPreviewServer() {
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    plugins: [react()],
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
  await page.send('Network.enable');
  return { chrome, page };
}

test('MKT-01 video request failure degrades to a usable static transformation story', { timeout: 35_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-video-fallback-'));
  const { server, origin } = await createPreviewServer();
  let chrome;
  let page;

  try {
    // The video arm is an explicit A/B override now that the WebP sequence is the production renderer.
    const url = `${origin}/marketing-preview.html?legacy=1&renderer=video&clean=1`;
    await waitFor(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    }, 'Marketing preview server did not become ready');

    ({ chrome, page } = await launchDebugChrome(chromeBin, work));
    await page.send('Network.setBlockedURLs', {
      urls: [
        '*randevu-transformation-master.mp4*',
        '*randevu-transformation-mobile.mp4*',
      ],
    });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 900,
    });
    await page.send('Page.navigate', { url });

    await waitFor(
      () => page.evaluate('document.readyState === "complete" && Boolean(document.querySelector("#mkt-main"))'),
      'Marketing preview did not render',
    );

    const initial = await page.evaluate(`(() => ({
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      video: Boolean(document.querySelector('video.mkt-transformation-video')),
      fallback: Boolean(document.querySelector('.mkt-transformation-fallback')),
    }))()`);
    assert.equal(initial.reduced, false, 'Failure acceptance must run in normal-motion mode');

    if (initial.video) {
      await page.evaluate(`(() => {
        const section = document.querySelector('#donusum');
        section?.scrollIntoView({ block: 'center' });
        const video = document.querySelector('video.mkt-transformation-video');
        video?.load();
      })()`);
    }

    await waitFor(
      () => page.evaluate('Boolean(document.querySelector(".mkt-transformation-fallback")) && !document.querySelector("video.mkt-transformation-video")'),
      'Blocked transformation video did not degrade to the static fallback',
    );

    const fallback = await page.evaluate(`(() => {
      const section = document.querySelector('.mkt-transformation-fallback');
      const root = document.documentElement;
      return {
        text: section?.textContent ?? '',
        id: section?.id ?? null,
        loginHref: document.querySelector('.mkt-nav-login')?.getAttribute('href') ?? null,
        mainPresent: Boolean(document.querySelector('#mkt-main')),
        overflow: root.scrollWidth > root.clientWidth + 1,
      };
    })()`);

    assert.equal(fallback.id, 'donusum');
    assert.match(fallback.text, /Karışıklık gider, düzen kalır\./);
    assert.match(fallback.text, /Fiyatı da kolay olsun\./);
    assert.equal(fallback.loginHref, '/app');
    assert.equal(fallback.mainPresent, true);
    assert.equal(fallback.overflow, false, 'Fallback introduced horizontal overflow');
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
