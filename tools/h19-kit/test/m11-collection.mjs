import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeCases } from '../src/experiments/freeze.mjs';
import { materializeM11Development, m11Digest, m11SourceBlobSha } from '../src/experiments/m11-materializer.mjs';
import { auditM11CollectionSources, summarizeM11Tap, summarizeM11V8Coverage } from '../src/experiments/m11-collection.mjs';

const files = {
  'dev.mjs': "import test from 'node:test'; import { f } from './dev-target.mjs'; test('dev control', () => f());\n",
  'eval.mjs': "import { writeFileSync } from 'node:fs'; writeFileSync('EVALUATION-RAN', 'bad');\n",
  'dev-target.mjs': "import { value } from './shared.mjs'; export function f() { return value; }\n",
  'eval-target.mjs': "// import './decoy.mjs';\nimport { value } from './shared.mjs'; export { value };\n",
  'shared.mjs': "export const value = 'Türkçe';\n",
  'decoy.mjs': 'export const decoy = true;\n',
};
const bindings = Object.fromEntries(Object.entries(files).map(([p, s]) => [p, m11SourceBlobSha(s)]));
const cases = ['dev', 'eval'].map((id) => ({ case_id: id, cluster: id,
  split: id === 'dev' ? 'development' : 'evaluation', referenceSuite: `${id}.mjs`,
  referenceTest: `${id} control`, referenceEvidenceKind: 'unit-runtime', targets: [`${id}-target.mjs`],
  inputStatus: 'pending-materialization', packetSha256: null, relationalCaseSha256: null,
  relationLabel: null, independentOutcome: null, changeArtifactSha256: null }));
const inventory = freezeCases(cases, { experimentId: 'fixture', protocolVersion: '1', metadata: {
  manifestRole: 'scenario-anchor-inventory', referenceSuitesAreGroundTruth: false,
  sourceRevision: 'a'.repeat(40), toolRevision: 'b'.repeat(40),
  sources: Object.fromEntries(Object.entries(bindings).filter(([p]) => !['shared.mjs', 'decoy.mjs'].includes(p))
    .map(([p, gitBlobSha]) => [p, { gitBlobSha }])),
} });
const seal = (body) => ({ ...body, recipeSha256: m11Digest(body) });
const recipeBody = { schemaVersion: 1, kind: 'm11-collection-recipe', inventorySha256: inventory.manifest_sha256,
  sourceRevision: inventory.metadata.sourceRevision, sourceBindings: bindings, referenceSuites: ['dev.mjs'] };
const recipe = seal(recipeBody);
const options = { inventory, expectedInventorySha256: inventory.manifest_sha256, recipe,
  readSource: async (p) => files[p] };
const { audit } = await auditM11CollectionSources(options);
assert.equal(audit.complete, false);
assert.equal(audit.status, 'blocked-cross-split-dependency');
assert.equal(audit.conflicts.length, 1);
assert.equal(audit.conflicts[0].sharedPath, 'shared.mjs');
assert.deepEqual(audit.conflicts[0].developmentRoute, ['dev-target.mjs', 'shared.mjs']);
assert(!audit.edges.some((e) => e.toPath === 'decoy.mjs'), 'comment must not become a dependency');
assert.deepEqual((await auditM11CollectionSources(options)).audit, audit);
const bundleBody = { schemaVersion: 1, kind: 'm11-offline-observations',
  inventorySha256: inventory.manifest_sha256, sourceRevision: inventory.metadata.sourceRevision,
  receipts: [], clusters: ['dev', 'eval'].map((id) => ({ cluster: id, complete: true,
    sourceBindings: Object.fromEntries([`${id}.mjs`, `${id}-target.mjs`, 'shared.mjs'].map((p) => [p, bindings[p]])) })) };
await assert.rejects(materializeM11Development({ ...options,
  observations: { ...bundleBody, bundleSha256: m11Digest(bundleBody) } }), /crosses evaluation boundary/);
await assert.rejects(auditM11CollectionSources({ ...options, readSource: async (p) => files[p] + ' ' }), /source identity/);
await assert.rejects(auditM11CollectionSources({ ...options, recipe: { ...recipe, recipeSha256: '0'.repeat(64) } }), /recipe identity/);
await assert.rejects(auditM11CollectionSources({ ...options, recipe: seal({ ...recipeBody, sourceRevision: 'c'.repeat(40) }) }), /stale/);
await assert.rejects(auditM11CollectionSources({ ...options, recipe: seal({ ...recipeBody, referenceSuites: ['eval.mjs'] }) }), /exactly development/);
await assert.rejects(auditM11CollectionSources({ ...options, recipe: seal({ ...recipeBody,
  sourceBindings: { ...bindings, '../bad': 'd'.repeat(40) } }) }), /source path/);
const noEvaluationBytes = { ...recipeBody, sourceBindings: { ...bindings } };
delete noEvaluationBytes.sourceBindings['eval-target.mjs'];
const incomplete = await auditM11CollectionSources({ ...options, recipe: seal(noEvaluationBytes) });
assert.equal(incomplete.audit.status, 'incomplete-no-conflict-found');
assert.equal(incomplete.audit.complete, false, 'no evidence is never an approved split');
const mutable = structuredClone(recipe);
const snapshot = await auditM11CollectionSources({ ...options, recipe: mutable, readSource: async (p) => {
  mutable.sourceBindings['dev-target.mjs'] = '0'.repeat(40); return files[p];
} });
assert.deepEqual(snapshot.audit, audit, 'snapshot inputs before the first asynchronous read');

const fn = (name, start, end, count) => ({ functionName: name, isBlockCoverage: true,
  ranges: [{ startOffset: start, endOffset: end, count }] });
assert.equal(summarizeM11V8Coverage([]).state, 'unknown');
assert.equal(summarizeM11V8Coverage([]).calledNamedFunctions, null);
const summary = summarizeM11V8Coverage([{ functions: [fn('', 0, 80, 1), fn('same', 1, 10, 0), fn('same', 20, 30, 0)] },
  { functions: [fn('same', 1, 10, 2)] }]);
assert.equal(summary.observedNamedFunctions, 2);
assert.equal(summary.calledNamedFunctions, 1);
assert.deepEqual(summary.uncalledNamedFunctions, [{ name: 'same', startOffset: 20, endOffset: 30 }]);
assert.throws(() => summarizeM11V8Coverage([{ functions: [fn('bad', 0, 2, -1)] }]), /invalid V8 range/);
assert.throws(() => summarizeM11Tap('# tests 0\n'), /TAP pass/);

// Exercise the real CLI on ordinary local fixtures; the evaluation file has a
// marker that would expose accidental execution. These are not pilot evidence.
const temp = await mkdtemp(path.join(tmpdir(), 'm11-collection-test-'));
try {
  await mkdir(path.join(temp, 'source'));
  for (const [p, text] of Object.entries(files)) await writeFile(path.join(temp, 'source', p), text);
  await writeFile(path.join(temp, 'inventory.json'), JSON.stringify(inventory));
  await writeFile(path.join(temp, 'recipe.json'), JSON.stringify(recipe));
  const cli = fileURLToPath(new URL('../bin/h19-m11-collect.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [cli, path.join(temp, 'inventory.json'),
    inventory.manifest_sha256, path.join(temp, 'recipe.json'), path.join(temp, 'source')], { encoding: 'utf8', timeout: 40000 }));
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].testSummary.pass, 1);
  assert.equal(result.runs[0].targets[0].coverage.calledNamedFunctions, 1);
  assert.equal(result.materialization.invoked, false);
  await assert.rejects(access(path.join(temp, 'source', 'EVALUATION-RAN')));
} finally { await rm(temp, { recursive: true, force: true }); }

// Replay saved measurements from their retained raw scoped V8 records. Do not
// rerun the pinned product suite or compare nondeterministic timing in CI.
const saved = JSON.parse(await readFile(new URL('../experiments/m11/DEVELOPMENT-COLLECTION-001.json', import.meta.url), 'utf8'));
const savedRecipe = JSON.parse(await readFile(new URL('../experiments/m11/COLLECTION-RECIPE-001.json', import.meta.url), 'utf8'));
const { recipeSha256, ...savedRecipeBody } = savedRecipe;
assert.equal(m11Digest(savedRecipeBody), recipeSha256);
assert.equal(saved.recipeSha256, recipeSha256);
const { collectionSha256, ...collectionBody } = saved;
assert.equal(m11Digest(collectionBody), collectionSha256);
const { auditSha256, ...auditBody } = saved.dependencyAudit;
assert.equal(m11Digest(auditBody), auditSha256);
assert.equal(saved.dependencyAudit.conflicts.length, 5);
assert.equal(saved.materialization.reason, 'blocked-cross-split-dependency');
assert.equal(saved.materialization.cases, 0);
let passes = 0;
for (const run of saved.runs) {
  const { observationSha256, ...body } = run;
  assert.equal(m11Digest(body), observationSha256);
  assert.equal(run.exitCode, 0);
  assert.deepEqual(run.sourceBindings, savedRecipe.sourceBindings);
  assert.deepEqual(summarizeM11Tap(run.stdout), run.testSummary);
  passes += run.testSummary.pass;
  for (const target of run.targets) assert.deepEqual(summarizeM11V8Coverage(target.v8Entries), target.coverage);
}
assert.equal(passes, 12);
assert.deepEqual(saved.runs.map((r) => r.command.at(-1)).sort(), savedRecipe.referenceSuites);
console.log('M11 collection: dependency witnesses, input identity, V8 unknown/deduplication, development-only CLI and saved receipt replay PASS');
