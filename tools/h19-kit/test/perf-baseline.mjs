import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runPerformanceBaseline } from '../src/perf/baseline.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-perf-smoke-'));
try {
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}\n');
  await writeFile(path.join(temp, 'tsconfig.json'), '{"compilerOptions":{}}\n');
  await mkdir(path.join(temp, 'src'), { recursive: true });
  await writeFile(path.join(temp, 'src', 'a.ts'), 'export function a() { return 1 }\n');
  await writeFile(path.join(temp, 'src', 'b.py'), 'def b():\n    return 2\n');

  // historySnapshot requires a real Git repository.
  const { spawnSync } = await import('node:child_process');
  for (const args of [
    ['init'],
    ['config','user.email','perf@example.invalid'],
    ['config','user.name','H19 Perf'],
    ['add','.'],
    ['commit','-m','fixture'],
  ]) {
    const r = spawnSync('git', args, { cwd: temp, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }

  const report = await runPerformanceBaseline({
    cwd: temp,
    requireScip: false,
    historyMaxCommits: 10,
    syntheticProjects: 20,
    syntheticReferences: 200,
  });

  assert.equal(report.schemaVersion, 3);
  assert.equal(report.kind, 'h19-performance-baseline');
  assert.ok(report.repository.sourceFiles >= 2);
  assert.ok(report.repository.scipProjectShards >= 1);
  assert.ok(report.repository.scipIndexedFiles >= 1);
  assert.ok(report.measurements.inventory.units >= 2);
  assert.equal(report.measurements.history.coldCache, 'miss');
  assert.equal(report.measurements.history.warmCache, 'hit');
  assert.equal(report.measurements.syntheticScale.projects, 20);
  assert.equal(report.measurements.syntheticScale.references, 200);
  assert.ok(report.measurements.syntheticScale.impactedPaths > 0);
  assert.equal(report.interpretation.thresholdsFrozen, false);
  assert.ok(['not-measured','measured'].includes(report.measurements.scipTypescript.status));
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit performance baseline smoke: ok');
