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

async function waitForServer(url) {
  await waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  }, `Marketing preview dev server did not become ready at ${url}`);
}

function runChrome(chromeBin, args, timeoutMs = 15_000) {
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

async function openDebugPage(debugUrl) {
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

async function pressKey(page, { key, code, keyCode, text }) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (text) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text, unmodifiedText: text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

const pressEnter = (page) => pressKey(page, { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
const pressSpace = (page) => pressKey(page, { key: ' ', code: 'Space', keyCode: 32, text: ' ' });
const pressTab = (page) => pressKey(page, { key: 'Tab', code: 'Tab', keyCode: 9 });

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

  const page = await openDebugPage(`http://127.0.0.1:${port}`);
  return { chrome, page };
}

async function renderReducedPreview(page, url, viewport) {
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await page.send('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await page.send('Page.navigate', { url });
  await waitFor(
    () => page.evaluate('document.readyState === "complete" && Boolean(document.querySelector("#mkt-main")) && Boolean(document.querySelector(".mkt-transformation-fallback"))'),
    `Marketing preview did not render at ${viewport.width}px`,
  );
}

test('MKT-01 standalone preview renders the approved reduced-motion homepage in real Chrome', { timeout: 30_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const { server, origin } = await createPreviewServer();
  try {
    const url = `${origin}/marketing-preview.html?reduced=1&clean=1`;
    await waitForServer(url);
    const result = await runChrome(chromeBin, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--virtual-time-budget=3500', '--dump-dom', url,
    ]);
    assert.equal(result.status, 0, result.stderr || `Chrome exited via ${result.signal ?? 'unknown signal'}`);

    const html = result.stdout;
    for (const expected of [
      'Randevu kolay.', 'Müşteri kendi alsın.', 'Kim boş, kim dolu? Bakınca belli.',
      'Karışıklık gider, düzen kalır.', 'Bugün ne olmuş? Tek yerde.',
      'Kısa cevaplar.', 'İşin sana kalsın.', 'Giriş yap',
    ]) {
      assert.ok(html.includes(expected), `Rendered preview is missing: ${expected}`);
    }
    assert.match(html, /href="\/app"/);
    assert.match(html, /class="mkt-mobile-nav"/);
    assert.match(html, /id="nasil-calisiyor"/);
    assert.match(html, /id="donusum"/);
    assert.match(html, /id="yardim"/);
    assert.match(html, /id="kurulum"/);
    assert.doesNotMatch(html, /<aside[^>]*class="[^"]*mkt-preview-diagnostics/);
  } finally {
    await server.close();
  }
});

test('MKT-01 mobile preview has no horizontal overflow and supports keyboard navigation at 360/390', { timeout: 45_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-mobile-'));
  const { server, origin } = await createPreviewServer();
  let chrome;
  let page;

  try {
    const url = `${origin}/marketing-preview.html?clean=1`;
    await waitForServer(url);
    ({ chrome, page } = await launchDebugChrome(chromeBin, work));

    for (const viewport of [
      { width: 360, height: 800, mobile: true },
      { width: 390, height: 844, mobile: true },
    ]) {
      await renderReducedPreview(page, url, viewport);

      const metrics = await page.evaluate(`(() => {
        const root = document.documentElement;
        const mobileNav = document.querySelector('.mkt-mobile-nav');
        const desktopLinks = document.querySelector('.mkt-nav-links');
        const summary = document.querySelector('.mkt-mobile-nav summary');
        const cta = document.querySelector('.mkt-nav-cta');
        return {
          innerWidth: window.innerWidth,
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          mobileNavDisplay: mobileNav ? getComputedStyle(mobileNav).display : null,
          desktopLinksDisplay: desktopLinks ? getComputedStyle(desktopLinks).display : null,
          summaryHeight: summary ? summary.getBoundingClientRect().height : 0,
          ctaHeight: cta ? cta.getBoundingClientRect().height : 0,
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          fallback: Boolean(document.querySelector('.mkt-transformation-fallback')),
          video: Boolean(document.querySelector('video.mkt-transformation-video')),
        };
      })()`);

      assert.equal(metrics.innerWidth, viewport.width, `Unexpected CSS viewport at ${viewport.width}px`);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `Horizontal overflow at ${viewport.width}px: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
      assert.ok(metrics.bodyScrollWidth <= metrics.clientWidth + 1, `Body overflow at ${viewport.width}px: ${metrics.bodyScrollWidth} > ${metrics.clientWidth}`);
      assert.notEqual(metrics.mobileNavDisplay, 'none', `Mobile menu is hidden at ${viewport.width}px`);
      assert.equal(metrics.desktopLinksDisplay, 'none', `Desktop links leak into ${viewport.width}px layout`);
      assert.ok(metrics.summaryHeight >= 44, `Mobile menu target is ${metrics.summaryHeight}px at ${viewport.width}px`);
      assert.ok(metrics.ctaHeight >= 44, `Mobile CTA target is ${metrics.ctaHeight}px at ${viewport.width}px`);
      assert.equal(metrics.reduced, true, 'Browser reduced-motion preference was not applied');
      assert.equal(metrics.fallback, true, 'Reduced-motion fallback did not render');
      assert.equal(metrics.video, false, 'Reduced-motion mode should not mount the scrub video');

      assert.equal(await page.evaluate(`(() => {
        const summary = document.querySelector('.mkt-mobile-nav summary');
        summary?.focus();
        return document.activeElement === summary;
      })()`), true, `Mobile menu summary could not receive focus at ${viewport.width}px`);

      await pressSpace(page);
      await waitFor(
        () => page.evaluate('document.querySelector(".mkt-mobile-nav")?.open === true'),
        `Keyboard Space did not open the mobile menu at ${viewport.width}px`,
      );

      const openMenu = await page.evaluate(`(() => {
        const links = [...document.querySelectorAll('.mkt-mobile-nav-panel a')];
        return {
          heights: links.map((link) => link.getBoundingClientRect().height),
          firstHref: links[0]?.getAttribute('href') ?? null,
          loginHref: links.at(-1)?.getAttribute('href') ?? null,
        };
      })()`);
      assert.ok(openMenu.heights.length >= 5, 'Mobile menu is missing expected links');
      assert.ok(openMenu.heights.every((height) => height >= 44), `A mobile menu target is below 44px at ${viewport.width}px`);
      assert.equal(openMenu.firstHref, '#nasil-calisiyor');
      assert.equal(openMenu.loginHref, '/app');

      assert.equal(await page.evaluate(`(() => {
        const link = document.querySelector('.mkt-mobile-nav-panel a[href="#nasil-calisiyor"]');
        link?.focus();
        return document.activeElement === link;
      })()`), true, `First mobile link could not receive focus at ${viewport.width}px`);

      await pressEnter(page);
      await waitFor(
        () => page.evaluate(`location.hash === '#nasil-calisiyor'
          && document.querySelector('.mkt-mobile-nav')?.open === false
          && document.activeElement === document.querySelector('.mkt-mobile-nav summary')`),
        `Keyboard navigation did not close the mobile menu and restore focus at ${viewport.width}px`,
      );
    }
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});

test('MKT-01 desktop preview preserves nav, layout, reduced motion, and skip-link keyboard flow at 1440px', { timeout: 35_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-desktop-'));
  const { server, origin } = await createPreviewServer();
  let chrome;
  let page;

  try {
    const url = `${origin}/marketing-preview.html?clean=1`;
    await waitForServer(url);
    ({ chrome, page } = await launchDebugChrome(chromeBin, work));
    await renderReducedPreview(page, url, { width: 1440, height: 900, mobile: false });

    const metrics = await page.evaluate(`(() => {
      const root = document.documentElement;
      const desktopLinks = document.querySelector('.mkt-nav-links');
      const mobileNav = document.querySelector('.mkt-mobile-nav');
      const login = document.querySelector('.mkt-nav-login');
      const cta = document.querySelector('.mkt-nav-cta');
      const skip = document.querySelector('.mkt-skip-link');
      return {
        innerWidth: window.innerWidth,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        desktopLinksDisplay: desktopLinks ? getComputedStyle(desktopLinks).display : null,
        mobileNavDisplay: mobileNav ? getComputedStyle(mobileNav).display : null,
        loginDisplay: login ? getComputedStyle(login).display : null,
        loginHref: login?.getAttribute('href') ?? null,
        ctaHeight: cta ? cta.getBoundingClientRect().height : 0,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        fallback: Boolean(document.querySelector('.mkt-transformation-fallback')),
        video: Boolean(document.querySelector('video.mkt-transformation-video')),
        skipBeforeTop: skip ? skip.getBoundingClientRect().top : null,
        initialFocusIsBody: document.activeElement === document.body,
      };
    })()`);

    assert.equal(metrics.innerWidth, 1440);
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `Desktop horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
    assert.ok(metrics.bodyScrollWidth <= metrics.clientWidth + 1, `Desktop body overflow: ${metrics.bodyScrollWidth} > ${metrics.clientWidth}`);
    assert.notEqual(metrics.desktopLinksDisplay, 'none', 'Desktop navigation links are hidden');
    assert.equal(metrics.mobileNavDisplay, 'none', 'Mobile menu leaks into desktop layout');
    assert.notEqual(metrics.loginDisplay, 'none', 'Desktop login link is hidden');
    assert.equal(metrics.loginHref, '/app');
    assert.ok(metrics.ctaHeight >= 44, `Desktop CTA target is ${metrics.ctaHeight}px`);
    assert.equal(metrics.reduced, true);
    assert.equal(metrics.fallback, true);
    assert.equal(metrics.video, false);
    assert.ok(metrics.skipBeforeTop < 0, `Skip link should begin offscreen, got top=${metrics.skipBeforeTop}`);
    assert.equal(metrics.initialFocusIsBody, true, 'Desktop preview did not start with body focus');

    await pressTab(page);
    await waitFor(
      () => page.evaluate(`(() => {
        const skip = document.querySelector('.mkt-skip-link');
        if (!skip || document.activeElement !== skip) return false;
        const rect = skip.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= 900;
      })()`),
      'Keyboard Tab did not focus and reveal the skip link',
    );

    await pressEnter(page);
    await waitFor(
      () => page.evaluate(`location.hash === '#mkt-main'
        && document.activeElement === document.querySelector('#mkt-main')`),
      'Skip link did not navigate and move focus to main content',
    );
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
