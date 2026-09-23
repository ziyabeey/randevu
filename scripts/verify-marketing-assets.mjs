import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MKT-01 asset integrity. Hash contract lives in public/marketing/transformation/README.md.
// Production renderer is the WebP scroll sequence (frames + stills are required);
// the MP4 scrub arm is optional and only verified when a file is present.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(repoRoot, 'public/marketing/transformation/README.md');
const contract = readFileSync(contractPath, 'utf8');

const expected = new Map();
for (const match of contract.matchAll(/^([a-f0-9]{64})\s+([\w.-]+)$/gm)) {
  expected.set(match[2], match[1]);
}

const requiredStills = [
  'randevu-transformation-poster.webp',
  'randevu-transformation-final.webp',
  'randevu-hero-model.webp',
];
const optionalVideo = [
  'randevu-transformation-master.mp4',
  'randevu-transformation-mobile.mp4',
];
const FRAME_COUNT = 121;
const frameSequences = [
  { variant: 'desktop', maxTotalBytes: 6_553_600 }, // MKT-PERF-05 comparison target 6.25 MiB
  { variant: 'mobile', maxTotalBytes: 2_883_584 }, // MKT-PERF-05 comparison target 2.75 MiB
];

assert.equal(expected.size >= requiredStills.length, true, 'Marketing asset hash contract is incomplete.');

let failed = false;
const localPathFor = (filename) => filename === 'randevu-hero-model.webp'
  ? path.join(repoRoot, 'public/marketing/hero', filename)
  : path.join(repoRoot, 'public/marketing/transformation', filename);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

for (const filename of [...requiredStills, ...optionalVideo]) {
  const required = requiredStills.includes(filename);
  const expectedHash = expected.get(filename);
  const localPath = localPathFor(filename);
  const rel = path.relative(repoRoot, localPath);

  if (!existsSync(localPath)) {
    if (required) { failed = true; console.error(`MISSING  ${rel}`); }
    else console.log(`OPTIONAL ${rel} (video A/B arm not delivered)`);
    continue;
  }
  if (!expectedHash) { failed = true; console.error(`NOHASH   ${rel}: no SHA-256 in the contract`); continue; }
  const actualHash = sha256(localPath);
  if (actualHash !== expectedHash) {
    failed = true;
    console.error(`MISMATCH ${rel}`);
    console.error(`  expected ${expectedHash}`);
    console.error(`  actual   ${actualHash}`);
    continue;
  }
  console.log(`OK       ${rel}`);
}

for (const { variant, maxTotalBytes } of frameSequences) {
  const dir = path.join(repoRoot, 'public/marketing/transformation/frames', variant);
  const rel = path.relative(repoRoot, dir);
  if (!existsSync(dir)) { failed = true; console.error(`MISSING  ${rel}/`); continue; }
  const files = readdirSync(dir).filter((name) => /^frame-\d{3}\.webp$/.test(name)).sort();
  const expectedNames = Array.from({ length: FRAME_COUNT }, (_, index) => `frame-${String(index).padStart(3, '0')}.webp`);
  const missing = expectedNames.filter((name) => !files.includes(name));
  if (missing.length > 0) { failed = true; console.error(`MISSING  ${rel}: ${missing.length} frame(s), first ${missing[0]}`); continue; }
  let total = 0;
  let badMagic = 0;
  for (const name of expectedNames) {
    const file = path.join(dir, name);
    const head = readFileSync(file).subarray(0, 12);
    if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WEBP') badMagic += 1;
    total += statSync(file).size;
  }
  if (badMagic > 0) { failed = true; console.error(`INVALID  ${rel}: ${badMagic} file(s) are not WebP`); continue; }
  if (total > maxTotalBytes) { failed = true; console.error(`OVERSIZE ${rel}: ${total} B > ${maxTotalBytes} B`); continue; }
  console.log(`OK       ${rel}: ${FRAME_COUNT} WebP frames, ${(total / 1024 / 1024).toFixed(2)} MB (cap ${(maxTotalBytes / 1024 / 1024).toFixed(2)} MB)`);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Marketing asset integrity verified.');
}
