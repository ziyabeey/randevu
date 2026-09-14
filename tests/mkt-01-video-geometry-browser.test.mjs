import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

function geometryHarnessHtmlPlugin() {
  return {
    name: 'mkt-geometry-shift-harness-html',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/__mkt-geometry-shift-harness.html') {
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
    <script type="module" src="/tests/fixtures/mkt-geometry-shift-harness.jsx"></script>
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
    plugins: [geometryHarnessHtmlPlugin(), react()],
    appType: 'mpa',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === 'object');
  return { server, origin: `http://127.0.0.1:${address.port}` };
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
      settle(() => reject(new Error(`Chrome geometry acceptance timed out.${stderr ? `\n${stderr.slice(-4_000)}` : ''}`)));
    }, timeoutMs);

    child.once('error', (error) => settle(() => reject(error)));
    child.once('close', (code, signal) => settle(() => resolve({ status: code, signal, stdout, stderr })));
  });
}

test('MKT-01 Chrome scrub recomputes section geometry after layout shifts above the section', { timeout: 30_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const { server, origin } = await createHarnessServer();
  try {
    const url = `${origin}/__mkt-geometry-shift-harness.html`;
    await waitFor(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    }, 'Geometry harness server did not become ready');

    const result = await runChrome(chromeBin, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--virtual-time-budget=5000', '--dump-dom', url,
    ]);

    assert.equal(result.status, 0, result.stderr || `Chrome exited via ${result.signal ?? 'unknown signal'}`);
    const marker = result.stdout.match(/<output[^>]*id="mkt-geometry-result"[^>]*data-status="([^"]+)"[^>]*data-detail="([^"]*)"/);
    assert.ok(marker, 'Geometry harness did not render a result marker');
    assert.equal(marker[1], 'pass', `Geometry shift regression failed: ${marker[2]}`);
  } finally {
    await server.close();
  }
});
