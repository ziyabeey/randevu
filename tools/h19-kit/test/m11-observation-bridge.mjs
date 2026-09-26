import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeCases } from '../src/experiments/freeze.mjs';
import { m11Digest, m11SourceBlobSha, freezeM11Observation, m11FactFromObservation } from '../src/experiments/m11-materializer.mjs';
import { freezeM11Snapshot, m11GitTreeSha, buildM11DependencyClosure, refreezeM11Inventory } from '../src/experiments/m11-closure.mjs';
import { auditM11CollectionSources, summarizeM11Tap, summarizeM11V8Coverage } from '../src/experiments/m11-collection.mjs';
import { bridgeM11Observations } from '../src/experiments/m11-observation-bridge.mjs';
import { composeRelationalCaseBatch, validateRelationalCaseBatch } from '../src/relations/relational-case-composer.mjs';

// Declared synthetic measurements, never empirical pilot evidence. Throwing
// sources expose accidental execution by this offline adapter.
const files = {
  'tests/page.mjs': "import '../worker/page.ts'; throw Error('alpha beta');\n",
  'tests/ui.mjs': "import { readFileSync } from 'node:fs'; readFileSync(new URL('../src/ui.ts', import.meta.url)); throw Error('ui');\n",
  'tests/eval.mjs': "throw Error('evaluation must never execute: heldout');\n",
  'worker/page.ts': "import './consumer.ts'; export function called() { return 1; } export function uncalled() { return 2; }\n",
  'worker/consumer.ts': "import { called } from './page.ts'; export const use = () => called();\n",
  'src/ui.ts': "import '../worker/page.ts'; export const text = 'ölçüm';\n",
  'src/eval.ts': 'export const heldout = true;\n',
  'package.json': '{"dependencies":{}}', 'package-lock.json': '{"lockfileVersion":3,"packages":{}}',
  'tsconfig.json': '{"compilerOptions":{"moduleResolution":"Bundler"}}',
  'tsconfig.app.json': '{"extends":"./tsconfig.json"}', 'tsconfig.worker.json': '{"extends":"./tsconfig.json"}',
  'tsconfig.node.json': '{"extends":"./tsconfig.json"}',
  'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({});", 'wrangler.jsonc': '{}',
};
const seal = (x, key) => { const { [key]: ignored, ...body } = x; return { ...body, [key]: m11Digest(body) }; };
const entries = Object.entries(files).map(([p, text]) => ({ path: p, mode: '100644', gitBlobSha: m11SourceBlobSha(text) }));
const snapshot = freezeM11Snapshot(entries, 'a'.repeat(40), m11GitTreeSha(entries));
const rows = [['a', 'page', 'alpha', 'worker/page.ts'], ['b', 'page', 'beta', 'worker/page.ts'],
  ['c', 'ui', 'ui', 'src/ui.ts'], ['d', 'eval', 'heldout', 'src/eval.ts']].map(([id, group, name, target]) => ({
  case_id: id, cluster: group, split: group === 'eval' ? 'evaluation' : 'development',
  referenceSuite: `tests/${group}.mjs`, referenceTest: name, referenceEvidenceKind: group === 'ui' ? 'source-contract' : 'unit-runtime',
  targets: [target], inputStatus: 'pending-materialization', packetSha256: null, relationalCaseSha256: null,
  relationLabel: null, independentOutcome: null, changeArtifactSha256: null,
}));
const roots = new Set(rows.flatMap((r) => [r.referenceSuite, ...r.targets]));
const originalInventory = freezeCases(rows, { experimentId: 'synthetic-bridge-contract', protocolVersion: '0.1', metadata: {
  manifestRole: 'scenario-anchor-inventory', referenceSuitesAreGroundTruth: false, sourceRevision: snapshot.sourceRevision,
  toolRevision: 'b'.repeat(40), sources: Object.fromEntries(entries.filter((e) => roots.has(e.path)).map((e) => [e.path, { gitBlobSha: e.gitBlobSha }])),
} });
const closure = await buildM11DependencyClosure({ inventory: originalInventory, expectedInventorySha256: originalInventory.manifest_sha256,
  snapshot, expectedSnapshotSha256: snapshot.snapshotSha256, readSource: async (p) => files[p] });
const inventory = refreezeM11Inventory({ inventory: originalInventory, expectedInventorySha256: originalInventory.manifest_sha256, closure });
const sourceBindings = closure.components.find((c) => c.split === 'development').sourceBindings;
const recipe = seal({ schemaVersion: 1, kind: 'm11-collection-recipe', inventorySha256: originalInventory.manifest_sha256,
  sourceRevision: snapshot.sourceRevision, sourceBindings, referenceSuites: ['tests/page.mjs', 'tests/ui.mjs'] }, 'recipeSha256');
const { audit: dependencyAudit } = await auditM11CollectionSources({ inventory: originalInventory,
  expectedInventorySha256: originalInventory.manifest_sha256, recipe, readSource: async (p) => files[p] });
const runs = recipe.referenceSuites.map((suite) => {
  const controls = rows.filter((r) => r.referenceSuite === suite);
  const stdout = controls.map((r, i) => `# Subtest: ${r.referenceTest}\nok ${i + 1} - ${r.referenceTest}\n`).join('')
    + `# tests ${controls.length}\n# pass ${controls.length}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
  const v8Entries = suite.includes('page') ? [{ functions: [{ functionName: 'called', ranges: [{ startOffset: 10, endOffset: 30, count: 1 }] },
    { functionName: 'uncalled', ranges: [{ startOffset: 31, endOffset: 50, count: 0 }] }] }] : [];
  return seal({ schemaVersion: 1, kind: 'm11-development-suite-observation', inventorySha256: originalInventory.manifest_sha256,
    sourceRevision: snapshot.sourceRevision, recipeSha256: recipe.recipeSha256, sourceBindings, runtime: 'v24.19.0',
    command: ['node', '--test', '--test-reporter=tap', suite], environment: { NODE_OPTIONS: '', NODE_V8_COVERAGE: 'isolated-temporary-directory' },
    exitCode: 0, stdout, stderr: '', testSummary: summarizeM11Tap(stdout), targets: [{ path: controls[0].targets[0],
      gitBlobSha: sourceBindings[controls[0].targets[0]], evidenceKinds: [controls[0].referenceEvidenceKind],
      v8Entries, coverage: summarizeM11V8Coverage(v8Entries) }] }, 'observationSha256');
});
const collection = seal({ schemaVersion: 1, kind: 'm11-development-collection', inventorySha256: originalInventory.manifest_sha256,
  sourceRevision: snapshot.sourceRevision, recipeSha256: recipe.recipeSha256, dependencyAudit, runs }, 'collectionSha256');
const inputs = { originalInventory, inventory, snapshot, closure, recipe, collection,
  expectedInventorySha256: inventory.manifest_sha256, expectedCollectionSha256: collection.collectionSha256 };
const requested = [];
const readSource = async (p) => { assert(!p.includes('eval'), 'evaluation bytes must not be read'); requested.push(p); return files[p]; };
const result = await bridgeM11Observations({ ...inputs, readSource });
assert.deepEqual(result.materialization.counts, { anchors: 3, materializedAnchors: 2, skippedAnchors: 1,
  uniquePackets: 2, uniqueBatches: 2, uniqueCases: 1 });
assert.equal(requested.length, new Set(requested).size, 'source bytes are snapshotted once');
assert.equal(result.materialization.rows.find((r) => r.anchorId === 'c').reason, 'no-hypotheses');
assert.equal(result.materialization.relationalCases[0].facts.find((f) => f.family === 'dependency').value, 2);
assert.equal(result.materialization.relationalCases[0].facts.find((f) => f.family === 'coverage').denominator, 2);
assert(result.materialization.packets.every((p) => p.changedFiles.length === 0 && !p.safeToNarrow));
assert(Object.isFrozen(result.observations.receipts[0].artifacts[0].payload));
assert.equal(result.newEmpiricalRuns, 0);
const mutable = structuredClone(inputs);
assert.deepEqual(await bridgeM11Observations({ ...mutable, readSource: async (p) => { mutable.collection.runs.length = 0; return readSource(p); } }), result);
await assert.rejects(bridgeM11Observations({ ...inputs, expectedCollectionSha256: '0'.repeat(64), readSource }), /collectionSha256 identity/);
await assert.rejects(bridgeM11Observations({ ...inputs, expectedInventorySha256: '0'.repeat(64), readSource }), /inventory identity/);
await assert.rejects(bridgeM11Observations({ ...inputs, readSource: async (p) => files[p] + ' ' }), /source identity/);
for (const [edit, error] of [
  [(x) => { x.collection.runs[0].targets[0].coverage.calledNamedFunctions = 99; }, /V8 summary/],
  [(x) => { x.collection.runs[0].testSummary.pass = 99; }, /TAP summary/],
  [(x) => { x.collection.runs[0].sourceRevision = 'c'.repeat(40); }, /run ancestry/],
  [(x) => { x.collection.runs[0].command[3] = 'tests/eval.mjs'; }, /invalid or duplicate/],
  [(x) => { x.collection.runs.push(x.collection.runs[0]); }, /run set/],
  [(x) => { x.collection.runs[0].targets[0].gitBlobSha = 'c'.repeat(40); }, /target source/],
]) {
  const x = structuredClone(inputs); edit(x);
  x.collection.runs = x.collection.runs.map((r) => seal(r, 'observationSha256'));
  x.collection = seal(x.collection, 'collectionSha256'); x.expectedCollectionSha256 = x.collection.collectionSha256;
  await assert.rejects(bridgeM11Observations({ ...x, readSource }), error);
}
const badClosure = structuredClone(closure); badClosure.components[0].sourceBindings = {};
await assert.rejects(bridgeM11Observations({ ...inputs, closure: badClosure, readSource }), /closureSha256 identity/);
const badAudit = structuredClone(inputs);
badAudit.collection.dependencyAudit.edges = [];
badAudit.collection.dependencyAudit = seal(badAudit.collection.dependencyAudit, 'auditSha256');
badAudit.collection = seal(badAudit.collection, 'collectionSha256');
badAudit.expectedCollectionSha256 = badAudit.collection.collectionSha256;
await assert.rejects(bridgeM11Observations({ ...badAudit, readSource }), /static observation replay/);
const extraInput = structuredClone(inputs);
extraInput.recipe.sourceBindings = { ...extraInput.recipe.sourceBindings, 'src/eval.ts': m11SourceBlobSha(files['src/eval.ts']) };
extraInput.recipe = seal(extraInput.recipe, 'recipeSha256');
extraInput.collection.recipeSha256 = extraInput.recipe.recipeSha256;
extraInput.collection.dependencyAudit = seal({ ...extraInput.collection.dependencyAudit,
  recipeSha256: extraInput.recipe.recipeSha256, sourceBindings: extraInput.recipe.sourceBindings }, 'auditSha256');
extraInput.collection = seal(extraInput.collection, 'collectionSha256');
extraInput.expectedCollectionSha256 = extraInput.collection.collectionSha256;
await assert.rejects(bridgeM11Observations({ ...extraInput, readSource }), /outside development closure/);

// A test fact and coverage fact from the same saved run cannot satisfy M9,
// even when put through a new wrapper and given a different evidence family.
const receipt = result.observations.receipts[0];
const coverage = receipt.artifacts.find((a) => a.kind === 'fact-source' && a.payload.facts[0].family === 'coverage');
const { artifactSha256, ...body } = coverage;
const testSource = freezeM11Observation({ ...body, payload: { facts: [{ ...coverage.payload.facts[0],
  factId: 'test:pass', family: 'test', metricId: 'suite-passing-tests', value: 2, denominator: null, unit: 'tests' }] } });
const duplicate = composeRelationalCaseBatch({ packet: receipt.artifacts.find((a) => a.kind === 'm5-packet').payload.packet,
  factPool: [receipt.factPool.find((f) => f.fact.family === 'coverage'),
    { fact: m11FactFromObservation(testSource, 'test:pass'), scope: { kind: 'path', path: 'worker/page.ts' } }] });
assert.equal(duplicate.relationalCases.length, 0);
assert.equal(duplicate.batch.skipped[0].reason, 'insufficient-independent-families');

const names = { originalInventory: 'COHORT-v0.1.json', inventory: 'COHORT-v0.2.json', snapshot: 'SOURCE-SNAPSHOT-001.json',
  closure: 'REPOSITORY-CLOSURE-001.json', recipe: 'COLLECTION-RECIPE-001.json', collection: 'DEVELOPMENT-COLLECTION-001.json' };
const temp = await mkdtemp(path.join(tmpdir(), 'm11-bridge-'));
try {
  const sourceRoot = path.join(temp, 'source');
  for (const [p, text] of Object.entries(files)) { const dst = path.join(sourceRoot, p); await mkdir(path.dirname(dst), { recursive: true }); await writeFile(dst, text); }
  for (const [key, file] of Object.entries(names)) await writeFile(path.join(temp, file), JSON.stringify(inputs[key]));
  const cli = fileURLToPath(new URL('../bin/h19-m11-bridge.mjs', import.meta.url));
  const args = [cli, temp, inventory.manifest_sha256, collection.collectionSha256, sourceRoot];
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 })), result);
  args[3] = '0'.repeat(64);
  const invalid = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 });
  assert.notEqual(invalid.status, 0); assert.equal(invalid.stdout, '');
} finally { await rm(temp, { recursive: true, force: true }); }

// Authenticate the retained real result and replay the unchanged M9 selector.
// Raw TAP/V8 is historical evidence; no product suite is rerun by this test.
const dir = new URL('../experiments/m11/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const [saved, savedCollection, savedClosure] = await Promise.all(['DEVELOPMENT-BRIDGE-001.json',
  'DEVELOPMENT-COLLECTION-001.json', 'REPOSITORY-CLOSURE-001.json'].map(load));
assert.deepEqual(seal(saved, 'bridgeSha256'), saved);
assert.equal(saved.collectionSha256, savedCollection.collectionSha256);
assert.equal(saved.closureSha256, savedClosure.closureSha256);
assert.deepEqual(seal(saved.observations, 'bundleSha256'), saved.observations);
assert.deepEqual(seal(saved.materialization, 'manifestSha256'), saved.materialization);
assert.deepEqual(saved.materialization.counts, { anchors: 22, materializedAnchors: 5, skippedAnchors: 17,
  uniquePackets: 2, uniqueBatches: 2, uniqueCases: 1 });
for (const r of saved.observations.receipts) {
  const packet = r.artifacts.find((a) => a.artifactSha256 === r.packetArtifactSha256).payload.packet;
  for (const a of r.artifacts) assert.deepEqual(freezeM11Observation(a), a);
  for (const entry of r.factPool) {
    const a = r.artifacts.find((a) => a.artifactSha256 === entry.fact.provenance.inputDigest);
    assert.deepEqual(m11FactFromObservation(a, entry.fact.factId), entry.fact);
    if (entry.fact.family === 'coverage') {
      const run = savedCollection.runs.find((r) => r.observationSha256 === a.rootDigests[0]); assert(run);
      const target = run.targets.find((t) => t.path === entry.scope.path);
      const summary = summarizeM11V8Coverage(target.v8Entries);
      assert.deepEqual(a.payload.coverage, summary);
      assert.equal(entry.fact.value, summary.state === 'observed' ? summary.uncalledNamedFunctions.length : null);
    } else {
      assert.deepEqual(a.rootDigests, [savedCollection.dependencyAudit.auditSha256]);
      const edges = savedCollection.dependencyAudit.edges.filter((e) => e.toPath === entry.scope.path && /^(src|worker|shared)\//.test(e.fromPath));
      assert.deepEqual(a.payload.edges, edges); assert.equal(entry.fact.value, new Set(edges.map((e) => e.fromPath)).size);
    }
  }
  const output = composeRelationalCaseBatch({ packet, factPool: r.factPool, relationships: r.relationships });
  const row = saved.materialization.rows.find((row) => row.anchorId === r.anchorId);
  const batch = saved.materialization.batches.find((b) => b.batchSha256 === row.batchSha256);
  assert.deepEqual(output.batch, batch);
  validateRelationalCaseBatch(batch, { packet, factPool: r.factPool, relationships: r.relationships, relationalCases: output.relationalCases });
  output.relationalCases.forEach((c) => assert.deepEqual(c, saved.materialization.relationalCases.find((x) => x.caseSha256 === c.caseSha256)));
}
console.log('M11 bridge: saved-root provenance, source split, TAP/V8 replay, baseline/unknown semantics, duplicate-vote rejection, CLI and real M9 replay PASS');
