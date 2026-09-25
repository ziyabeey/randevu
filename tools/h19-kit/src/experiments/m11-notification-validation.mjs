import { stableJson } from '../core/cache.mjs';
import { coverageValidationResult } from '../discovery/validation-packet.mjs';
import { verifyCoveragePacket } from '../specification/test-spec.mjs';
import {
  freezeRelationalOutcome,
  validateRelationalEvidenceCase,
} from '../relations/relational-evidence.mjs';
import { summarizeM11Tap, summarizeM11V8Coverage } from './m11-collection.mjs';
import { freezeM11Snapshot } from './m11-closure.mjs';
import { m11Digest, validateM11Inventory } from './m11-materializer.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => stableJson(a) === stableJson(b);
const freeze = (x) => {
  if (x && typeof x === 'object') {
    Object.values(x).forEach(freeze);
    Object.freeze(x);
  }
  return x;
};
const entryKey = (f) => `${f.name}:${f.startOffset}:${f.endOffset}`;

function sealed(value, field, expected) {
  const { [field]: sha, ...body } = value;
  assert(/^[a-f0-9]{64}$/.test(expected ?? '')
    && sha === expected
    && sha === m11Digest(body), `${field} identity mismatch`);
}

export function validateM11NotificationInputs(input) {
  const {
    plan,
    expectedPlanSha256,
    bridge,
    supplementalCollection,
    closure,
    snapshot,
    inventory,
  } = structuredClone(input);

  sealed(plan, 'planSha256', expectedPlanSha256);
  assert(plan.schemaVersion === 1
    && plan.kind === 'm11-notification-behavioral-validation-plan'
    && plan.version === '0.1'
    && plan.decisionRule === 'six-passing-controls-and-two-original-gaps-called-v1',
  'unsupported notification validation plan');

  validateM11Inventory(inventory, plan.inventorySha256);
  sealed(bridge, 'bridgeSha256', plan.bridgeSha256);
  sealed(supplementalCollection, 'collectionSha256', plan.baselineCollectionSha256);
  sealed(closure, 'closureSha256', inventory.metadata.repositoryClosureSha256);

  assert(bridge.inventorySha256 == null || bridge.materialization?.inventorySha256 === inventory.manifest_sha256,
    'bridge inventory mismatch');
  assert(bridge.supplementalCollectionSha256 === supplementalCollection.collectionSha256,
    'bridge collection ancestry mismatch');
  assert(plan.sourceRevision === inventory.metadata.sourceRevision
    && supplementalCollection.sourceRevision === plan.sourceRevision
    && closure.sourceRevision === plan.sourceRevision,
  'source revision mismatch');

  assert(same(
    freezeM11Snapshot(snapshot.entries, snapshot.sourceRevision, snapshot.gitTreeSha),
    snapshot,
  ) && snapshot.snapshotSha256 === closure.snapshotSha256
    && snapshot.sourceRevision === plan.sourceRevision,
  'snapshot identity mismatch');

  const relationalCase = bridge.materialization.relationalCases
    .find((item) => item.caseSha256 === plan.caseSha256);
  assert(relationalCase, 'notification case missing from bridge');

  const packet = bridge.materialization.packets
    .find((item) => item.packetSha256 === plan.packetSha256);
  verifyCoveragePacket(packet);
  validateRelationalEvidenceCase(relationalCase, { packet });

  assert(relationalCase.hypothesis.hypothesisId === plan.hypothesisId
    && packet.hypotheses.find((item) => item.id === plan.hypothesisId)?.target.path === plan.targetPath,
  'notification hypothesis binding mismatch');

  const baseline = supplementalCollection.runs
    .find((item) => item.observationSha256 === plan.baselineObservationSha256);
  assert(baseline, 'notification baseline observation missing');
  sealed(baseline, 'observationSha256', plan.baselineObservationSha256);

  const target = baseline.targets.find((item) => item.path === plan.targetPath);
  assert(target && same(summarizeM11V8Coverage(target.v8Entries), target.coverage),
    'notification baseline coverage mismatch');
  assert(same(plan.requiredEntries, target.coverage.uncalledNamedFunctions)
    && plan.requiredEntries.length === 2
    && same(plan.requiredEntries.map((item) => item.name), ['renderTemplateV2', 'validGroupSummary'].sort()),
  'notification original gap entries differ');

  const reached = new Set([plan.targetPath]);
  const queue = [plan.targetPath];
  for (let index = 0; index < queue.length; index += 1) {
    for (const edge of closure.edges.filter((item) => item.fromPath === queue[index])) {
      if (!reached.has(edge.toPath)) {
        reached.add(edge.toPath);
        queue.push(edge.toPath);
      }
    }
  }
  const expectedBindings = Object.fromEntries(
    [...reached].sort().map((path) => [path, closure.sourceBindings[path]]),
  );
  assert(same(expectedBindings, plan.sourceBindings), 'notification execution dependency closure mismatch');

  const snapshotIndex = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
  const evaluation = new Set(
    closure.components
      .filter((component) => component.split === 'evaluation')
      .flatMap((component) => Object.keys(component.sourceBindings)),
  );
  const development = closure.components.find((component) =>
    component.split === 'development' && component.sourceBindings[plan.targetPath]);
  assert(development
    && [...reached].every((path) => Object.hasOwn(development.sourceBindings, path)),
  'notification target outside development component');

  for (const [path, sha] of Object.entries({ ...plan.sourceBindings, ...plan.oracleBindings })) {
    assert(!evaluation.has(path), 'notification validation crosses evaluation boundary');
    const record = snapshotIndex.get(path);
    assert(record?.gitBlobSha === sha && ['100644', '100755'].includes(record.mode),
      'notification validation source is not pinned Git file');
  }

  assert(plan.scenarios.length === 6
    && new Set(plan.scenarios.map((item) => item.id)).size === 6
    && new Set(plan.scenarios.map((item) => item.name)).size === 6,
  'notification scenario inventory mismatch');
  assert(plan.candidate.path === 'notification-validation-001/notification-template.test.mjs'
    && /^[a-f0-9]{40}$/.test(plan.candidate.gitBlobSha),
  'unsupported notification candidate');
  assert(/^v\d+\.\d+\.\d+$/.test(plan.runtime)
    && Number.isFinite(Date.parse(plan.frozenAt)),
  'notification frozen runtime/time required');

  return freeze({
    plan,
    relationalCase,
    packet,
    baseline,
    target,
    lineage: {
      component: development.component,
      executionPaths: [...reached].sort(),
      oraclePaths: Object.keys(plan.oracleBindings).sort(),
      evaluationOverlap: [],
      futureObservationLineageComplete: false,
    },
  });
}

export function interpretM11NotificationRun(input, rawRun) {
  const {
    plan,
    relationalCase,
    packet,
    target,
    lineage,
  } = validateM11NotificationInputs(input);

  const run = structuredClone(rawRun);
  sealed(run, 'observationSha256', run.observationSha256);

  assert(run.schemaVersion === 1
    && run.kind === 'm11-notification-behavioral-suite-observation'
    && run.planSha256 === plan.planSha256
    && run.sourceRevision === plan.sourceRevision
    && run.runtime === plan.runtime
    && same(run.sourceBindings, plan.sourceBindings)
    && same(run.oracleBindings, plan.oracleBindings)
    && run.candidateGitBlobSha === plan.candidate.gitBlobSha,
  'notification run input identity mismatch');
  assert(same(run.producerBindings, plan.producerBindings),
    'notification run producer identity mismatch');
  assert(same(run.command, [
    'node',
    '--test',
    '--test-reporter=tap',
    'validation/notification-template.test.mjs',
  ]) && same(run.environment, {
    NODE_OPTIONS: '',
    NODE_V8_COVERAGE: 'isolated-temporary-directory',
    TZ: 'UTC',
  }), 'notification run command/environment mismatch');

  assert(Number.isFinite(Date.parse(run.startedAt))
    && Date.parse(run.startedAt) >= Date.parse(plan.frozenAt)
    && Date.parse(run.finishedAt) >= Date.parse(run.startedAt),
  'notification run precedes plan or has invalid time');
  assert(['setupMs', 'executionMs', 'totalMs'].every((key) =>
    Number.isFinite(run.timings[key]) && run.timings[key] >= 0)
    && run.timings.totalMs >= run.timings.executionMs,
  'invalid notification timings');
  assert(Number.isInteger(run.exitCode) || run.exitCode === null,
    'invalid notification exit code');
  assert(typeof run.completed === 'boolean'
    && typeof run.stdout === 'string'
    && typeof run.stderr === 'string',
  'invalid notification transport');

  let summary = null;
  try {
    summary = summarizeM11Tap(run.stdout);
  } catch {
    // Partial TAP stays inconclusive.
  }
  assert(same(summary, run.testSummary), 'notification TAP summary mismatch');

  assert(run.target.path === plan.targetPath
    && run.target.gitBlobSha === plan.sourceBindings[plan.targetPath],
  'notification coverage source mismatch');
  const coverage = summarizeM11V8Coverage(run.target.v8Entries);
  assert(same(coverage, run.target.coverage), 'notification V8 summary mismatch');

  const entries = new Map();
  for (const script of run.target.v8Entries) {
    for (const fn of script.functions) {
      if (!fn.functionName) continue;
      const range = fn.ranges?.[0];
      if (!range) continue;
      const id = entryKey({
        name: fn.functionName,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
      });
      entries.set(id, (entries.get(id) ?? 0) + range.count);
    }
  }

  const gapChecks = plan.requiredEntries.map((item) => ({
    ...item,
    observed: entries.has(entryKey(item)),
    called: (entries.get(entryKey(item)) ?? 0) > 0,
  }));
  const normalized = run.stdout.replaceAll('\r\n', '\n');
  const exactControls = plan.scenarios.every((scenario) =>
    normalized.includes(`# Subtest: ${scenario.name}\n`));
  const testsPassed = run.completed
    && run.exitCode === 0
    && summary?.tests === 6
    && summary.pass === 6
    && ['fail', 'cancelled', 'skipped', 'todo'].every((key) => summary[key] === 0)
    && exactControls;

  const status = testsPassed && gapChecks.every((item) => item.observed && item.called)
    ? 'confirmed'
    : 'inconclusive';

  const validation = coverageValidationResult({
    packet,
    hypothesisId: plan.hypothesisId,
    status,
    observed: {
      endpoint: 'suite-scoped-notification-behavioral-coverage-gap',
      planSha256: plan.planSha256,
      baselineObservationSha256: plan.baselineObservationSha256,
      newObservationSha256: run.observationSha256,
      testSummary: summary,
      gapChecks,
      existingSuiteCalledEntries: target.coverage.calledNamedFunctions,
      existingSuiteObservedEntries: target.coverage.observedNamedFunctions,
      behavioralAssertionFailureObserved: run.completed && !testsPassed,
      functionalDefectEstablished: false,
      independentRelationAssessment: false,
      realProviderCalls: 0,
    },
  });

  const source = {
    schemaVersion: 1,
    kind: 'm11-notification-behavioral-validation-source',
    planSha256: plan.planSha256,
    caseSha256: plan.caseSha256,
    observationSha256: run.observationSha256,
    validation,
    lineage,
    scope: 'separate agent-authored development behavior execution; fake provider/RPC only; no independent assessor claim',
  };
  const sourceDigest = m11Digest(source);
  const outcome = freezeRelationalOutcome({
    relationalCase,
    observedRevision: plan.sourceRevision,
    kind: 'm5-validation',
    value: status,
    sourceDigest,
  });

  const body = {
    schemaVersion: 1,
    kind: 'm11-notification-behavioral-validation-result',
    planSha256: plan.planSha256,
    bridgeSha256: plan.bridgeSha256,
    caseSha256: plan.caseSha256,
    run,
    validation,
    outcomeSource: { ...source, sourceDigest },
    outcome,
    counts: {
      attemptedHypotheses: 1,
      confirmedCoverageGaps: status === 'confirmed' ? 1 : 0,
      inconclusive: status === 'confirmed' ? 0 : 1,
      newCallsToOriginalUncalledEntries: gapChecks.filter((item) => item.called).length,
      behavioralControlsPassed: testsPassed ? 6 : summary?.pass ?? 0,
      functionalDefectsEstablished: 0,
      relationAssessments: 0,
      realProviderCalls: 0,
    },
    futureObservationLineageComplete: false,
  };

  return freeze({ ...body, resultSha256: m11Digest(body) });
}
