import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scrubHook = readFileSync(
  resolve(repoRoot, 'src/marketing/transformation/useVideoScrollScrub.ts'),
  'utf8',
);

test('MKT-01 video control promotes preload without resetting the media element', () => {
  assert.match(scrubHook, /video\.preload = "auto"/);
  assert.doesNotMatch(scrubHook, /video\.load\s*\(/);
  assert.doesNotMatch(scrubHook, /video\.play\s*\(/);
});

test('MKT-01 video control resyncs bounded geometry after section, body, viewport and font changes', () => {
  assert.match(scrubHook, /let geometryFrame: number \| null = null/);
  assert.match(scrubHook, /if \(geometryFrame !== null \|\| disposed\)/);
  assert.match(scrubHook, /window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(scrubHook, /resizeObserver\.observe\(section\)/);
  assert.match(scrubHook, /resizeObserver\.observe\(document\.body\)/);
  assert.match(scrubHook, /document\.fonts\?\.ready\.then/);
  assert.match(scrubHook, /window\.addEventListener\("resize", scheduleGeometry/);
  assert.match(scrubHook, /window\.removeEventListener\("resize", scheduleGeometry\)/);
  assert.match(scrubHook, /resizeObserver\.disconnect\(\)/);
  assert.match(scrubHook, /window\.cancelAnimationFrame\(geometryFrame\)/);
});
