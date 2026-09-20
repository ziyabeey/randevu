import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = path.join(root, 'dist/client');
const htmlPath = path.join(clientRoot, 'index.html');
const limitBytes = 120 * 1024;

if (!existsSync(htmlPath)) throw new Error('Public bundle budget requires a completed client build.');
const html = readFileSync(htmlPath, 'utf8');
const entrySource = html.match(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/)?.[1];
if (!entrySource) throw new Error('Client entry script was not found in dist/client/index.html.');

function resolveAsset(fromFile, specifier) {
  const relative = specifier.startsWith('/')
    ? specifier.slice(1)
    : path.join(path.dirname(path.relative(clientRoot, fromFile)), specifier);
  const resolved = path.resolve(clientRoot, relative);
  if (resolved !== clientRoot && !resolved.startsWith(`${clientRoot}${path.sep}`)) {
    throw new Error(`Bundle import escaped the client output: ${specifier}`);
  }
  return resolved;
}

const entryPath = resolveAsset(htmlPath, entrySource);
const entryText = readFileSync(entryPath, 'utf8');
const publicSpecifier = [...entryText.matchAll(/import\(\s*(["'`])(\.\/[^"'`]*PublicSalonPage[^"'`]*\.js)\1\s*\)/g)][0]?.[2];
if (!publicSpecifier) throw new Error('PublicSalonPage must remain a lazy route chunk.');
const publicPath = resolveAsset(entryPath, publicSpecifier);

const graph = new Set();
function visit(file) {
  if (graph.has(file)) return;
  if (!existsSync(file)) throw new Error(`Public bundle dependency is missing: ${path.relative(clientRoot, file)}`);
  graph.add(file);
  const source = readFileSync(file, 'utf8');
  const staticImports = [
    ...source.matchAll(/\bfrom\s*(["'`])(\.\/[^"'`]+\.js)\1/g),
    ...source.matchAll(/\bimport\s*(["'`])(\.\/[^"'`]+\.js)\1/g),
  ];
  for (const match of staticImports) visit(resolveAsset(file, match[2]));
}

visit(entryPath);
visit(publicPath);

const forbiddenEager = /(?:CalendarPage|CustomersPage|BookingPage|PublicBookingSettingsPage|TeamPage|OnboardingPage|AvailabilityPage|App)-/;
const forbidden = [...graph].map((file) => path.basename(file)).filter((name) => forbiddenEager.test(name));
if (forbidden.length) throw new Error(`Public route eagerly loads private/operator chunks: ${forbidden.join(', ')}`);

const receipt = [...graph]
  .map((file) => ({ file: path.relative(clientRoot, file).replaceAll('\\', '/'), gzipBytes: gzipSync(readFileSync(file), { level: 9 }).byteLength }))
  .sort((left, right) => left.file.localeCompare(right.file, 'en'));
const total = receipt.reduce((sum, item) => sum + item.gzipBytes, 0);
if (total > limitBytes) {
  throw new Error(`Public initial JavaScript is ${(total / 1024).toFixed(2)} kB gzip; limit is 120.00 kB. ${JSON.stringify(receipt)}`);
}

console.log(`Public bundle budget passed: ${(total / 1024).toFixed(2)} kB gzip / 120.00 kB. ${receipt.map((item) => `${item.file}=${(item.gzipBytes / 1024).toFixed(2)} kB`).join(', ')}`);
