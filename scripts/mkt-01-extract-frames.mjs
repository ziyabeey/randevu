#!/usr/bin/env node
// MKT-01 — WebP scroll-sequence extraction from the Kling clean source.
//
// No ffmpeg required: headless Chrome decodes the H.264 source, a canvas
// exports each frame as WebP. Deterministic timeline: frame i is sampled at
// (i + 0.5) / 24 s over 121 frames (5.041667 s), the same timeline the
// runtime uses (src/marketing/transformation/timeline.ts, frameSequence.ts).
//
//   node scripts/mkt-01-extract-frames.mjs --src /path/to/kling-clean-source.mov
//
// Writes public/marketing/transformation/frames/{desktop,mobile}/frame-NNN.webp,
// public/marketing/hero/randevu-hero-model.webp and the poster/final stills,
// then prints per-variant byte totals for the MKT-PERF-05 comparison targets.
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean));
if (!args.src) {
  console.error('usage: node scripts/mkt-01-extract-frames.mjs --src <kling clean source .mov/.mp4> [--out <dir>]');
  process.exit(2);
}
const SRC = path.resolve(args.src);
const OUT = path.resolve(args.out ?? path.join(repoRoot, 'public/marketing'));

export const FRAME_COUNT = 121;
export const FRAME_FPS = 24;
export const FRAME_VARIANTS = [
  { name: 'desktop', width: 1928, quality: 0.8 },
  { name: 'mobile', width: 960, quality: 0.8 },
];
export const STILLS = [
  { name: 'hero/randevu-hero-model.webp', time: 0.08, width: 1928, quality: 0.88 },
  { name: 'transformation/randevu-transformation-poster.webp', time: 0, width: 1928, quality: 0.86 },
  // randevu-transformation-final.webp is the product-owner supplied seated-model scene, not a master frame.
];

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (spawnSync('test', ['-x', mac]).status === 0) return mac;
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('sh', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromeBin = findChrome();
if (!chromeBin) { console.error('Chrome/Chromium not found (set CHROME_BIN).'); process.exit(2); }

const work = mkdtempSync(path.join(tmpdir(), 'mkt-01-frames-'));
const media = path.join(work, `source${path.extname(SRC)}`);
copyFileSync(SRC, media);
const html = path.join(work, 'index.html');
writeFileSync(html, `<!doctype html><html><body style="margin:0;background:#000"><video id="v" src="file://${media}" preload="auto" muted playsinline></video><canvas id="c"></canvas></body></html>`);

const chrome = spawn(chromeBin, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run',
  '--disable-gpu', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--window-size=1200,800', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let err = '';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (chunk) => { err += chunk; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15_000);
});
const port = new URL(wsUrl).port;
await sleep(300);
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
await send('Page.enable');
await send('Page.navigate', { url: `file://${html}` });
await sleep(500);

const meta = await evaluate(`new Promise((resolve, reject) => {
  const v = document.getElementById('v');
  const done = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
  if (v.readyState >= 1) done(); else { v.addEventListener('loadedmetadata', done, { once: true }); v.addEventListener('error', () => reject(new Error('video error')), { once: true }); }
  setTimeout(() => reject(new Error('metadata timeout')), 20000);
})`);
console.log('source', meta);
if (!meta.width) throw new Error('Chrome could not decode the source.');

async function grab(time, width, quality) {
  return evaluate(`new Promise((resolve, reject) => {
    const v = document.getElementById('v'); const c = document.getElementById('c');
    const t = Math.min(Math.max(0, ${time}), Math.max(0, v.duration - 0.0005));
    const finish = () => {
      const scale = ${width} / v.videoWidth; c.width = ${width}; c.height = Math.round(v.videoHeight * scale);
      const ctx = c.getContext('2d', { alpha: false }); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        if (!blob) return reject(new Error('toBlob failed'));
        const reader = new FileReader();
        reader.onload = () => resolve({ b64: reader.result.split(',')[1], w: c.width, h: c.height, size: blob.size, type: blob.type });
        reader.readAsDataURL(blob);
      }, 'image/webp', ${quality});
    };
    if (Math.abs(v.currentTime - t) < 0.0001 && v.readyState >= 2) { requestAnimationFrame(finish); return; }
    v.addEventListener('seeked', () => requestAnimationFrame(finish), { once: true });
    v.currentTime = t;
    setTimeout(() => reject(new Error('seek timeout at ' + t)), 15000);
  })`);
}

const report = { source: path.basename(SRC), meta, variants: {}, stills: {} };
for (const variant of FRAME_VARIANTS) {
  const dir = path.join(OUT, 'transformation/frames', variant.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let total = 0;
  for (let index = 0; index < FRAME_COUNT; index++) {
    const frame = await grab((index + 0.5) / FRAME_FPS, variant.width, variant.quality);
    if (frame.type !== 'image/webp') throw new Error(`Chrome returned ${frame.type} instead of image/webp`);
    writeFileSync(path.join(dir, `frame-${String(index).padStart(3, '0')}.webp`), Buffer.from(frame.b64, 'base64'));
    total += frame.size;
  }
  report.variants[variant.name] = { count: FRAME_COUNT, width: variant.width, quality: variant.quality, totalBytes: total, avgBytes: Math.round(total / FRAME_COUNT) };
  console.log(`${variant.name}: ${FRAME_COUNT} frames, ${(total / 1024 / 1024).toFixed(2)} MB, avg ${Math.round(total / FRAME_COUNT / 1024)} KB`);
}
for (const still of STILLS) {
  const frame = await grab(still.time, still.width, still.quality);
  const file = path.join(OUT, still.name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(frame.b64, 'base64'));
  report.stills[still.name] = { time: still.time, width: frame.w, height: frame.h, bytes: frame.size };
  console.log(`still ${still.name} @${still.time}s ${frame.w}x${frame.h} ${frame.size} B`);
}
console.log(JSON.stringify(report));
ws.close();
chrome.kill('SIGKILL');
rmSync(work, { recursive: true, force: true });
