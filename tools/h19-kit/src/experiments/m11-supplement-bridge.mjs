import { discoverCoverageHypotheses } from '../discovery/coverage-discovery.mjs';
import { freezeCoverageDiscoveryPacket } from '../discovery/validation-packet.mjs';
import { summarizeM11V8Coverage } from './m11-collection.mjs';
import { freezeM11Observation, m11FactFromObservation, materializeM11Development } from './m11-materializer.mjs';
import { checkM11SupplementSeal, sealM11Supplement, sameM11Supplement as same,
  uniqueM11Supplement as unique, summarizeM11SupplementTap, verifyM11SupplementInputs } from './m11-supplement-collection.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
function orderedTime(start, finish, earliest, latest) {
  const values = [start, finish, earliest, latest].map(Date.parse);
  return values.every(Number.isFinite) && values[0] >= values[2]
    && values[1] >= values[0] && values[1] <= values[3];
}

// Receipt-level replay only. Source/closure/producer replay is performed by
// materializeM11Supplement before these receipts can enter the materializer.
export function deriveM11SupplementReceipts(input) {
  const { plan, expectedPlanSha256, supplementalCollection: collection,
    expectedSupplementalCollectionSha256, inventory, staticAudit, previousBridge, closure } = input;
  checkM11SupplementSeal(plan, 'planSha256', expectedPlanSha256);
  checkM11SupplementSeal(collection, 'collectionSha256', expectedSupplementalCollectionSha256);
  checkM11SupplementSeal(staticAudit, 'auditSha256', plan.staticAuditSha256);
  checkM11SupplementSeal(previousBridge, 'bridgeSha256', plan.previousBridgeSha256);
  assert(collection.schemaVersion === 1 && collection.kind === 'm11-development-supplement-collection'
    && collection.planSha256 === plan.planSha256 && collection.inventorySha256 === plan.inventorySha256
    && collection.sourceRevision === plan.sourceRevision && collection.staticAuditSha256 === plan.staticAuditSha256,
  'supplement collection ancestry mismatch');
  assert(orderedTime(collection.startedAt, collection.finishedAt, plan.frozenAt, collection.finishedAt),
    'collection precedes plan or has invalid times');
  assert(same(collection.runs.map((r) => r.command?.[3]), plan.suites.map((s) => s.path)), 'supplement run set mismatch');
  const receipts = [], decisions = [];
  const fact = (factId, family, state, metricId, value, unit, denominator = null) => ({
    factId, family, state, metricId, value, unit, denominator, sampleSize: null, baseline: null,
  });
  const observation = (kind, rootDigests, payload) => freezeM11Observation({
    schemaVersion: 1, kind, producer: 'h19-m11-supplement-bridge', producerVersion: '0.1',
    sourceRevision: plan.sourceRevision, sourcePaths: Object.keys(plan.sourceBindings).sort(), rootDigests, payload,
  });
  for (const run of collection.runs) {
    checkM11SupplementSeal(run, 'observationSha256', run.observationSha256);
    const suite = plan.suites.find((s) => s.path === run.command[3]);
    assert(run.schemaVersion === 1 && run.kind === 'm11-supplement-suite-observation'
      && same(run.command, ['node', '--test', '--test-reporter=tap', suite.path])
      && run.planSha256 === plan.planSha256 && run.inventorySha256 === plan.inventorySha256
      && run.sourceRevision === plan.sourceRevision && same(run.sourceBindings, plan.sourceBindings), 'run ancestry mismatch');
    assert(run.runtime === plan.runtime && same(run.runtimeDependency, plan.runtimeDependency)
      && same(run.environment, { NODE_OPTIONS: '', NODE_V8_COVERAGE: 'isolated-temporary-directory', TZ: 'UTC', LANG: 'C.UTF-8' }),
    'run environment mismatch');
    assert(orderedTime(run.startedAt, run.finishedAt, collection.startedAt, collection.finishedAt), 'invalid run times');
    const controls = summarizeM11SupplementTap(run.stdout, suite, run.exitCode, run.transportError);
    assert(same(controls, run.controls), 'TAP control replay mismatch');
    assert(same(run.loadedSourcePaths, unique(run.loadedSourcePaths))
      && run.loadedSourcePaths.every((p) => Object.hasOwn(plan.sourceBindings, p)), 'loaded source crosses development boundary');
    assert(same(run.loadedDependencyPaths, unique(run.loadedDependencyPaths))
      && run.loadedDependencyPaths.every((p) => p.startsWith('node_modules/hono/') && !p.split('/').includes('..')),
    'unbound runtime dependency');
    const anchors = inventory.cases.filter((r) => plan.anchorIds.includes(r.case_id) && r.referenceSuite === suite.path);
    assert(anchors.length && anchors.every((r) => r.split === 'development'), 'suite outside selected development anchors');
    const targets = unique(anchors.flatMap((r) => r.targets));
    assert(same(run.targets.map((t) => t.path), targets), 'observation target set mismatch');
    for (const t of run.targets) {
      assert(t.gitBlobSha === plan.sourceBindings[t.path]
        && same(t.evidenceKinds, unique(anchors.filter((r) => r.targets.includes(t.path)).map((r) => r.referenceEvidenceKind))),
      'target source or evidence kind mismatch');
      assert(same(t.coverage, summarizeM11V8Coverage(t.v8Entries)), 'V8 summary replay mismatch');
      assert(!t.v8Entries.length || run.loadedSourcePaths.includes(t.path), 'V8 target not in loaded sources');
    }
    const eligible = controls.state === 'completed-passing' && run.loadedSourcePaths.includes(suite.path);
    for (const anchor of anchors) {
      if (!eligible) {
        decisions.push({ anchorId: anchor.case_id, observationSha256: run.observationSha256,
          status: 'ineligible-observation', reason: 'incomplete-or-nonpassing-control-run' });
        continue;
      }
      const component = closure.components.find((c) => c.component === anchor.cluster);
      assert(component?.split === 'development' && Object.keys(plan.sourceBindings).every((p) =>
        component.sourceBindings[p] === plan.sourceBindings[p]), 'observation crosses anchor component');
      const scoped = run.targets.filter((t) => anchor.targets.includes(t.path));
      const uncoveredPaths = scoped.filter((t) => t.coverage.state === 'observed'
        && t.coverage.uncalledNamedFunctions.length).map((t) => t.path);
      const impact = { changedFiles: [], safeToNarrow: false,
        unknowns: ['baseline-only; no change-impact observation', 'suite-scoped named V8 entries; whole-product and branch coverage unknown'],
        symbolImpact: { report: { uncoveredPaths } } };
      const changeId = `baseline:${run.observationSha256}`;
      const packet = freezeCoverageDiscoveryPacket({ changeId, sourceRevision: plan.sourceRevision,
        impact, discovery: discoverCoverageHypotheses({ impact }) });
      const parents = { collectionSha256: collection.collectionSha256, observationSha256: run.observationSha256,
        planSha256: plan.planSha256, scope: 'saved-suite-baseline' };
      const change = observation('change', [run.observationSha256], { mode: 'baseline', changeId, changedFiles: [], ...parents });
      const packetArtifact = observation('m5-packet', [run.observationSha256], { packet, ...parents });
      const artifacts = [change, packetArtifact], factPool = [];
      const addFacts = (artifact, p) => {
        artifacts.push(artifact);
        for (const f of artifact.payload.facts) factPool.push({ fact: m11FactFromObservation(artifact, f.factId), scope: { kind: 'path', path: p } });
      };
      for (const t of scoped) {
        const known = t.coverage.state === 'observed', count = known ? t.coverage.uncalledNamedFunctions.length : null;
        addFacts(observation('fact-source', [run.observationSha256], { ...parents, targetPath: t.path, coverage: t.coverage,
          facts: [fact(`coverage:${t.path}`, 'coverage', known ? (count ? 'present' : 'absent') : 'unknown',
            'suite-uncalled-named-v8-entry-count', count, 'named-v8-entries', known ? t.coverage.observedNamedFunctions : null)] }), t.path);
        if (!uncoveredPaths.includes(t.path)) continue;
        const edges = staticAudit.edges.filter((e) => e.toPath === t.path && /^(src|worker|shared)\//.test(e.fromPath));
        assert(edges.every((e) => Object.hasOwn(plan.sourceBindings, e.fromPath)), 'static witness crosses development boundary');
        const importers = unique(edges.map((e) => e.fromPath));
        if (importers.length) addFacts(observation('fact-source', [staticAudit.auditSha256], {
          auditSha256: staticAudit.auditSha256, targetPath: t.path,
          scope: 'positive production importer witnesses in development bounded static scan; not complete fan-in', edges,
          facts: [fact(`dependency:${t.path}`, 'dependency', 'present', 'bounded-production-importer-witness-count', importers.length, 'source-files')],
        }), t.path);
      }
      receipts.push({ anchorId: anchor.case_id, packetArtifactSha256: packetArtifact.artifactSha256,
        changeArtifactSha256: change.artifactSha256, artifacts, factPool, relationships: [] });
      decisions.push({ anchorId: anchor.case_id, observationSha256: run.observationSha256, status: 'receipt-bound',
        hypothesisPaths: uncoveredPaths, unknownCoveragePaths: scoped.filter((t) => t.coverage.state === 'unknown').map((t) => t.path),
        scope: 'suite-level binding; not an individual test measurement' });
    }
  }
  return { receipts, decisions };
}

export async function materializeM11Supplement(input) {
  const { readSource, readProducer, ...data } = input;
  input = { ...structuredClone(data), readSource, readProducer };
  const { texts, previousBridge } = await verifyM11SupplementInputs(input);
  const { receipts, decisions } = deriveM11SupplementReceipts(input);
  const { bundleSha256: ignored, ...oldBundle } = previousBridge.observations;
  const observations = sealM11Supplement({ ...oldBundle,
    receipts: [...oldBundle.receipts, ...receipts].sort((a, b) => a.anchorId.localeCompare(b.anchorId)) }, 'bundleSha256');
  const materialization = await materializeM11Development({ inventory: input.inventory,
    expectedInventorySha256: input.plan.inventorySha256, observations,
    readSource: async (p) => { assert(Object.hasOwn(texts, p), 'unverified source requested'); return texts[p]; } });
  return sealM11Supplement({ schemaVersion: 1, kind: 'm11-supplement-observation-bridge', bridgeVersion: '0.1',
    planSha256: input.plan.planSha256, previousBridgeSha256: previousBridge.bridgeSha256,
    supplementalCollectionSha256: input.supplementalCollection.collectionSha256,
    lineageScope: 'current-receipts-only; disjoint observation roots are not statistical independence',
    futureObservationLineageComplete: false, newEmpiricalRuns: 0, decisions, observations, materialization }, 'bridgeSha256');
}
