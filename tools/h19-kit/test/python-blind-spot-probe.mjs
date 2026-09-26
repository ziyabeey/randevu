import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runPythonBlindSpotProbe } from '../src/diagnostics/python-probe.mjs';
import { validateH19BlindSpotLedger } from '../src/diagnostics/blind-spots.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'h19-python-probe-'));
try {
  await mkdir(path.join(root, 'tests'), { recursive: true });

  await writeFile(path.join(root, 'app.py'), [
    'def foo(x):',
    '    return x + 1',
    '',
    'def caller():',
    '    return foo(1)',
    '',
  ].join('\n'));

  await writeFile(path.join(root, 'tests', 'test_app.py'), [
    'from app import foo',
    '',
    'def test_foo():',
    '    assert foo(1) == 2',
    '',
  ].join('\n'));

  await writeFile(path.join(root, 'script.py'), [
    'from app import foo',
    '',
    'value = foo(2)',
    'print(value)',
    '',
  ].join('\n'));

  const revision = 'a'.repeat(40);
  const probe = await runPythonBlindSpotProbe({
    repoRoot: root,
    sourceRevision: revision,
    focusFiles: ['app.py', 'script.py'],
  });

  assert.equal(probe.schemaVersion, 1);
  assert.equal(probe.kind, 'h19-python-blind-spot-probe');
  assert.equal(probe.sourceRevision, revision);
  assert.deepEqual(probe.focusFiles, ['app.py', 'script.py']);
  assert.equal(probe.inventory.filesScanned, 3);
  assert.equal(probe.inventory.extractionErrors, 0);
  assert.equal(probe.evidenceProvider.mode, 'python-ast');
  assert.equal(probe.claimBoundary.authority, 'diagnostic-only');
  assert.equal(probe.claimBoundary.runtimeCoverageKnown, false);
  assert.equal(probe.claimBoundary.completeKnowledgeClaimed, false);
  assert.equal(probe.claimBoundary.productDefectClaimed, false);

  const app = probe.mappings.find((row) => row.path === 'app.py');
  assert.ok(app);
  assert.equal(app.semanticUnitCount, 2);
  assert.equal(app.mappedCount, 2);
  assert.equal(app.unmatchedCount, 0);
  assert.ok(app.testReferencePaths.includes('tests/test_app.py'));
  assert.ok(app.candidateTests.some((item) => item.path === 'tests/test_app.py'));
  assert.ok(app.unknowns.includes('runtime-coverage'));
  assert.equal(app.safeToNarrow, false);

  const script = probe.mappings.find((row) => row.path === 'script.py');
  assert.ok(script);
  assert.equal(script.semanticUnitCount, 1);
  assert.equal(script.mappedCount, 1);
  assert.equal(script.unmatchedCount, 0);
  assert.ok(script.symbols.some((symbol) => symbol.endsWith('::<module>')));

  validateH19BlindSpotLedger(probe.ledger);
  assert.equal(probe.ledger.sourceRevision, revision);
  assert.equal(probe.ledger.counts.byCategory['semantic-unit-symbol-unmatched'], 0);
  assert.equal(probe.ledger.counts.byCategory['semantic-unit-absence'], 0);
  const runtimeCoverageSpots = probe.ledger.spots.filter((spot) =>
    spot.category === 'runtime-coverage-unknown-path');
  assert.ok(runtimeCoverageSpots.length >= 2);
  assert.ok(runtimeCoverageSpots.some((spot) => spot.subject.path === 'app.py'));
  assert.ok(runtimeCoverageSpots.some((spot) => spot.subject.path === 'script.py'));
  assert.ok(!probe.ledger.spots.some((spot) =>
    spot.category === 'impact-unknown'
    && spot.subject.unknown === 'runtime-coverage'));

  const replay = await runPythonBlindSpotProbe({
    repoRoot: root,
    sourceRevision: revision,
    focusFiles: ['script.py', 'app.py', 'app.py'],
  });
  assert.deepEqual(replay.focusFiles, probe.focusFiles);
  assert.deepEqual(replay.mappings, probe.mappings);
  assert.deepEqual(replay.ledger, probe.ledger);

  await assert.rejects(
    () => runPythonBlindSpotProbe({
      repoRoot: root,
      sourceRevision: 'not-a-sha',
      focusFiles: ['app.py'],
    }),
    /40-hex Git commit/,
  );

  await assert.rejects(
    () => runPythonBlindSpotProbe({
      repoRoot: root,
      sourceRevision: revision,
      focusFiles: ['missing.py'],
    }),
    /focus not found/,
  );

  await assert.rejects(
    () => runPythonBlindSpotProbe({
      repoRoot: root,
      sourceRevision: revision,
      focusFiles: ['README.md'],
    }),
    /focus must be \.py/,
  );

  console.log('H19 Python blind-spot probe: one-shot inventory -> AST graph -> M4 -> ledger, deterministic replay and fail-closed focus validation PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
