import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { measureRouteBundles, emitRouteBundleReceipt } from '../scripts/f17-route-bundle-receipt.mjs';

const sha = 'a'.repeat(40);
const hash = (s) => createHash('sha256').update(s).digest('hex');
function fixture(t, change = () => {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'f17-bundle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'client');
  mkdirSync(path.join(root, '.vite'), { recursive: true });
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  const manifest = {
    'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_shared.js'], css: ['assets/common.css'], dynamicImports: ['src/PublicSalonPage.tsx', 'src/WorkspaceShell.tsx'] },
    '_shared.js': { file: 'assets/shared.js' },
    'src/PublicSalonPage.tsx': { file: 'assets/public.js', isDynamicEntry: true, imports: ['_shared.js'], css: ['assets/public.css'], dynamicImports: ['src/later.tsx'] },
    'src/later.tsx': { file: 'assets/later.js', isDynamicEntry: true },
    'src/WorkspaceShell.tsx': { file: 'assets/workspace.js', isDynamicEntry: true, imports: ['_shared.js'], css: ['assets/common.css'], dynamicImports: ['src/CalendarPage.tsx', 'src/kolayapp/KolayAppSurface.tsx'] },
    'src/CalendarPage.tsx': { file: 'assets/calendar.js', isDynamicEntry: true, imports: ['_shared.js'], css: ['assets/calendar.css'] },
    'src/kolayapp/KolayAppSurface.tsx': { file: 'assets/mobile.js', isDynamicEntry: true, imports: ['_shared.js'] },
  };
  const contents = {};
  for (const chunk of Object.values(manifest)) {
    for (const file of [chunk.file, ...(chunk.css ?? [])]) {
      contents[file] = file.endsWith('.css') ? `/* ${file} */ .x { display: block; }` : `/* ${file} */ export const value = 1;`;
      writeFileSync(path.join(root, file), contents[file]);
    }
  }
  change(manifest, root, dir);
  writeFileSync(path.join(root, '.vite/manifest.json'), JSON.stringify(manifest));
  writeFileSync(path.join(root, 'index.html'), '<script type="module" src="/assets/index.js"></script>');
  return { root, dir, manifest, contents, run: () => measureRouteBundles({ clientRoot: root, revision: sha }) };
}

test('F17 counts selected route JS/CSS, excludes unselected dynamic children and deduplicates shared dependencies', (t) => {
  const { run, contents } = fixture(t);
  const report = run();
  const [publicPage, shell, calendar, mobile] = report.surfaces;
  assert.deepEqual(publicPage.files, ['assets/common.css', 'assets/index.js', 'assets/public.css', 'assets/public.js', 'assets/shared.js']);
  assert.equal(publicPage.jsBytes, ['assets/index.js', 'assets/public.js', 'assets/shared.js'].reduce((n, f) => n + Buffer.byteLength(contents[f]), 0));
  assert.equal(publicPage.cssGzipBytes, ['assets/common.css', 'assets/public.css'].reduce((n, f) => n + gzipSync(contents[f], { level: 9 }).length, 0));
  assert.ok(!publicPage.files.includes('assets/workspace.js'));
  assert.ok(!shell.files.includes('assets/calendar.js'));
  assert.ok(calendar.files.includes('assets/workspace.js') && calendar.files.includes('assets/calendar.js'));
  assert.ok(mobile.files.includes('assets/mobile.js'));
  assert.ok(!report.assets.some((a) => a.file === 'assets/later.js'));
  assert.deepEqual(report.sharedCssFiles, ['assets/common.css']);
  assert.equal(report.checkoutSha, sha);
  assert.equal(report.browserRequestsObserved, false);
  assert.equal(report.marketing.status, 'NOT_MEASURED');
  assert.equal(report.assets.find((a) => a.file === 'assets/public.js').sha256, hash(contents['assets/public.js']));
  assert.deepEqual(run(), report);
});

test('F17 traverses static re-export dependencies and cycles without double counting', (t) => {
  const { run } = fixture(t, (m) => {
    m['_shared.js'].imports = ['_alias.js'];
    m['_alias.js'] = { file: 'assets/shared.js', imports: ['_shared.js'], css: ['assets/common.css'] };
  });
  const report = run();
  assert.equal(report.surfaces[0].files.filter((f) => f === 'assets/shared.js').length, 1);
  assert.equal(report.surfaces[0].files.filter((f) => f === 'assets/common.css').length, 1);
});

test('F17 digests change when a built byte changes, without inventing a checkout identity', (t) => {
  const f = fixture(t);
  const before = f.run();
  writeFileSync(path.join(f.root, 'assets/public.js'), 'export const changed = 2;');
  const after = measureRouteBundles({ clientRoot: f.root, revision: 'unverified' });
  assert.notEqual(after.assetsSha256, before.assetsSha256);
  assert.equal(after.manifestSha256, before.manifestSha256);
  assert.equal(after.checkoutSha, null);
});

for (const [name, change, expected] of [
  ['missing selected route', (m) => { delete m['src/CalendarPage.tsx']; }, /missing\/invalid/],
  ['non-lazy route', (m) => { m['src/PublicSalonPage.tsx'].isDynamicEntry = false; }, /reachable lazy/],
  ['orphan route', (m) => { m['index.html'].dynamicImports = ['src/WorkspaceShell.tsx']; }, /reachable lazy/],
  ['missing dependency', (m) => { m['_shared.js'].imports = ['missing.js']; }, /missing\/invalid/],
  ['bad import list', (m) => { m['_shared.js'].imports = 'x'; }, /invalid imports/],
  ['bad CSS list', (m) => { m['_shared.js'].css = [42]; }, /invalid css/],
  ['not an entry', (m) => { m['index.html'].isEntry = false; }, /must be a build entry/],
  ['missing built file', (m, root) => { rmSync(path.join(root, 'assets/calendar.js')); }, /ENOENT/],
  ['missing built CSS', (m, root) => { rmSync(path.join(root, 'assets/common.css')); }, /ENOENT/],
  ['outside path', (m) => { m['_shared.js'].file = '../outside.js'; }, /invalid output-relative/],
  ['wrong extension', (m) => { m['_shared.js'].file = 'assets/data.json'; }, /unexpected asset extension/],
]) {
  test(`F17 fails closed for ${name} and emits no partial success receipt`, (t) => {
    const { root } = fixture(t, change);
    const logs = [];
    assert.throws(() => emitRouteBundleReceipt({ clientRoot: root, revision: sha, log: (s) => logs.push(s) }), expected);
    assert.deepEqual(logs, []);
  });
}

test('F17 rejects an asset symlink escaping build output', (t) => {
  const { run } = fixture(t, (m, root, dir) => {
    writeFileSync(path.join(dir, 'outside.js'), 'outside');
    rmSync(path.join(root, 'assets/shared.js'));
    symlinkSync(path.join(dir, 'outside.js'), path.join(root, 'assets/shared.js'));
  });
  assert.throws(run, /outside client output/);
});

test('F17 rejects a stale manifest that disagrees with the HTML entry', (t) => {
  const { root, run } = fixture(t);
  writeFileSync(path.join(root, 'index.html'), '<script src="/assets/different.js"></script>');
  assert.throws(run, /HTML and manifest entry/);
});

test('F17 does not claim a marketing route was measured just because a marketing chunk exists', (t) => {
  const { run } = fixture(t, (m, root) => {
    m['src/marketing/Home.tsx'] = { file: 'assets/marketing.js', isDynamicEntry: true };
    m['src/PublicSalonPage.tsx'].imports.push('src/marketing/Home.tsx');
    writeFileSync(path.join(root, 'assets/marketing.js'), 'export const marketing = true;');
  });
  const report = run();
  assert.equal(report.marketing.status, 'NOT_MEASURED');
  assert.deepEqual(report.surfaces[0].manifestMarketingKeys, ['src/marketing/Home.tsx']);
  assert.ok(report.surfaces[0].files.includes('assets/marketing.js'));
});

test('F17 CLI emitter prints all numeric surfaces and a replayable full receipt', (t) => {
  const { root } = fixture(t);
  const logs = [];
  const report = emitRouteBundleReceipt({ clientRoot: root, revision: sha, log: (s) => logs.push(s) });
  assert.equal(logs.length, 5);
  assert.match(logs[0], /^F17_ROUTE_BUNDLE surface=public_booking js_gzip_bytes=\d+ css_gzip_bytes=\d+ files=\d+$/);
  assert.deepEqual(JSON.parse(logs[4].slice('F17_ROUTE_BUNDLE_RECEIPT '.length)), report);
});

for (const mode of ['pass', 'oversize', 'private_eager']) {
  test(`F17 existing public-bundle entrypoint retains its ${mode} behavior`, (t) => {
    const f = fixture(t, (m, root) => {
      m['src/PublicSalonPage.tsx'].file = 'assets/PublicSalonPage-test.js';
      writeFileSync(path.join(root, 'assets/PublicSalonPage-test.js'), 'export const publicPage = true;');
      writeFileSync(path.join(root, 'assets/index.js'), 'import("./PublicSalonPage-test.js");');
      if (mode === 'oversize') writeFileSync(path.join(root, 'assets/PublicSalonPage-test.js'), randomBytes(200000).toString('base64'));
      if (mode === 'private_eager') {
        writeFileSync(path.join(root, 'assets/PublicSalonPage-test.js'), 'import "./CalendarPage-test.js";');
        writeFileSync(path.join(root, 'assets/CalendarPage-test.js'), 'export const privatePage = true;');
      }
    });
    const scriptDir = path.join(f.dir, 'scripts');
    mkdirSync(scriptDir);
    mkdirSync(path.join(f.dir, 'dist'));
    symlinkSync(f.root, path.join(f.dir, 'dist/client'));
    for (const name of ['check-public-bundle-budget.mjs', 'f17-route-bundle-receipt.mjs']) {
      copyFileSync(new URL(`../scripts/${name}`, import.meta.url), path.join(scriptDir, name));
    }
    const result = spawnSync(process.execPath, [path.join(scriptDir, 'check-public-bundle-budget.mjs')], {
      cwd: f.dir, encoding: 'utf8', timeout: 10000, env: { ...process.env, GITHUB_SHA: 'not-a-checkout' },
    });
    assert.ifError(result.error);
    if (mode === 'pass') {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Public bundle budget passed:/);
      assert.match(result.stdout, /F17_ROUTE_BUNDLE surface=salonapp/);
    } else {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, mode === 'oversize' ? /limit is 120.00 kB/ : /eagerly loads private/);
      assert.doesNotMatch(result.stdout, /F17_ROUTE_BUNDLE/);
    }
  });
}
