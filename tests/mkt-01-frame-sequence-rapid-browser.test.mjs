import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

async function waitFor(read, message, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(message);
}

function createStats() {
  return {
    requests: 0,
    active: 0,
    maxActive: 0,
    byVariant: { desktop: 0, mobile: 0 },
  };
}

function resetStats(stats) {
  stats.requests = 0;
  stats.active = 0;
  stats.maxActive = 0;
  stats.byVariant.desktop = 0;
  stats.byVariant.mobile = 0;
}

function rapidHarnessPlugin(stats) {
  return {
    name: 'mkt-frame-burst-harness',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        if (pathname === '/__mkt-frame-burst-harness.html') {
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
  <script type="module" src="/tests/fixtures/mkt-frame-burst-harness.jsx"></script>
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
        }, 24);
      });
    },
  };
}

async function createHarnessServer(stats) {
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    plugins: [rapidHarnessPlugin(stats), react()],
    appType: 'mpa',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === 'object');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function runChrome(chromeBin, url, width, height, timeoutMs = 18_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBin, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=9000', '--dump-dom', url,
    ], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Rapid frame Chrome acceptance timed out.${stderr ? `\n${stderr.slice(-3000)}` : ''}`));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

function readReceipt(html) {
  const tag = html.match(/<output[^>]*id="mkt-frame-burst-result"[^>]*>/)?.[0];
  assert.ok(tag, 'Rapid frame harness did not render its receipt');
  const attr = (name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
  return {
    status: attr('data-status'),
    variant: attr('data-variant'),
    frameIndex: Number(attr('data-frame-index')),
    phase: attr('data-phase'),
    cachePeak: Number(attr('data-cache-peak')),
    staleCount: Number(attr('data-stale-count')),
    failureCount: Number(attr('data-failure-count')),
    requestCount: Number(attr('data-request-count')),
    compressedBytes: Number(attr('data-compressed-bytes')),
    firstDrawMs: Number(attr('data-first-draw-ms')),
    clientWidth: Number(attr('data-client-width')),
    scrollWidth: Number(attr('data-scroll-width')),
  };
}

function assertRapidReceipt(receipt, expectedVariant, stats) {
  assert.equal(receipt.status, 'pass', `Rapid frame scrub did not settle: ${JSON.stringify(receipt)}`);
  assert.equal(receipt.variant, expectedVariant);
  assert.ok(Math.abs(receipt.frameIndex - 24) <= 1, `Rapid scrub ended on frame ${receipt.frameIndex}, expected ~24`);
  assert.equal(receipt.phase, 'reminder');
  assert.equal(receipt.failureCount, 0);
  assert.ok(receipt.requestCount > 0);
  assert.ok(receipt.compressedBytes > 0);
  assert.ok(receipt.cachePeak > 0 && receipt.cachePeak <= 8, `Rapid cache escaped bound: ${receipt.cachePeak}`);
  assert.ok(receipt.staleCount >= 0 && receipt.staleCount <= receipt.requestCount, `Invalid stale frame count: ${receipt.staleCount}/${receipt.requestCount}`);
  assert.ok(receipt.firstDrawMs >= 0);
  assert.ok(receipt.scrollWidth <= receipt.clientWidth + 1, `Rapid renderer overflow: ${receipt.scrollWidth} > ${receipt.clientWidth}`);
  assert.ok(stats.maxActive <= 4, `Rapid fetch concurrency escaped bound: ${stats.maxActive}`);
  assert.ok(stats.byVariant[expectedVariant] > 0, `Rapid renderer did not request ${expectedVariant} frames`);
}

test('MKT-01 rapid forward/reverse frame scrubbing settles without stale-frame failure', { timeout: 45_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const stats = createStats();
  const { server, origin } = await createHarnessServer(stats);

  try {
    const baseUrl = `${origin}/__mkt-frame-burst-harness.html`;
    await waitFor(async () => {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    }, 'Rapid frame harness server did not become ready');

    const desktopRun = await runChrome(chromeBin, baseUrl, 1440, 900);
    assert.equal(desktopRun.status, 0, desktopRun.stderr || `Chrome exited via ${desktopRun.signal ?? 'unknown signal'}`);
    const desktop = readReceipt(desktopRun.stdout);
    assertRapidReceipt(desktop, 'desktop', stats);
    console.log(`MKT frame burst desktop: ${JSON.stringify({ ...desktop, maxActive: stats.maxActive })}`);

    await waitFor(() => stats.active === 0, 'Desktop rapid frame requests did not settle');
    resetStats(stats);

    const mobileRun = await runChrome(chromeBin, `${baseUrl}?mobile=1`, 390, 844);
    assert.equal(mobileRun.status, 0, mobileRun.stderr || `Chrome exited via ${mobileRun.signal ?? 'unknown signal'}`);
    const mobile = readReceipt(mobileRun.stdout);
    assertRapidReceipt(mobile, 'mobile', stats);
    assert.equal(stats.byVariant.desktop, 0, 'Rapid mobile renderer fetched desktop frames');
    console.log(`MKT frame burst mobile: ${JSON.stringify({ ...mobile, maxActive: stats.maxActive })}`);
  } finally {
    await server.close();
  }
});
