import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import {
  KOLAY_APP_TABS,
  adjacentKolayAppTab,
  isKolayAppTab,
} from '../src/kolayapp/model.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(root, 'src/kolayapp/kolayapp.css'), 'utf8');
const shellSource = readFileSync(path.join(root, 'src/kolayapp/KolayAppShell.tsx'), 'utf8');
const navSource = readFileSync(path.join(root, 'src/kolayapp/KolayBottomNav.tsx'), 'utf8');
const previewSource = readFileSync(path.join(root, 'src/kolayapp/KolayAppSpikePreview.tsx'), 'utf8');

await test('KOLAY-SPIKE-01 fixes the canonical five-tab order and keyboard adjacency', () => {
  assert.deepEqual(KOLAY_APP_TABS.map((tab) => tab.label), [
    'Randevular',
    'Adisyonlar',
    'Yeni',
    'Müşteriler',
    'Diğer',
  ]);
  assert.equal(adjacentKolayAppTab('appointments', -1), 'more');
  assert.equal(adjacentKolayAppTab('more', 1), 'appointments');
  assert.equal(adjacentKolayAppTab('tickets', 1), 'new');
  assert.equal(isKolayAppTab('customers'), true);
  assert.equal(isKolayAppTab('/app/customers'), false);
});

await test('KOLAY-SPIKE-01 shell remains route, auth and API agnostic', () => {
  const combined = `${shellSource}\n${navSource}\n${previewSource}`;
  assert.doesNotMatch(combined, /window\.location|\/api\/|\bfetch\s*\(|localStorage|sessionStorage/);
  assert.match(shellSource, /activeTab: KolayAppTab/);
  assert.match(shellSource, /onTabChange: \(tab: KolayAppTab\) => void/);
  assert.match(shellSource, /business\?: KolayBusinessSummary \| null/);
  assert.match(navSource, /aria-current=/);
  assert.match(navSource, /ArrowRight/);
  assert.match(navSource, /ArrowLeft/);
});

await test('KOLAY-SPIKE-01 mobile CSS protects touch, safe-area and keyboard-resized viewport contracts', () => {
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /min-height:\s*56px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width:\s*390px\)/);
  assert.match(css, /@media \(max-width:\s*360px\)/);
  assert.match(css, /@media \(max-height:\s*520px\)/);
});

await test('KOLAY-SPIKE-01 renders the real shell without pretending unavailable domains are complete', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'kolayapp-render-'));
  try {
    await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: 'silent',
      ssr: { noExternal: true },
      build: {
        ssr: path.join(root, 'tests/browser/kolayapp-shell-render.tsx'),
        outDir: work,
        emptyOutDir: true,
        minify: false,
        rollupOptions: { output: { entryFileNames: 'render.mjs' } },
      },
    });
    const module = await import(`${pathToFileURL(path.join(work, 'render.mjs')).href}?v=${Date.now()}`);
    const markup = String(module.markup ?? '');
    for (const label of ['Randevular', 'Adisyonlar', 'Yeni', 'Müşteriler', 'Diğer']) {
      assert.match(markup, new RegExp(`>${label}<`));
    }
    assert.match(markup, /KolayApp mobil çalışma alanı/);
    assert.match(markup, /Randevu verisi bağlı değil/);
    assert.match(markup, /API bağlı değil/);
    assert.doesNotMatch(markup, /₺|TL|ödendi|tahsil edildi/i);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
