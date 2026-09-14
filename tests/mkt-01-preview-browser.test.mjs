import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findChrome() {
  const explicit = process.env.CHROME_BIN;
  if (explicit) return explicit;

  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }

  return null;
}

async function waitForServer(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Marketing preview dev server did not become ready at ${url}`);
}

function runChrome(chromeBin, args, { cwd, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    child.once('close', (code, signal) => {
      settle(() => resolve({ status: code, signal, stdout, stderr }));
    });
  });
}

test('MKT-01 standalone preview renders the approved reduced-motion homepage in real Chrome', { timeout: 30_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-browser-'));
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    plugins: [react()],
    appType: 'mpa',
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  });

  try {
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const url = `${origin}/marketing-preview.html?reduced=1&clean=1`;
    await waitForServer(url);

    const result = await runChrome(chromeBin, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--virtual-time-budget=3500',
      '--dump-dom',
      url,
    ], { cwd: repoRoot, timeoutMs: 15_000 });

    assert.equal(result.status, 0, result.stderr || `Chrome exited via ${result.signal ?? 'unknown signal'}`);
    const html = result.stdout;

    for (const expected of [
      'Randevu kolay.',
      'Müşteri kendi alsın.',
      'Kim boş, kim dolu? Bakınca belli.',
      'Karışıklık gider, düzen kalır.',
      'Bugün ne olmuş? Tek yerde.',
      'Kısa cevaplar.',
      'İşin sana kalsın.',
    ]) {
      assert.ok(html.includes(expected), `Rendered preview is missing: ${expected}`);
    }

    assert.match(html, /class="mkt-mobile-nav"/);
    assert.match(html, /id="nasil-calisiyor"/);
    assert.match(html, /id="donusum"/);
    assert.match(html, /id="yardim"/);
    assert.match(html, /id="kurulum"/);
    assert.doesNotMatch(html, /mkt-preview-diagnostics/);
  } finally {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
