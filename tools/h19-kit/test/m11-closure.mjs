import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeCases } from '../src/experiments/freeze.mjs';
import { m11Digest, m11SourceBlobSha, validateM11Inventory } from '../src/experiments/m11-materializer.mjs';
import { M11_COMMON_CONTEXT, m11GitTreeSha, freezeM11Snapshot, buildM11DependencyClosure,
  m11ClusterClosures, m11ClosureComponents, refreezeM11Inventory } from '../src/experiments/m11-closure.mjs';

const baseFiles = {
  'tests/a.mjs': "import '../src/a.ts'; throw new Error('a control is metadata, never executed');\n",
  'tests/b.mjs': "import { readFileSync as read } from 'node:fs'; read(new URL('../src/shared.ts', import.meta.url)); // b control\n",
  'tests/c.mjs': "import '../src/c.ts'; // c control\n",
  'src/a.ts': "import type { T } from './types.ts'; import './shared.ts'; export const a = () => import('./cycle.ts');\n",
  'src/b.ts': 'export const b = 1;\n',
  'src/c.ts': 'export const c = 1;\n',
  'src/types.ts': 'export type T = number;\n',
  'src/shared.ts': "export const text = 'İstanbul';\n",
  'src/cycle.ts': "export { a } from './a.ts';\n",
  'package.json': JSON.stringify({ dependencies: { 'fixture-pkg': '1.0.0' } }),
  'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { 'fixture-pkg': '1.0.0' } },
    'node_modules/fixture-pkg': { version: '1.0.0', integrity: 'sha512-fixture' } } }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler' } }),
  'tsconfig.app.json': '{"extends":"./tsconfig.json"}',
  'tsconfig.worker.json': '{"extends":"./tsconfig.json"}',
  'tsconfig.node.json': '{"extends":"./tsconfig.json"}',
  'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({});\n",
  'wrangler.jsonc': '{}',
};
const make = (changes = {}) => {
  const files = { ...baseFiles, ...changes };
  const entries = Object.entries(files).map(([p, text]) => ({ path: p, mode: '100644', gitBlobSha: m11SourceBlobSha(text) }));
  const snapshot = freezeM11Snapshot(entries, 'a'.repeat(40), m11GitTreeSha(entries));
  const cases = ['a', 'b', 'c'].map((id) => ({ case_id: id, cluster: id, split: id === 'a' ? 'development' : 'evaluation',
    referenceSuite: `tests/${id}.mjs`, referenceTest: `${id} control`, referenceEvidenceKind: 'source-contract', targets: [`src/${id}.ts`],
    inputStatus: 'pending-materialization', packetSha256: null, relationalCaseSha256: null,
    relationLabel: null, independentOutcome: null, changeArtifactSha256: null }));
  const roots = new Set(cases.flatMap((c) => [c.referenceSuite, ...c.targets]));
  const inventory = freezeCases(cases, { experimentId: 'fixture', protocolVersion: '0.1-draft', metadata: {
    manifestRole: 'scenario-anchor-inventory', referenceSuitesAreGroundTruth: false, sourceRevision: snapshot.sourceRevision,
    toolRevision: 'b'.repeat(40), sources: Object.fromEntries(entries.filter((e) => roots.has(e.path)).map((e) => [e.path, { gitBlobSha: e.gitBlobSha }])) } });
  return { files, inventory, snapshot, expectedInventorySha256: inventory.manifest_sha256,
    expectedSnapshotSha256: snapshot.snapshotSha256, readSource: async (p) => files[p] };
};
const fixture = make();
const closure = await buildM11DependencyClosure(fixture);
assert.equal(closure.repositoryFileClosureComplete, true);
assert.equal(closure.futureObservationLineageComplete, false);
assert.deepEqual(Object.keys(closure.commonContextBindings), M11_COMMON_CONTEXT);
assert.equal(closure.components.length, 2);
assert.deepEqual(closure.components.find((c) => c.split === 'development').originalClusters, ['a', 'b']);
assert(closure.edges.some((e) => e.kind === 'dynamic-import' && e.toPath === 'src/cycle.ts'));
assert(closure.edges.some((e) => e.kind === 'file-url' && e.toPath === 'src/shared.ts'));
assert(closure.edges.some((e) => e.toPath === 'src/types.ts'));
assert.deepEqual(await buildM11DependencyClosure(fixture), closure);
const next = refreezeM11Inventory({ ...fixture, closure });
assert.equal(next.cases.filter((r) => r.split === 'development').length, 2);
assert.equal(next.cases.find((r) => r.case_id === 'c').split, 'evaluation');
const allConnected = make({ 'src/c.ts': "import './a.ts';\n" });
const noHoldout = refreezeM11Inventory({ ...allConnected, closure: await buildM11DependencyClosure(allConnected) });
assert.equal(noHoldout.metadata.evaluationReadiness, 'blocked-no-evaluation-component');

// Unknown inputs and opaque loader forms must block a freeze, not disappear.
for (const text of ["import('./missing.ts');", "const name = './a.ts'; import(name);",
  "import { readFileSync as read } from 'node:fs'; const alias = read; alias('x');",
  "const fs = require('node:fs'); fs.readFileSync('x');",
  "import { createRequire as loader } from 'node:module'; const r = loader(import.meta.url); r('x');"]) {
  const input = make({ 'src/c.ts': text });
  const result = await buildM11DependencyClosure(input);
  assert.equal(result.repositoryFileClosureComplete, false);
  assert.throws(() => refreezeM11Inventory({ ...input, closure: result }), /unresolved/);
}
const cssInput = make({ 'src/c.ts': "import './c.css';", 'src/c.css': '@import "other.css";' });
assert.equal((await buildM11DependencyClosure(cssInput)).repositoryFileClosureComplete, false);
const packageInput = make({ 'src/c.ts': "import 'fixture-pkg/subpath';" });
assert((await buildM11DependencyClosure(packageInput)).externalInputs.some((e) => e.boundary === 'locked-package'));
const unlocked = make({ 'src/c.ts': "import 'unlisted-package';" });
assert.equal((await buildM11DependencyClosure(unlocked)).repositoryFileClosureComplete, false);
const aliased = make({ 'tsconfig.app.json': '{"compilerOptions":{"paths":{"x":["src/a.ts"]}}}' });
await assert.rejects(buildM11DependencyClosure(aliased), /unsupported resolution/);
const viteAlias = make({ 'vite.config.ts': "import {defineConfig} from 'vite'; export default defineConfig({resolve:{alias:{}}});" });
await assert.rejects(buildM11DependencyClosure(viteAlias), /resolution override/);
await assert.rejects(buildM11DependencyClosure({ ...fixture, readSource: async (p) => fixture.files[p] + ' ' }), /source identity/);
const partial = structuredClone(fixture.snapshot); partial.entries.pop();
await assert.rejects(buildM11DependencyClosure({ ...fixture, snapshot: partial }), /Git tree identity/);
assert.throws(() => m11GitTreeSha([...fixture.snapshot.entries, fixture.snapshot.entries[0]]), /duplicate/);
const corrupted = structuredClone(closure); corrupted.clusters[0].sourceBindings = {};
delete corrupted.closureSha256; corrupted.closureSha256 = m11Digest(corrupted);
assert.throws(() => refreezeM11Inventory({ ...fixture, closure: corrupted }), /cluster closure identity/);
const mutable = structuredClone(fixture.snapshot);
const duringRead = await buildM11DependencyClosure({ ...fixture, snapshot: mutable, readSource: async (p) => {
  mutable.entries.length = 0; return fixture.files[p];
} });
assert.deepEqual(duringRead, closure);

// Git's own tree encoding is the independent oracle for snapshot completeness.
const temp = await mkdtemp(path.join(tmpdir(), 'm11-closure-test-'));
try {
  const sourceRoot = path.join(temp, 'source'); await mkdir(sourceRoot);
  for (const [p, text] of Object.entries(fixture.files)) { await mkdir(path.dirname(path.join(sourceRoot, p)), { recursive: true }); await writeFile(path.join(sourceRoot, p), text); }
  execFileSync('git', ['init', '--quiet', sourceRoot]);
  execFileSync('git', ['-C', sourceRoot, 'add', '.']);
  assert.equal(execFileSync('git', ['-C', sourceRoot, 'write-tree'], { encoding: 'utf8' }).trim(), fixture.snapshot.gitTreeSha);
  await writeFile(path.join(temp, 'inventory.json'), JSON.stringify(fixture.inventory));
  await writeFile(path.join(temp, 'snapshot.json'), JSON.stringify(fixture.snapshot));
  const cli = fileURLToPath(new URL('../bin/h19-m11-refreeze.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [cli, path.join(temp, 'inventory.json'), fixture.expectedInventorySha256,
    path.join(temp, 'snapshot.json'), fixture.expectedSnapshotSha256, sourceRoot], { encoding: 'utf8', timeout: 20000 }));
  assert.equal(result.status, 'descriptive-feasibility-only');
  assert.equal(result.readiness.observations.receipts.length, 0);
  assert.equal(result.readiness.materialization.counts.uniqueCases, 0);
} finally { await rm(temp, { recursive: true, force: true }); }

const dir = new URL('../experiments/m11/', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, dir), 'utf8'));
const [old, saved, snapshot, refrozen, readiness] = await Promise.all(['COHORT-v0.1.json', 'REPOSITORY-CLOSURE-001.json',
  'SOURCE-SNAPSHOT-001.json', 'COHORT-v0.2.json', 'SOURCE-READINESS-002.json'].map(load));
assert.deepEqual(freezeM11Snapshot(snapshot.entries, snapshot.sourceRevision, snapshot.gitTreeSha), snapshot);
assert.equal(snapshot.gitTreeSha, 'e85fd3faf26671b2a5137d99b1be7765f06bb13c');
const { closureSha256, ...body } = saved; assert.equal(m11Digest(body), closureSha256);
assert.deepEqual(m11ClusterClosures(old, saved.sourceBindings, saved.edges), saved.clusters);
assert.deepEqual(m11ClosureComponents(old, saved.clusters), saved.components);
assert.deepEqual(refreezeM11Inventory({ inventory: old, expectedInventorySha256: old.manifest_sha256, closure: saved }), refrozen);
validateM11Inventory(refrozen, refrozen.manifest_sha256);
assert.equal(refrozen.cases.length, 24);
assert.equal(refrozen.cases.filter((r) => r.split === 'development').length, 22);
assert.equal(refrozen.cases.filter((r) => r.split === 'evaluation').length, 2);
for (const row of refrozen.cases) {
  const original = old.cases.find((r) => r.case_id === row.case_id);
  const { originalCluster, ...copy } = row;
  assert.equal(originalCluster, original.cluster);
  assert.deepEqual({ ...copy, split: original.split, cluster: original.cluster }, original);
}
const [evaluation, development] = ['evaluation', 'development'].map((s) => saved.components.find((c) => c.split === s));
assert.equal(Object.keys(saved.sourceBindings).length, 66);
assert.equal(Object.keys(development.sourceBindings).length, 64);
assert.equal(Object.keys(evaluation.sourceBindings).length, 2);
assert(!Object.keys(evaluation.sourceBindings).some((p) => p in development.sourceBindings));
const { readinessSha256, ...readyBody } = readiness; assert.equal(m11Digest(readyBody), readinessSha256);
const { bundleSha256, ...bundleBody } = readiness.observations; assert.equal(m11Digest(bundleBody), bundleSha256);
assert.equal(readiness.observations.receipts.length, 0);
assert.equal(readiness.materialization.counts.uniqueCases, 0);
assert.equal(readiness.materialization.rows.length, 22);
assert(readiness.materialization.rows.every((r) => r.reason === 'missing-observations'));
console.log('M11 closure: Git tree proof, transitive/file-read/cycle handling, unknown-input blocking, component refreeze, CLI and frozen artifacts PASS');
