// Shared headless-Chrome helpers for the MKT-01 marketing browser tests:
// a Vite preview server, a CDP page, keyboard input and polling.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

export async function waitFor(read, message, timeoutMs = 10_000) {
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

// node --test runs files in parallel; several headless Chromes decoding the
// salon film at once starve each other past the CDP timeouts, and their Vite
// servers race over node_modules/.vite. Each browser test file holds this
// cross-process slot for its whole run instead.
const browserSlot = path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-chrome.lock');

function browserSlotAbandoned() {
  try {
    const owner = Number(readFileSync(path.join(browserSlot, 'pid'), 'utf8'));
    process.kill(owner, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    // No pid yet: the owner is between mkdir and write, or died there.
    if (error.code === 'ENOENT') {
      try {
        return Date.now() - statSync(browserSlot).mtimeMs > 10_000;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function acquireBrowserSlot() {
  for (;;) {
    try {
      mkdirSync(browserSlot);
      writeFileSync(path.join(browserSlot, 'pid'), String(process.pid));
      let held = true;
      const release = () => {
        if (!held) return;
        held = false;
        process.off('exit', release);
        rmSync(browserSlot, { recursive: true, force: true });
      };
      process.on('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (browserSlotAbandoned()) rmSync(browserSlot, { recursive: true, force: true });
      else await sleep(250);
    }
  }
}

export function holdBrowserSlot() {
  let release;
  before(async () => {
    release = await acquireBrowserSlot();
  }, { timeout: 600_000 });
  after(() => release?.());
}

export async function createPreviewServer() {
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

export async function waitForServer(url) {
  await waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  }, `Marketing preview dev server did not become ready at ${url}`);
}

export function runChrome(chromeBin, args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBin, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(() => reject(new Error(`Chrome preview acceptance timed out.${stderr ? `\n${stderr.slice(-4_000)}` : ''}`)));
    }, timeoutMs);

    child.once('error', (error) => settle(() => reject(error)));
    child.once('close', (code, signal) => settle(() => resolve({ status: code, signal, stdout, stderr })));
  });
}

export class Cdp {
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
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
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

export async function openDebugPage(debugUrl) {
  const response = await fetch(`${debugUrl}/json/new?about%3Ablank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5_000),
  });
  const target = await response.json();
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  return page;
}

export async function pressKey(page, { key, code, keyCode, text }) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (text) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text, unmodifiedText: text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

export const pressEnter = (page) => pressKey(page, { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
export const pressSpace = (page) => pressKey(page, { key: ' ', code: 'Space', keyCode: 32, text: ' ' });
export const pressTab = (page) => pressKey(page, { key: 'Tab', code: 'Tab', keyCode: 9 });

export async function launchDebugChrome(chromeBin, work) {
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

  const page = await openDebugPage(`http://127.0.0.1:${port}`);
  return { chrome, page };
}
