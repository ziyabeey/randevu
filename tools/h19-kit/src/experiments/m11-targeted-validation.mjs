import { stableJson } from '../core/cache.mjs';
import { m11Digest, validateM11Inventory } from './m11-materializer.mjs';
import { freezeM11Snapshot } from './m11-closure.mjs';
import { summarizeM11Tap, summarizeM11V8Coverage } from './m11-collection.mjs';
import { verifyCoveragePacket } from '../specification/test-spec.mjs';
import { coverageValidationResult } from '../discovery/validation-packet.mjs';
import { validateRelationalEvidenceCase, freezeRelationalOutcome } from '../relations/relational-evidence.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => stableJson(a) === stableJson(b);
const key = (f) => `${f.name}:${f.startOffset}:${f.endOffset}`;
const freeze = (x) => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
function sealed(x, field, expected) {
  const { [field]: sha, ...body } = x;
  assert(/^[a-f0-9]{64}$/.test(expected ?? '') && sha === expected && sha === m11Digest(body), `${field} identity mismatch`);
}

export function validateM11TargetedInputs(input) {
  const { plan, expectedPlanSha256, bridge, collection, closure, snapshot, inventory } = structuredClone(input);
  sealed(plan, 'planSha256', expectedPlanSha256);
  assert(plan.schemaVersion === 1 && plan.kind === 'm11-targeted-validation-plan'
    && plan.decisionRule === 'seven-passing-controls-and-four-original-gaps-called-v1', 'unsupported validation plan');
  validateM11Inventory(inventory, plan.inventorySha256);
  sealed(bridge, 'bridgeSha256', plan.bridgeSha256);
  sealed(collection, 'collectionSha256', bridge.collectionSha256);
  sealed(closure, 'closureSha256', inventory.metadata.repositoryClosureSha256);
  assert(bridge.inventorySha256 === inventory.manifest_sha256 && bridge.closureSha256 === closure.closureSha256,
    'bridge ancestry mismatch');
  assert(plan.sourceRevision === inventory.metadata.sourceRevision && collection.sourceRevision === plan.sourceRevision
    && closure.sourceRevision === plan.sourceRevision, 'source revision mismatch');
  assert(same(freezeM11Snapshot(snapshot.entries, snapshot.sourceRevision, snapshot.gitTreeSha), snapshot)
    && snapshot.snapshotSha256 === closure.snapshotSha256 && snapshot.sourceRevision === plan.sourceRevision,
  'snapshot identity mismatch');
  const relationalCase = bridge.materialization.relationalCases.find((c) => c.caseSha256 === plan.caseSha256);
  assert(relationalCase, 'case missing from bridge');
  const packet = bridge.materialization.packets.find((p) => p.packetSha256 === plan.packetSha256);
  verifyCoveragePacket(packet); validateRelationalEvidenceCase(relationalCase, { packet });
  assert(relationalCase.hypothesis.hypothesisId === plan.hypothesisId
    && packet.hypotheses.find((h) => h.id === plan.hypothesisId)?.target.path === plan.targetPath, 'hypothesis binding mismatch');
  const baseline = collection.runs.find((r) => r.observationSha256 === plan.baselineObservationSha256);
  assert(baseline, 'baseline observation missing'); sealed(baseline, 'observationSha256', plan.baselineObservationSha256);
  const target = baseline.targets.find((t) => t.path === plan.targetPath);
  assert(target && same(summarizeM11V8Coverage(target.v8Entries), target.coverage), 'baseline coverage mismatch');
  assert(same(plan.requiredEntries, target.coverage.uncalledNamedFunctions)
    && plan.requiredEntries.length === 4, 'original gap entries differ');
  const reached = new Set([plan.targetPath]), queue = [plan.targetPath];
  for (let i = 0; i < queue.length; i++) for (const edge of closure.edges.filter((e) => e.fromPath === queue[i])) {
    if (!reached.has(edge.toPath)) { reached.add(edge.toPath); queue.push(edge.toPath); }
  }
  const expectedBindings = Object.fromEntries([...reached].sort().map((p) => [p, closure.sourceBindings[p]]));
  assert(same(expectedBindings, plan.sourceBindings), 'execution dependency closure mismatch');
  const index = new Map(snapshot.entries.map((e) => [e.path, e]));
  const evaluation = new Set(closure.components.filter((c) => c.split === 'evaluation').flatMap((c) => Object.keys(c.sourceBindings)));
  const development = closure.components.find((c) => c.split === 'development' && c.sourceBindings[plan.targetPath]);
  assert(development && [...reached].every((p) => Object.hasOwn(development.sourceBindings, p)), 'target outside development');
  for (const [p, sha] of Object.entries({ ...plan.sourceBindings, ...plan.oracleBindings })) {
    assert(!evaluation.has(p), 'validation source crosses evaluation boundary');
    assert(index.get(p)?.gitBlobSha === sha && ['100644', '100755'].includes(index.get(p)?.mode), 'source is not pinned Git file');
  }
  assert(Object.keys(plan.oracleBindings).length === 2 && plan.scenarios.length === 7
    && new Set(plan.scenarios.map((s) => s.name)).size === 7, 'oracle/scenario inventory mismatch');
  assert(plan.scenarios.every((s) => Object.hasOwn(plan.oracleBindings, s.oraclePath)), 'scenario oracle is not bound');
  assert(plan.candidate.path === 'validation-001/booking-pagination.test.mjs'
    && /^[a-f0-9]{40}$/.test(plan.candidate.gitBlobSha), 'unsupported candidate');
  assert(/^v\d+\.\d+\.\d+$/.test(plan.runtime) && Number.isFinite(Date.parse(plan.frozenAt)), 'frozen runtime/time required');
  return freeze({ plan, relationalCase, packet, baseline, target,
    lineage: { component: development.component, executionPaths: [...reached].sort(),
      additionalDevelopmentPaths: Object.keys(plan.oracleBindings).sort(), evaluationOverlap: [],
      futureObservationLineageComplete: false } });
}

export function interpretM11TargetedRun(input, rawRun) {
  const { plan, relationalCase, packet, target, lineage } = validateM11TargetedInputs(input);
  const run = structuredClone(rawRun);
  sealed(run, 'observationSha256', run.observationSha256);
  assert(run.schemaVersion === 1 && run.kind === 'm11-targeted-suite-observation'
    && run.planSha256 === plan.planSha256 && run.sourceRevision === plan.sourceRevision
    && run.runtime === plan.runtime && same(run.sourceBindings, plan.sourceBindings)
    && same(run.oracleBindings, plan.oracleBindings) && run.candidateGitBlobSha === plan.candidate.gitBlobSha,
  'run input identity mismatch');
  assert(same(run.producerBindings, plan.producerBindings), 'run producer identity mismatch');
  assert(same(run.command, ['node', '--test', '--test-reporter=tap', 'validation/booking-pagination.test.mjs'])
    && same(run.environment, { NODE_OPTIONS: '', NODE_V8_COVERAGE: 'isolated-temporary-directory', TZ: 'UTC' }), 'run command/environment mismatch');
  assert(Number.isFinite(Date.parse(run.startedAt)) && Date.parse(run.startedAt) >= Date.parse(plan.frozenAt)
    && Date.parse(run.finishedAt) >= Date.parse(run.startedAt), 'run precedes plan or has invalid time');
  assert(['setupMs', 'executionMs', 'totalMs'].every((k) => Number.isFinite(run.timings[k]) && run.timings[k] >= 0)
    && run.timings.totalMs >= run.timings.executionMs, 'invalid observed timings');
  assert(Number.isInteger(run.exitCode) || run.exitCode === null, 'invalid exit code');
  assert(typeof run.completed === 'boolean' && typeof run.stdout === 'string' && typeof run.stderr === 'string', 'invalid run transport');
  let summary = null;
  try { summary = summarizeM11Tap(run.stdout); } catch { /* incomplete output stays inconclusive */ }
  assert(same(summary, run.testSummary), 'TAP summary mismatch');
  assert(run.target.path === plan.targetPath && run.target.gitBlobSha === plan.sourceBindings[plan.targetPath], 'coverage source mismatch');
  const coverage = summarizeM11V8Coverage(run.target.v8Entries);
  assert(same(coverage, run.target.coverage), 'V8 summary mismatch');
  const entries = new Map();
  for (const script of run.target.v8Entries) for (const f of script.functions) {
    if (!f.functionName) continue;
    const range = f.ranges[0], id = key({ name: f.functionName, ...range });
    entries.set(id, (entries.get(id) ?? 0) + range.count);
  }
  const gapChecks = plan.requiredEntries.map((f) => ({ ...f, observed: entries.has(key(f)), called: (entries.get(key(f)) ?? 0) > 0 }));
  const exactControls = plan.scenarios.every((s) => run.stdout.replaceAll('\r\n', '\n').includes(`# Subtest: ${s.name}\n`));
  const testsPassed = run.completed && run.exitCode === 0 && summary?.tests === 7 && summary.pass === 7
    && ['fail', 'cancelled', 'skipped', 'todo'].every((k) => summary[k] === 0) && exactControls;
  const status = testsPassed && gapChecks.every((f) => f.observed && f.called) ? 'confirmed' : 'inconclusive';
  const validation = coverageValidationResult({ packet, hypothesisId: plan.hypothesisId, status,
    observed: { endpoint: 'suite-scoped-named-function-coverage-gap', planSha256: plan.planSha256,
      baselineObservationSha256: plan.baselineObservationSha256, newObservationSha256: run.observationSha256,
      testSummary: summary, gapChecks, existingSuiteCalledEntries: target.coverage.calledNamedFunctions,
      existingSuiteObservedEntries: target.coverage.observedNamedFunctions,
      functionalDefectEstablished: false, independentRelationAssessment: false } });
  const source = { schemaVersion: 1, kind: 'm11-targeted-validation-source', planSha256: plan.planSha256,
    caseSha256: plan.caseSha256, observationSha256: run.observationSha256, validation, lineage,
    scope: 'agent-authored separate development unit execution; no DB/HTTP or independent assessor claim' };
  const sourceDigest = m11Digest(source);
  const outcome = freezeRelationalOutcome({ relationalCase, observedRevision: plan.sourceRevision,
    kind: 'm5-validation', value: status, sourceDigest });
  const body = { schemaVersion: 1, kind: 'm11-targeted-validation-result', planSha256: plan.planSha256,
    bridgeSha256: plan.bridgeSha256, caseSha256: plan.caseSha256, run, validation,
    outcomeSource: { ...source, sourceDigest }, outcome,
    counts: { attemptedHypotheses: 1, confirmedCoverageGaps: status === 'confirmed' ? 1 : 0,
      inconclusive: status === 'confirmed' ? 0 : 1, newCallsToOriginalUncalledEntries: gapChecks.filter((f) => f.called).length,
      functionalDefectsEstablished: 0, relationAssessments: 0, providerCalls: 0 },
    futureObservationLineageComplete: false };
  return freeze({ ...body, resultSha256: m11Digest(body) });
}
