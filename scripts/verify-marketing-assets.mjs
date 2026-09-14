import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(repoRoot, 'public/marketing/transformation/README.md');
const contract = readFileSync(contractPath, 'utf8');

const expected = new Map();
for (const match of contract.matchAll(/^([a-f0-9]{64})\s+([\w.-]+)$/gm)) {
  expected.set(match[2], match[1]);
}

const required = [
  'randevu-transformation-master.mp4',
  'randevu-transformation-mobile.mp4',
  'randevu-transformation-poster.webp',
  'randevu-transformation-final.webp',
  'randevu-hero-model.webp',
];

assert.equal(expected.size >= required.length, true, 'Marketing asset hash contract is incomplete.');

let failed = false;
for (const filename of required) {
  const expectedHash = expected.get(filename);
  assert.ok(expectedHash, `Missing expected SHA-256 for ${filename}`);

  const localPath = filename === 'randevu-hero-model.webp'
    ? path.join(repoRoot, 'public/marketing/hero', filename)
    : path.join(repoRoot, 'public/marketing/transformation', filename);

  if (!existsSync(localPath)) {
    failed = true;
    console.error(`MISSING  ${path.relative(repoRoot, localPath)}`);
    continue;
  }

  const actualHash = createHash('sha256').update(readFileSync(localPath)).digest('hex');
  if (actualHash !== expectedHash) {
    failed = true;
    console.error(`MISMATCH ${path.relative(repoRoot, localPath)}`);
    console.error(`  expected ${expectedHash}`);
    console.error(`  actual   ${actualHash}`);
    continue;
  }

  console.log(`OK       ${path.relative(repoRoot, localPath)}`);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Marketing asset integrity verified.');
}
