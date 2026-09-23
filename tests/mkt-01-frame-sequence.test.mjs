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
  assert.match(loader, /case "reminder": return 0\.70/);
  assert.match(loader, /case "friction": return 0\.63/);
  assert.match(loader, /case "sweep": return 0\.56/);
  assert.match(loader, /case "pricing": return 0\.67/);
  assert.match(loader, /if \(viewportWidth <= 980\)[\s\S]*?return 0\.62/);
  assert.match(loader, /return 0\.5/);
  assert.match(loader, /const x = \(renderWidth - drawWidth\) \* boundedFocusX/);
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

test('MKT-01 production renderer is the WebP sequence; explicit overrides win; contract caps the sequences', async () => {
  const policy = await import('../src/marketing/transformation/rendererPolicy.ts');
  assert.equal(policy.TRANSFORMATION_PRODUCTION_RENDERER, 'frames');
  assert.equal(policy.resolveTransformationRenderer(undefined), 'frames');
  assert.equal(policy.resolveTransformationRenderer(null), 'frames');
  assert.equal(policy.resolveTransformationRenderer('nonsense'), 'frames');
  assert.equal(policy.resolveTransformationRenderer('video'), 'video');
  assert.equal(policy.resolveTransformationRenderer('frames'), 'frames');
  assert.match(section, /resolveTransformationRenderer\(requested\) === "frames"/);
  assert.match(previewEntry, /if \(previewMode\.rendererExplicit\) document\.documentElement\.dataset\.mktRenderer = previewMode\.renderer/);
  assert.match(previewModes, /rendererExplicit: params\.get\("renderer"\) === "frames" \|\| params\.get\("renderer"\) === "video"/);
  const contract = await import('../src/marketing/asset-contract.ts');
  assert.equal(contract.MARKETING_FRAME_SEQUENCE_CONTRACT.count, 121);
  assert.equal(contract.MARKETING_FRAME_SEQUENCE_CONTRACT.desktop.maxTotalBytes, 6_553_600);
  assert.equal(contract.MARKETING_FRAME_SEQUENCE_CONTRACT.mobile.maxTotalBytes, 2_883_584);
  assert.equal(contract.MARKETING_ASSET_CONTRACT['/marketing/transformation/randevu-transformation-master.mp4'].required, false);
});

test('MKT-01 scroll pacing maps scroll to video time monotonically and lands on the Kling beats', async () => {
  const timeline = await import('../src/marketing/transformation/timeline.ts');
  const ease = timeline.easeTransformationScroll;
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
  let previous = 0;
  for (let step = 0; step <= 200; step++) {
    const value = ease(step / 200);
    assert.ok(value >= previous, `easing must be monotonic at ${step / 200}`);
    previous = value;
  }
  assert.ok(Math.abs(ease(0.42) - 1.8 / timeline.TRANSFORMATION_VIDEO_DURATION) < 1e-6, 'cut ends at the camera drop beat');
  assert.ok(Math.abs(ease(0.8) - 4.15 / timeline.TRANSFORMATION_VIDEO_DURATION) < 1e-6, 'seated reveal keeps the last fifth of the scroll');
  assert.equal(timeline.getTransformationPhase(ease(0.9)), 'pricing');
  assert.match(hook, /easeTransformationScroll\(clamp01\(\(window\.scrollY - sectionTop\) \/ scrollRange\)\)/);
  assert.match(loader, /imageSmoothingQuality = "high"/);
});
