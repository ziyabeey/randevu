import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertPng(name, size) {
  const png = readFileSync(path.join(root, 'public', name));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
  let offset = 8;
  let sawIend = false;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const dataEnd = offset + 8 + length;
    assert.ok(dataEnd + 4 <= png.length, `${name} contains a truncated ${type} chunk`);
    const stored = png.readUInt32BE(dataEnd);
    const calculated = crc32(png.subarray(offset + 4, dataEnd));
    assert.equal(stored, calculated, `${name} has an invalid ${type} CRC`);
    offset = dataEnd + 4;
    if (type === 'IEND') {
      sawIend = true;
      break;
    }
  }
  assert.equal(sawIend, true, `${name} is missing IEND`);
}

function sourceFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(target));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) result.push(target);
  }
  return result;
}


test('F14-05 KolayApp icon binaries match their manifest sizes and have valid PNG CRCs', () => {
  assertPng('kolayapp-192.png', 192);
  assertPng('kolayapp-512.png', 512);
});

test('F14-05 KolayApp manifest is installable and private-app scoped', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Randevu Kolay — KolayApp');
  assert.equal(manifest.short_name, 'KolayApp');
  assert.equal(manifest.id, '/app/mobile');
  assert.equal(manifest.start_url, '/app/mobile');
  assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);
  assert.equal(manifest.theme_color, '#2456e8');
  const icons = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));
  assert.equal(icons.get('192x192')?.type, 'image/png');
  assert.equal(icons.get('512x512')?.type, 'image/png');
  assert.match(icons.get('512x512')?.purpose ?? '', /maskable/);
});

test('F14-05 advertises the manifest without adding an offline financial runtime', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/kolayapp-192\.png"/);

  const appSource = sourceFiles(path.join(root, 'src'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.doesNotMatch(appSource, /navigator\.serviceWorker\.register\s*\(/);
  assert.doesNotMatch(appSource, /caches\.open\s*\(/);
  assert.doesNotMatch(appSource, /\.sync\.register\s*\(/);

  const publicFiles = readdirSync(path.join(root, 'public'));
  assert.equal(publicFiles.some((name) => /(?:service-worker|sw)\.(?:js|mjs)$/i.test(name)), false);

  const worker = readFileSync(path.join(root, 'worker/index.ts'), 'utf8');
  assert.match(worker, /context\.header\('Cache-Control', 'no-store'\)/);
});
