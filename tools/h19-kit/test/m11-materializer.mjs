import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { freezeCases } from '../src/experiments/freeze.mjs';
import { discoverCoverageHypotheses } from '../src/discovery/coverage-discovery.mjs';
import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import { composeRelationalCaseBatch, freezeComposerRelationship } from '../src/relations/relational-case-composer.mjs';
import {
  m11Digest, m11SourceBlobSha, freezeM11Observation, m11FactFromObservation,
  materializeM11Development, validateM11Materialization,
} from '../src/experiments/m11-materializer.mjs';

// Synthetic contract fixtures only; these are not pilot measurements or labels.
const revision = 'a'.repeat(40);
const files = {
  'src/a.ts': 'export const value = 1; // ölçüm\n',
  'tests/a.mjs': 'test("alpha", () => {}); test("beta", () => {});\n',
  'src/z.ts': 'export const other = 2;\n',
  'tests/z.mjs': 'test("held-out", () => {});\n',
  'src/related.ts': 'export const related = 3;\n',
};
const blobs = Object.fromEntries(Object.entries(files).map(([p, bytes]) => [p, m11SourceBlobSha(bytes)]));
const anchor = (id, split, name, target, suite, cluster) => ({
  case_id: id, split, referenceTest: name, targets: [target], referenceSuite: suite, cluster,
  inputStatus: 'pending-materialization', changeArtifactSha256: null, packetSha256: null,
  relationalCaseSha256: null, relationLabel: null, independentOutcome: null,
});
const inventory = freezeCases([
  anchor('D1', 'development', 'alpha', 'src/a.ts', 'tests/a.mjs', 'dev'),
  anchor('D2', 'development', 'beta', 'src/a.ts', 'tests/a.mjs', 'dev'),
  anchor('E1', 'evaluation', 'held-out', 'src/z.ts', 'tests/z.mjs', 'eval'),
], {
  experimentId: 'M11-CONTRACT-TEST', protocolVersion: '0.1',
  metadata: { manifestRole: 'scenario-anchor-inventory', referenceSuitesAreGroundTruth: false,
    sourceRevision: revision, toolRevision: 'b'.repeat(40),
    sources: Object.fromEntries(Object.entries(blobs).map(([p, gitBlobSha]) => [p, { gitBlobSha }])) },
});
const expectedInventorySha256 = inventory.manifest_sha256;
const artifact = (kind, payload, root = kind, sourcePaths = ['src/a.ts']) => freezeM11Observation({
  schemaVersion: 1, kind, producer: 'contract-fixture', producerVersion: '1',
  sourceRevision: revision, sourcePaths, rootDigests: [m11Digest({ root })], payload,
});
const seal = (body) => ({ ...body, bundleSha256: m11Digest(body) });
const reseal = (bundle) => { const { bundleSha256, ...body } = bundle; return seal(body); };
const readPaths = [];
const options = (observations = null) => ({ inventory, expectedInventorySha256, observations,
  readSource: async (p) => { readPaths.push(p); assert.ok(!p.includes('/z.'), 'evaluation content read'); return Buffer.from(files[p]); } });

function fixture({ sharedLineage = false, hypothesisCount = 1, empty = false } = {}) {
  const impact = { changedFiles: ['src/a.ts'], unknowns: [], safeToNarrow: false,
    symbolImpact: { report: { uncoveredPaths: ['src/a.ts'] } } };
  const discovery = discoverCoverageHypotheses({ impact });
  const hypotheses = empty ? [] : Array.from({ length: hypothesisCount }, (_, i) => ({
    ...discovery.hypotheses[0], id: `h:${String(i).padStart(2, '0')}`,
    target: { kind: 'semantic-unit', path: 'src/a.ts', unitId: `a:${i}` },
  }));
  const packet = freezeCoverageDiscoveryPacket({ changeId: 'fixture-change', sourceRevision: revision,
    impact, discovery: { hypotheses } });
  const packetSource = artifact('m5-packet', { packet });
  const changeSource = artifact('change', { mode: 'change', changeId: packet.changeId, changedFiles: impact.changedFiles });
  const observedFact = (factId, family) => ({ factId, family, state: 'present',
    metricId: `fixture.${family}.count`, value: 1, unit: 'count', sampleSize: 1,
    denominator: null, baseline: null, evidenceIds: [`fixture:${family}`] });
  const coverage = artifact('fact-source', { facts: [observedFact('coverage', 'coverage')] }, 'coverage-run');
  const history = artifact('fact-source', { facts: [observedFact('history', 'history')] },
    sharedLineage ? 'coverage-run' : 'history-window');
  const factPool = [coverage, history].map((a) => ({
    fact: m11FactFromObservation(a, a.payload.facts[0].factId), scope: { kind: 'path', path: 'src/a.ts' },
  }));
  const receipt = { anchorId: 'D1', packetArtifactSha256: packetSource.artifactSha256,
    changeArtifactSha256: changeSource.artifactSha256,
    artifacts: [packetSource, changeSource, coverage, history], factPool, relationships: [] };
  const bundle = seal({ schemaVersion: 1, kind: 'm11-offline-observations',
    inventorySha256: expectedInventorySha256, sourceRevision: revision,
    clusters: [
      { cluster: 'dev', complete: true, sourceBindings: { 'src/a.ts': blobs['src/a.ts'], 'tests/a.mjs': blobs['tests/a.mjs'] } },
      { cluster: 'eval', complete: true, sourceBindings: { 'src/z.ts': blobs['src/z.ts'], 'tests/z.mjs': blobs['tests/z.mjs'] } },
    ], receipts: [receipt] });
  return { bundle, receipt, packet, factPool };
}

// Missing observations stay missing; development source verification never reads evaluation bytes.
const readiness = await materializeM11Development(options());
assert.deepEqual(readiness.counts, { anchors: 2, materializedAnchors: 0, skippedAnchors: 2,
  uniquePackets: 0, uniqueBatches: 0, uniqueCases: 0 });
assert.ok(readiness.rows.every((r) => r.reason === 'missing-observations' && r.packetSha256 === null));
assert.deepEqual([...new Set(readPaths)].sort(), ['src/a.ts', 'tests/a.mjs']);
assert.equal(readiness.lineageClosure, 'not-supplied');
{
  const mutableInventory = structuredClone(inventory);
  const snapshot = await materializeM11Development({ ...options(), inventory: mutableInventory,
    readSource: async (p) => {
      mutableInventory.cases[0].case_id = 'mutated-after-validation';
      return files[p];
    } });
  assert.deepEqual(snapshot, readiness);
}

// A genuine producer-shaped fixture reaches the existing M9 contract with identical identities.
const valid = fixture();
const before = JSON.stringify(valid.bundle);
const result = await materializeM11Development(options(valid.bundle));
const direct = composeRelationalCaseBatch({ packet: valid.packet, factPool: valid.factPool });
assert.deepEqual(result.relationalCases, direct.relationalCases);
assert.equal(result.batches[0].batchSha256, direct.batch.batchSha256);
assert.equal(result.rows[0].status, 'materialized');
assert.equal(result.rows[1].reason, 'missing-observations');
assert.equal(result.counts.uniqueCases, 1);
assert.equal(JSON.stringify(valid.bundle), before);
assert.ok(Object.isFrozen(result) && Object.isFrozen(result.rows[0]) && Object.isFrozen(result.relationalCases[0]));
assert.deepEqual(await materializeM11Development(options(valid.bundle)), result);
await validateM11Materialization(result, options(valid.bundle));
await assert.rejects(validateM11Materialization({ ...result, counts: { ...result.counts, uniqueCases: 100 } },
  options(valid.bundle)), /bound input replay/);

// Sharing one packet across two controls does not create two unique experiments.
{
  const b = structuredClone(valid.bundle);
  b.receipts.push({ ...structuredClone(b.receipts[0]), anchorId: 'D2' });
  const r = await materializeM11Development(options(reseal(b)));
  assert.equal(r.counts.materializedAnchors, 2);
  assert.equal(r.counts.uniqueCases, 1);
  assert.equal(r.counts.uniquePackets, 1);
}
// Input-order changes keep the frozen M9 decisions; the outer manifest still binds its input receipt.
{
  const b = structuredClone(valid.bundle);
  b.receipts[0].factPool.reverse();
  const r = await materializeM11Development(options(reseal(b)));
  assert.deepEqual(r.relationalCases, result.relationalCases);
  assert.equal(r.batches[0].batchSha256, result.batches[0].batchSha256);
}
// Two fact families derived from the same observation do not pass the independence floor.
{
  const r = await materializeM11Development(options(fixture({ sharedLineage: true }).bundle));
  assert.equal(r.counts.uniqueCases, 0);
  assert.equal(r.rows[0].reason, 'no-eligible-cases');
  assert.equal(r.rows[0].hypothesisSkips[0].reason, 'insufficient-independent-families');
}
{
  const r = await materializeM11Development(options(fixture({ empty: true }).bundle));
  assert.equal(r.rows[0].reason, 'no-hypotheses');
  assert.equal(r.counts.uniquePackets, 1);
  assert.equal(r.counts.uniqueCases, 0);
}
{
  const r = await materializeM11Development(options(fixture({ hypothesisCount: 21 }).bundle));
  assert.equal(r.counts.uniqueCases, 20);
  assert.equal(r.rows[0].hypothesisSkips.filter((s) => s.reason === 'batch-cap').length, 1);
}

async function rejectsMutation(mutate, pattern) {
  const b = structuredClone(valid.bundle);
  mutate(b);
  await assert.rejects(materializeM11Development(options(reseal(b))), pattern);
}
await rejectsMutation((b) => { b.receipts[0].anchorId = 'E1'; }, /development anchor/);
await rejectsMutation((b) => { b.receipts.push(structuredClone(b.receipts[0])); }, /duplicate anchor/);
await rejectsMutation((b) => { b.sourceRevision = 'c'.repeat(40); }, /identity mismatch/);
await rejectsMutation((b) => { b.inventorySha256 = '0'.repeat(64); }, /identity mismatch/);
await rejectsMutation((b) => { b.clusters[0].complete = false; }, /complete producer closure/);
await rejectsMutation((b) => { b.clusters.pop(); }, /full split closure/);
await rejectsMutation((b) => { b.clusters[0].sourceBindings['src/z.ts'] = blobs['src/z.ts']; }, /crosses evaluation/);
await rejectsMutation((b) => { b.receipts[0].factPool[0].fact.value = 999; }, /differs from observation/);
await rejectsMutation((b) => { b.receipts[0].factPool[0].fact.lineageIds = [m11Digest('different')]; }, /differs from observation/);
await rejectsMutation((b) => {
  b.receipts[0].factPool[0].fact.provenance.inputDigest = '0'.repeat(64);
  delete b.receipts[0].factPool[0].fact.provenance.provenanceDigest;
}, /no bound observation/);
await rejectsMutation((b) => { b.receipts[0].artifacts[0].payload.packet.changeId = 'tampered'; }, /observation digest/);
await rejectsMutation((b) => { b.receipts[0].artifacts[0].payload.relationLabel = 'strengthens'; }, /label or provider/);
await rejectsMutation((b) => { b.receipts[0].artifacts[0].payload.probabilities = {}; }, /label or provider/);
await rejectsMutation((b) => { b.receipts[0].artifacts[0].payload.outcome = 'confirmed'; }, /label or provider/);
await rejectsMutation((b) => { b.receipts[0].artifacts.push(b.receipts[0].artifacts[0]); }, /duplicate observation/);
await rejectsMutation((b) => {
  const original = b.receipts[0].artifacts[0];
  const { artifactSha256, ...body } = original;
  const stale = freezeM11Observation({ ...body, sourceRevision: 'c'.repeat(40) });
  b.receipts[0].artifacts[0] = stale;
  b.receipts[0].packetArtifactSha256 = stale.artifactSha256;
}, /stale observation/);
await assert.rejects(materializeM11Development({ ...options(), expectedInventorySha256: '0'.repeat(64) }), /inventory identity/);
await assert.rejects(materializeM11Development({ ...options(), readSource: async () => 'wrong bytes' }), /pinned blob/);
const changedInventory = structuredClone(inventory);
changedInventory.cases[0].targets = ['src/z.ts'];
await assert.rejects(materializeM11Development({ ...options(), inventory: changedInventory }), /inventory identity/);
const injected = { ...valid.bundle, extra: true };
await assert.rejects(materializeM11Development(options(injected)), /bundle digest/);

// Related-path facts require both the recorded graph observation and its exact relation binding.
{
  const b = structuredClone(valid.bundle);
  b.clusters[0].sourceBindings['src/related.ts'] = blobs['src/related.ts'];
  const receipt = b.receipts[0];
  const { artifactSha256, ...oldHistory } = receipt.artifacts[3];
  const history = freezeM11Observation({ ...oldHistory, sourcePaths: ['src/related.ts'] });
  receipt.artifacts[3] = history;
  const graph = artifact('relationship-source', {
    kind: 'reference', fromPath: 'src/a.ts', toPath: 'src/related.ts',
  }, 'graph-input', ['src/a.ts', 'src/related.ts']);
  const relation = freezeComposerRelationship({ ...graph.payload, sourceId: graph.artifactSha256 });
  receipt.artifacts.push(graph);
  receipt.relationships.push(relation);
  receipt.factPool[1] = { fact: m11FactFromObservation(history, 'history'),
    scope: { kind: 'related-path', path: 'src/related.ts', relationDigest: relation.relationDigest } };
  const r = await materializeM11Development(options(reseal(b)));
  assert.equal(r.counts.uniqueCases, 1);
  assert.equal(r.batches[0].cases[0].selectedScopes.find((s) => s.factId === 'history').relationDigest,
    relation.relationDigest);
  receipt.artifacts.pop();
  await assert.rejects(materializeM11Development(options(reseal(b))), /relationship has no bound/);
}

// Unknown observations remain null through materialization, rather than becoming numeric zero.
{
  const b = structuredClone(valid.bundle);
  const receipt = b.receipts[0];
  const { artifactSha256, ...body } = receipt.artifacts[2];
  body.payload.facts[0].state = 'unknown';
  body.payload.facts[0].value = null;
  const coverage = freezeM11Observation(body);
  receipt.artifacts[2] = coverage;
  receipt.factPool[0].fact = m11FactFromObservation(coverage, 'coverage');
  const r = await materializeM11Development(options(reseal(b)));
  assert.equal(r.relationalCases[0].facts.find((f) => f.factId === 'coverage').value, null);
}

// CLI uses the same offline contract and leaves malformed inputs without a JSON result.
const dir = await mkdtemp(path.join(tmpdir(), 'h19-m11-'));
try {
  for (const [p, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), bytes);
  }
  const inventoryPath = path.join(dir, 'inventory.json');
  await writeFile(inventoryPath, JSON.stringify(inventory));
  const cli = fileURLToPath(new URL('../bin/h19-m11-materialize.mjs', import.meta.url));
  const args = [cli, inventoryPath, expectedInventorySha256, dir];
  const successful = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(successful.status, 0, successful.stderr);
  assert.deepEqual(JSON.parse(successful.stdout), readiness);
  const invalid = path.join(dir, 'bad.json');
  await writeFile(invalid, '{"secret-test-value":');
  const failed = spawnSync(process.execPath, [...args, invalid], { encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.equal(failed.stdout, '');
  assert.match(failed.stderr, /invalid JSON input/);
  assert.doesNotMatch(failed.stderr, /secret-test-value/);
} finally {
  await rm(dir, { recursive: true, force: true });
}

// The committed pilot retains 24 anchors and no labels; this suite does not infer any.
const realInventory = JSON.parse(await readFile(new URL('../experiments/m11/COHORT-v0.1.json', import.meta.url), 'utf8'));
assert.equal(realInventory.cases.filter((r) => r.split === 'development').length, 12);
assert.ok(realInventory.cases.every((r) => r.relationLabel === null && r.independentOutcome === null));
const savedReadiness = JSON.parse(await readFile(new URL('../experiments/m11/DEVELOPMENT-READINESS-001.json', import.meta.url), 'utf8'));
const { manifestSha256, ...savedBody } = savedReadiness;
assert.equal(m11Digest(savedBody), manifestSha256);
assert.equal(savedReadiness.inventorySha256, realInventory.manifest_sha256);
assert.equal(savedReadiness.sourceRevision, realInventory.metadata.sourceRevision);
assert.deepEqual(savedReadiness.rows.map((r) => r.anchorId).sort(),
  realInventory.cases.filter((r) => r.split === 'development').map((r) => r.case_id).sort());
assert.equal(savedReadiness.counts.anchors, 12);
assert.equal(savedReadiness.counts.skippedAnchors, 12);
assert.equal(savedReadiness.counts.uniqueCases, 0);
assert.ok(savedReadiness.rows.every((r) => r.reason === 'missing-observations'));
for (const [p, sha] of Object.entries(savedReadiness.sourceBindings)) {
  assert.equal(sha, realInventory.metadata.sources[p].gitBlobSha);
}
console.log('h19-kit M11 offline materializer smoke: ok (synthetic contract fixtures; no empirical labels)');
