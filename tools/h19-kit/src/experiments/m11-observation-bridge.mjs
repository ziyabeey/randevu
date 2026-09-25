import { stableJson } from '../core/cache.mjs';
import { discoverCoverageHypotheses } from '../discovery/coverage-discovery.mjs';
import { freezeCoverageDiscoveryPacket } from '../discovery/validation-packet.mjs';
import { freezeM11Snapshot, refreezeM11Inventory } from './m11-closure.mjs';
import { auditM11CollectionSources, summarizeM11Tap, summarizeM11V8Coverage } from './m11-collection.mjs';
import { m11Digest, m11SourceBlobSha, validateM11Inventory, freezeM11Observation,
  m11FactFromObservation, materializeM11Development } from './m11-materializer.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => stableJson(a) === stableJson(b);
const unique = (xs) => [...new Set(xs)].sort();
function sealed(value, key, expected) {
  const { [key]: digest, ...body } = value;
  assert(/^[a-f0-9]{64}$/.test(expected ?? '') && digest === expected
    && m11Digest(body) === digest, `${key} identity mismatch`);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Offline derivation of existing measurements. No test execution, new run,
// label, assumed change, inferred UI coverage or replacement root is created.
export async function bridgeM11Observations({ originalInventory, inventory, snapshot,
  closure, recipe, collection, expectedInventorySha256, expectedCollectionSha256, readSource } = {}) {
  ({ originalInventory, inventory, snapshot, closure, recipe, collection } =
    structuredClone({ originalInventory, inventory, snapshot, closure, recipe, collection }));
  validateM11Inventory(inventory, expectedInventorySha256);
  const oldSha = inventory.metadata.supersedesInventorySha256;
  validateM11Inventory(originalInventory, oldSha);
  sealed(closure, 'closureSha256', inventory.metadata.repositoryClosureSha256);
  assert(same(refreezeM11Inventory({ inventory: originalInventory,
    expectedInventorySha256: oldSha, closure }), inventory), 'refrozen inventory derivation mismatch');
  assert(inventory.metadata.independentRepositoryComponents.evaluation > 0, 'evaluation component required');
  assert(snapshot.sourceRevision === inventory.metadata.sourceRevision
    && snapshot.gitTreeSha === closure.gitTreeSha, 'snapshot revision mismatch');
  assert(same(freezeM11Snapshot(snapshot.entries, snapshot.sourceRevision, snapshot.gitTreeSha), snapshot)
    && snapshot.snapshotSha256 === closure.snapshotSha256, 'snapshot identity mismatch');
  const index = new Map(snapshot.entries.map((e) => [e.path, e]));
  for (const [p, sha] of Object.entries({ ...closure.sourceBindings, ...closure.commonContextBindings })) {
    assert(index.get(p)?.gitBlobSha === sha && ['100644', '100755'].includes(index.get(p).mode),
      'closure source is not a regular pinned Git file');
  }
  sealed(collection, 'collectionSha256', expectedCollectionSha256);
  assert(collection.schemaVersion === 1 && collection.kind === 'm11-development-collection'
    && collection.inventorySha256 === oldSha && collection.sourceRevision === inventory.metadata.sourceRevision,
  'collection ancestry mismatch');
  sealed(recipe, 'recipeSha256', collection.recipeSha256);
  assert(recipe.kind === 'm11-collection-recipe' && recipe.schemaVersion === 1
    && recipe.inventorySha256 === oldSha && recipe.sourceRevision === collection.sourceRevision,
  'recipe ancestry mismatch');
  sealed(collection.dependencyAudit, 'auditSha256', collection.dependencyAudit.auditSha256);
  assert(collection.dependencyAudit.recipeSha256 === recipe.recipeSha256
    && collection.dependencyAudit.inventorySha256 === oldSha
    && same(collection.dependencyAudit.sourceBindings, recipe.sourceBindings), 'historical audit binding mismatch');
  const suites = unique(originalInventory.cases.filter((r) => r.split === 'development').map((r) => r.referenceSuite));
  assert(same(recipe.referenceSuites, suites), 'recipe must retain original development suites');
  assert(Array.isArray(collection.runs) && collection.runs.length === suites.length, 'collection run set mismatch');
  const components = new Map(closure.components.map((c) => [c.component, c]));
  const pathsBySplit = new Map();
  for (const c of components.values()) for (const p of Object.keys(c.sourceBindings)) {
    assert(!pathsBySplit.has(p) || pathsBySplit.get(p) === c.split, 'source crosses evaluation boundary');
    pathsBySplit.set(p, c.split);
  }
  // All original observation inputs must fit the repaired development split,
  // including bounded witness files that were originally considered evaluation.
  for (const [p, sha] of Object.entries(recipe.sourceBindings)) {
    assert(closure.sourceBindings[p] === sha && pathsBySplit.get(p) === 'development',
      'collection source outside development closure');
  }
  assert(typeof readSource === 'function', 'source reader required');
  const verified = new Map();
  const bindings = { ...closure.commonContextBindings };
  for (const c of components.values()) if (c.split === 'development') Object.assign(bindings, c.sourceBindings);
  for (const [p, sha] of Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = await readSource(p);
    assert(m11SourceBlobSha(bytes) === sha, `source identity mismatch: ${p}`);
    verified.set(p, Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes);
  }
  // Replay the original bounded static observation from development bytes only.
  // The global closure includes evaluation files and is not a fact-source root.
  const { audit: replayedAudit } = await auditM11CollectionSources({ inventory: originalInventory,
    expectedInventorySha256: oldSha, recipe, readSource: async (p) => verified.get(p) });
  assert(same(replayedAudit, collection.dependencyAudit), 'bounded static observation replay mismatch');
  const runIndex = new Map();
  for (const run of collection.runs) {
    sealed(run, 'observationSha256', run.observationSha256);
    const suite = run.command?.[3];
    assert(run.schemaVersion === 1 && run.kind === 'm11-development-suite-observation'
      && suites.includes(suite) && !runIndex.has(suite)
      && same(run.command, ['node', '--test', '--test-reporter=tap', suite]), 'invalid or duplicate suite observation');
    assert(run.sourceRevision === collection.sourceRevision && run.inventorySha256 === oldSha
      && run.recipeSha256 === recipe.recipeSha256 && same(run.sourceBindings, recipe.sourceBindings), 'run ancestry mismatch');
    assert(/^v\d+\.\d+\.\d+$/.test(run.runtime) && same(run.environment,
      { NODE_OPTIONS: '', NODE_V8_COVERAGE: 'isolated-temporary-directory' }), 'unsupported observation environment');
    const summary = summarizeM11Tap(run.stdout);
    assert(same(summary, run.testSummary) && summary.tests === summary.pass + summary.fail
      + summary.cancelled + summary.skipped + summary.todo && Number.isInteger(run.exitCode), 'TAP summary mismatch');
    assert(run.exitCode === 0 && summary.fail === 0 && summary.cancelled === 0
      && summary.skipped === 0 && summary.todo === 0, 'bridge v0.1 requires completed passing controls');
    const rows = originalInventory.cases.filter((r) => r.split === 'development' && r.referenceSuite === suite);
    assert(summary.tests === rows.length && rows.every((r) =>
      run.stdout.replaceAll('\r\n', '\n').includes(`# Subtest: ${r.referenceTest}\n`)), 'reference controls differ from collection');
    const targets = unique(rows.flatMap((r) => r.targets));
    assert(same(run.targets.map((t) => t.path).sort(), targets), 'observation target set mismatch');
    for (const t of run.targets) {
      assert(t.gitBlobSha === recipe.sourceBindings[t.path]
        && same(t.evidenceKinds, unique(rows.filter((r) => r.targets.includes(t.path)).map((r) => r.referenceEvidenceKind))),
      'target source or evidence kind mismatch');
      assert(same(summarizeM11V8Coverage(t.v8Entries), t.coverage), 'V8 summary mismatch');
    }
    runIndex.set(suite, run);
  }

  const receipts = [], decisions = [];
  const observation = (kind, sourcePaths, rootDigests, payload) => freezeM11Observation({
    schemaVersion: 1, kind, producer: 'h19-m11-observation-bridge', producerVersion: '0.1',
    sourceRevision: collection.sourceRevision, sourcePaths: unique(sourcePaths), rootDigests: unique(rootDigests), payload,
  });
  const fact = (factId, family, state, metricId, value, unit, denominator = null) => ({
    factId, family, state, metricId, value, unit, denominator, sampleSize: null, baseline: null,
  });
  for (const anchor of inventory.cases.filter((r) => r.split === 'development')) {
    const run = runIndex.get(anchor.referenceSuite);
    if (!run) continue;
    const component = components.get(anchor.cluster);
    assert(Object.keys(run.sourceBindings).every((p) => Object.hasOwn(component.sourceBindings, p)),
      'run inputs cross anchor component');
    const targets = run.targets.filter((t) => anchor.targets.includes(t.path));
    const uncoveredPaths = targets.filter((t) => t.coverage.state === 'observed'
      && t.coverage.uncalledNamedFunctions.length > 0).map((t) => t.path);
    const impact = { changedFiles: [], safeToNarrow: false,
      unknowns: ['baseline-only; no change-impact observation',
        'suite-scoped named V8 entries; whole-product and branch coverage unknown'],
      symbolImpact: { report: { uncoveredPaths } } };
    const discovery = discoverCoverageHypotheses({ impact });
    const changeId = `baseline:${run.observationSha256}`;
    const packet = freezeCoverageDiscoveryPacket({ changeId, sourceRevision: collection.sourceRevision, impact, discovery });
    const sourcePaths = Object.keys(run.sourceBindings);
    const parents = { collectionSha256: collection.collectionSha256, observationSha256: run.observationSha256,
      originalInventorySha256: oldSha, scope: 'saved-suite-baseline' };
    const change = observation('change', sourcePaths, [run.observationSha256],
      { mode: 'baseline', changeId, changedFiles: [], ...parents });
    const packetArtifact = observation('m5-packet', sourcePaths, [run.observationSha256], { packet, ...parents });
    const artifacts = [change, packetArtifact], factPool = [];
    const addFacts = (artifact, targetPath) => {
      artifacts.push(artifact);
      artifact.payload.facts.forEach((f) => factPool.push({ fact: m11FactFromObservation(artifact, f.factId),
        scope: { kind: 'path', path: targetPath } }));
    };
    for (const t of targets) {
      const known = t.coverage.state === 'observed';
      const count = known ? t.coverage.uncalledNamedFunctions.length : null;
      addFacts(observation('fact-source', sourcePaths, [run.observationSha256], {
        ...parents, targetPath: t.path, coverage: t.coverage,
        facts: [fact(`coverage:${t.path}`, 'coverage', known ? (count ? 'present' : 'absent') : 'unknown',
          'suite-uncalled-named-v8-entry-count', count, 'named-v8-entries', known ? t.coverage.observedNamedFunctions : null)],
      }), t.path);
      if (!uncoveredPaths.includes(t.path)) continue;
      // Positive witnesses only, not complete fan-in. All facts from this
      // original pre-execution scan retain the same whole observation root.
      const edges = collection.dependencyAudit.edges.filter((e) => e.toPath === t.path
        && /^(src|worker|shared)\//.test(e.fromPath));
      assert(edges.every((e) => Object.hasOwn(component.sourceBindings, e.fromPath)), 'dependency fact crosses component');
      const importers = unique(edges.map((e) => e.fromPath));
      if (importers.length) addFacts(observation('fact-source', sourcePaths, [collection.dependencyAudit.auditSha256], {
        auditSha256: collection.dependencyAudit.auditSha256, targetPath: t.path,
        scope: 'positive production importer witnesses in original bounded static scan; not complete fan-in', edges,
        facts: [fact(`dependency:${t.path}`, 'dependency', 'present', 'bounded-production-importer-witness-count',
          importers.length, 'source-files')],
      }), t.path);
    }
    receipts.push({ anchorId: anchor.case_id, packetArtifactSha256: packetArtifact.artifactSha256,
      changeArtifactSha256: change.artifactSha256, artifacts, factPool, relationships: [] });
    decisions.push({ anchorId: anchor.case_id, observationSha256: run.observationSha256,
      hypothesisPaths: uncoveredPaths, unknownCoveragePaths: targets.filter((t) => t.coverage.state === 'unknown').map((t) => t.path),
      scope: 'suite-level binding; not an individual test measurement' });
  }
  const body = { schemaVersion: 1, kind: 'm11-offline-observations', inventorySha256: inventory.manifest_sha256,
    sourceRevision: collection.sourceRevision,
    clusters: closure.components.map((c) => ({ cluster: c.component, complete: true, sourceBindings: c.sourceBindings })), receipts };
  const observations = { ...body, bundleSha256: m11Digest(body) };
  const materialization = await materializeM11Development({ inventory, expectedInventorySha256, observations,
    readSource: async (p) => { assert(verified.has(p), 'unverified source requested'); return verified.get(p); } });
  const result = { schemaVersion: 1, kind: 'm11-saved-observation-bridge', bridgeVersion: '0.1',
    originalInventorySha256: oldSha, inventorySha256: inventory.manifest_sha256,
    collectionSha256: collection.collectionSha256, closureSha256: closure.closureSha256,
    lineageScope: 'current-receipts-only; disjoint observation roots are not statistical independence',
    futureObservationLineageComplete: false, newEmpiricalRuns: 0,
    decisions, observations, materialization };
  return freeze({ ...result, bridgeSha256: m11Digest(result) });
}
