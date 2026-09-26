import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definitions = [
  { surface: 'public_booking', route: '/r/:slug', selected: ['src/PublicSalonPage.tsx'] },
  { surface: 'workspace_shell', route: '/app/* (before authenticated outlet)', selected: ['src/WorkspaceShell.tsx'] },
  { surface: 'workspace_calendar', route: '/app/calendar', selected: ['src/WorkspaceShell.tsx', 'src/CalendarPage.tsx'] },
  { surface: 'salonapp', route: '/app/mobile', selected: ['src/WorkspaceShell.tsx', 'src/kolayapp/KolayAppSurface.tsx'] },
];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sorted = (values) => [...values].sort();
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// These are build-graph measurements, not browser/network or semantic module-coverage claims.
export function measureRouteBundles({ clientRoot, revision = null }) {
  const root = realpathSync(clientRoot);
  function bytesFor(file) {
    if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':')
        || file.startsWith('/') || file.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('F17 bundle receipt: invalid output-relative asset path');
    }
    const absolute = realpathSync(path.join(root, file));
    if (!absolute.startsWith(`${root}${path.sep}`) || !statSync(absolute).isFile()) {
      throw new Error('F17 bundle receipt: asset is outside client output or is not a file');
    }
    return readFileSync(absolute);
  }
  const rawManifest = bytesFor('.vite/manifest.json');
  const manifest = JSON.parse(rawManifest.toString('utf8'));
  if (!isRecord(manifest)) throw new Error('F17 bundle receipt: invalid manifest');
  const get = (key) => {
    if (!Object.hasOwn(manifest, key) || !isRecord(manifest[key]) || typeof manifest[key].file !== 'string') {
      throw new Error(`F17 bundle receipt: missing/invalid manifest entry ${key}`);
    }
    return manifest[key];
  };
  function links(chunk, field) {
    const value = chunk[field];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
      throw new Error(`F17 bundle receipt: invalid ${field}`);
    }
    return value;
  }
  function closure(seeds, includeDynamic = false) {
    const seen = new Set();
    const queue = [...seeds];
    while (queue.length) {
      const key = queue.pop();
      if (seen.has(key)) continue;
      const chunk = get(key);
      seen.add(key);
      queue.push(...links(chunk, 'imports'));
      if (includeDynamic) queue.push(...links(chunk, 'dynamicImports'));
    }
    return seen;
  }
  const entry = get('index.html');
  if (entry.isEntry !== true) throw new Error('F17 bundle receipt: index.html must be a build entry');
  const html = bytesFor('index.html');
  const htmlEntry = html.toString('utf8').match(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/)?.[1];
  if (htmlEntry?.replace(/^\.\//, '').replace(/^\//, '') !== entry.file) {
    throw new Error('F17 bundle receipt: HTML and manifest entry do not match');
  }
  const reachable = closure(['index.html'], true);
  const assets = new Map();
  function asset(file, kind) {
    if (assets.has(file)) {
      if (assets.get(file).kind !== kind) throw new Error('F17 bundle receipt: inconsistent asset kind');
      return assets.get(file);
    }
    if (!file.endsWith(kind === 'js' ? '.js' : '.css')) throw new Error('F17 bundle receipt: unexpected asset extension');
    const bytes = bytesFor(file);
    const result = { file, kind, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: digest(bytes) };
    assets.set(file, result);
    return result;
  }
  const surfaces = definitions.map(({ surface, route, selected }) => {
    for (const key of selected) {
      if (get(key).isDynamicEntry !== true || !reachable.has(key)) {
        throw new Error(`F17 bundle receipt: selected route is not a reachable lazy entry ${key}`);
      }
    }
    const keys = closure(['index.html', ...selected]);
    const files = new Map();
    for (const key of keys) {
      const chunk = get(key);
      const kind = chunk.file.endsWith('.css') ? 'css' : 'js';
      files.set(chunk.file, asset(chunk.file, kind));
      for (const css of links(chunk, 'css')) files.set(css, asset(css, 'css'));
    }
    const sum = (kind, field) => [...files.values()].filter((item) => item.kind === kind).reduce((total, item) => total + item[field], 0);
    return {
      surface, route, selectedEntries: selected, manifestKeys: sorted(keys), files: sorted(files.keys()),
      jsBytes: sum('js', 'bytes'), jsGzipBytes: sum('js', 'gzipBytes'),
      cssBytes: sum('css', 'bytes'), cssGzipBytes: sum('css', 'gzipBytes'),
      manifestMarketingKeys: sorted([...keys].filter((key) => /(^|\/)marketing\//i.test(key))),
    };
  });
  const orderedAssets = sorted(assets.keys()).map((key) => assets.get(key));
  return {
    schema: 'f17-route-bundle-v1',
    measurement: 'selected_lazy_entries_plus_static_import_closure',
    checkoutSha: typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision) ? revision : null,
    manifestSha256: digest(rawManifest), htmlSha256: digest(html),
    assetsSha256: digest(JSON.stringify(orderedAssets)),
    compression: 'sum_of_individual_gzip_level_9_files',
    browserRequestsObserved: false,
    surfaces, assets: orderedAssets,
    sharedCssFiles: orderedAssets.filter((item) => item.kind === 'css' && surfaces.every((s) => s.files.includes(item.file))).map((item) => item.file),
    marketing: {
      status: 'NOT_MEASURED',
      reason: 'root_cutover_and_marketing_entry_require_MKT_01_acceptance',
      manifestKeys: sorted(Object.keys(manifest).filter((key) => /(^|\/)marketing\//i.test(key) || key === 'marketing-preview.html')),
    },
    limitations: [
      'No runtime conditional imports, lazy child interactions, alternate locales or observed network timing.',
      'Only JavaScript and declared CSS are counted; font/image/video/API payloads are not included.',
      'Manifest keys do not reveal every source module co-located inside a chunk; marketing isolation is not proven.',
      'Shared CSS is reported, not considered isolated. No new latency or workspace/CSS budget is invented.',
    ],
  };
}

export function emitRouteBundleReceipt({ clientRoot = path.join(projectRoot, 'dist/client'), revision, log = console.log } = {}) {
  if (revision === undefined) {
    try {
      revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
    } catch { revision = null; }
  }
  const report = measureRouteBundles({ clientRoot, revision });
  for (const item of report.surfaces) {
    log(`F17_ROUTE_BUNDLE surface=${item.surface} js_gzip_bytes=${item.jsGzipBytes} css_gzip_bytes=${item.cssGzipBytes} files=${item.files.length}`);
  }
  log(`F17_ROUTE_BUNDLE_RECEIPT ${JSON.stringify(report)}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) emitRouteBundleReceipt();
