import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
const loader = read('src/marketing/transformation/frameSequence.ts');
const hook = read('src/marketing/transformation/useFrameSequenceScrollScrub.ts');
const section = read('src/marketing/transformation/TransformationSection.tsx');
const previewModes = read('src/marketing/previewModes.ts');
const previewEntry = read('src/marketing/preview-entry.tsx');
const frameSequence = await import('../src/marketing/transformation/frameSequence.ts');

test('MKT-01 frame sequence keeps the 121-frame timeline with bounded fetch and decoded cache', () => {
  assert.match(loader, /TRANSFORMATION_FRAME_COUNT = 121/);
  assert.match(loader, /TRANSFORMATION_FRAME_CACHE_SIZE = 8/);
  assert.match(loader, /TRANSFORMATION_FRAME_FETCH_CONCURRENCY = 4/);
  assert.match(loader, /createImageBitmap\(blob\)/);
  assert.match(loader, /bitmap\.close\(\)/);
  assert.match(loader, /new Image\(\)/);
  assert.match(loader, /cache: "force-cache"/);
  assert.match(loader, /frames\/desktop/);
  assert.match(loader, /frames\/mobile/);
});

test('MKT-01 frame sequence maps normalized scroll directly to frame index and fails closed', () => {
  assert.match(loader, /Math\.round\(clamp01\(progress\) \* \(TRANSFORMATION_FRAME_COUNT - 1\)\)/);
  assert.match(hook, /new TransformationFrameLoader\(variant\)/);
  assert.match(hook, /getTransformationFrameIndex\(getProgress\(\)\)/);
  assert.match(hook, /rootMargin: "75% 0px 75% 0px"/);
  assert.match(hook, /resizeObserver\.observe\(document\.body\)/);
  assert.match(hook, /document\.fonts\?\.ready\.then/);
  assert.match(hook, /if \(!section \|\| !canvas \|\| disabled\) return undefined/);
  assert.match(hook, /setFailed\(true\)/);
  assert.match(hook, /frameCompressedBytes/);
  assert.match(hook, /frameCachePeak/);
  assert.match(hook, /frameStaleCount/);
  assert.match(hook, /frameFirstDrawMs/);
});

test('MKT-01 frame canvas preserves the same horizontal crop focus as the video control', () => {
  const { getTransformationFrameFocusX, getTransformationFrameIndex } = frameSequence;
  assert.equal(getTransformationFrameFocusX(getTransformationFrameIndex(0.18), 'mobile', 390), 0.70);
  assert.equal(getTransformationFrameFocusX(getTransformationFrameIndex(0.45), 'mobile', 390), 0.63);
  assert.equal(getTransformationFrameFocusX(getTransformationFrameIndex(0.72), 'mobile', 390), 0.56);
  assert.equal(getTransformationFrameFocusX(getTransformationFrameIndex(0.92), 'mobile', 390), 0.67);
  assert.equal(getTransformationFrameFocusX(getTransformationFrameIndex(0.45), 'desktop', 820), 0.62);
  assert.equal(getTransformationFrameFocusX(getTransformationFrameIndex(0.45), 'desktop', 1440), 0.5);
  assert.match(hook, /getTransformationFrameFocusX\(index, variant, window\.innerWidth\)/);
});

test('MKT-01 standalone preview exposes video versus frames without changing the production default', () => {
  assert.match(previewModes, /renderer: params\.get\("renderer"\) === "frames" \? "frames" : "video"/);
  assert.match(previewEntry, /dataset\.mktRenderer = previewMode\.renderer/);
  assert.match(section, /isFrameRendererRequested/);
  assert.match(section, /<canvas ref=\{canvasRef\} className="mkt-transformation-frame-canvas"/);
  assert.match(section, /frameRenderer \? frameScrub\.failed : videoFailed/);
  assert.match(section, /reducedMotion \|\| !frameRenderer/);
  assert.doesNotMatch(section, /<img[^>]+frame-/);
});
