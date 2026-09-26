#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyM11SupplementInputs, sealM11Supplement, summarizeM11SupplementTap,
  uniqueM11Supplement } from '../src/experiments/m11-supplement-collection.mjs';
import { summarizeM11V8Coverage } from '../src/experiments/m11-collection.mjs';
import { m11SourceBlobSha, validateM11SourcePath } from '../src/experiments/m11-materializer.mjs';

const execute = promisify(execFile);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function main() {
  const [artifactDirectory, expectedPlanSha256, sourceDirectory, archivePath, ...extra] = process.argv.slice(2);
  assert(archivePath && !extra.length, 'usage: h19-m11-supplement ARTIFACT_DIR PLAN_SHA256 SOURCE_ROOT HONO_TGZ');
  const root = await realpath(sourceDirectory);
  const kit = fileURLToPath(new URL('../', import.meta.url));
  const inputs = {};
  for (const [key, name] of Object.entries({ originalInventory: 'COHORT-v0.1.json', inventory: 'COHORT-v0.2.json',
    snapshot: 'SOURCE-SNAPSHOT-001.json', closure: 'REPOSITORY-CLOSURE-001.json', recipe: 'COLLECTION-RECIPE-001.json',
    collection: 'DEVELOPMENT-COLLECTION-001.json', previousBridge: 'DEVELOPMENT-BRIDGE-001.json',
    plan: 'supplement-001/PLAN.json', staticAudit: 'supplement-001/STATIC-AUDIT.json' })) {
    inputs[key] = JSON.parse(await readFile(path.join(artifactDirectory, name), 'utf8'));
  }
  const readSource = async (p) => {
    validateM11SourcePath(p);
    const resolved = await realpath(path.join(root, p)), relative = path.relative(root, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'source escapes root');
    return readFile(resolved);
  };
  const { texts, rows } = await verifyM11SupplementInputs({ ...inputs, expectedPlanSha256, readSource,
    readProducer: async (p) => { validateM11SourcePath(p); return readFile(path.join(kit, p)); } });
  const { plan } = inputs;
  assert(process.version === plan.runtime, 'runtime differs from frozen plan');
  const archive = await readFile(archivePath);
  assert(`sha512-${createHash('sha512').update(archive).digest('base64')}` === plan.runtimeDependency.integrity,
    'runtime dependency archive integrity mismatch');
  const temp = await mkdtemp(path.join(tmpdir(), 'h19-m11-supplement-'));
  const startedAt = new Date().toISOString();
  assert(Date.parse(startedAt) >= Date.parse(plan.frozenAt), 'execution precedes plan');
  const runs = [];
  try {
    const executionRoot = path.join(temp, 'source');
    for (const [p, text] of Object.entries(texts)) {
      const target = path.join(executionRoot, p);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    const dependencyRoot = path.join(executionRoot, 'node_modules/hono');
    await mkdir(dependencyRoot, { recursive: true });
    // Use the verified bytes, not a possibly changed archive path.
    const verifiedArchive = path.join(temp, 'hono.tgz');
    await writeFile(verifiedArchive, archive);
    await execute('tar', ['-xzf', verifiedArchive, '-C', dependencyRoot, '--strip-components=1'], { timeout: 10000 });
    const pkg = JSON.parse(await readFile(path.join(dependencyRoot, 'package.json'), 'utf8'));
    assert(pkg.name === plan.runtimeDependency.name && pkg.version === plan.runtimeDependency.version,
      'extracted dependency identity mismatch');
    for (const suite of plan.suites) {
      const coverageRoot = path.join(temp, `v8-${runs.length}`);
      await mkdir(coverageRoot);
      const args = ['--test', '--test-reporter=tap', suite.path];
      const environment = { NODE_OPTIONS: '', NODE_V8_COVERAGE: 'isolated-temporary-directory', TZ: 'UTC', LANG: 'C.UTF-8' };
      let stdout = '', stderr = '', exitCode = null, transportError = null;
      const runStartedAt = new Date().toISOString();
      try {
        ({ stdout, stderr } = await execute(process.execPath, args, { cwd: executionRoot,
          env: { ...environment, NODE_V8_COVERAGE: coverageRoot }, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }));
        exitCode = 0;
      } catch (error) {
        stdout = error.stdout ?? ''; stderr = error.stderr ?? '';
        exitCode = Number.isInteger(error.code) ? error.code : null;
        transportError = error.killed || exitCode === null ? { code: String(error.code), signal: error.signal ?? null } : null;
      }
      const targets = uniqueM11Supplement(rows.filter((r) => r.referenceSuite === suite.path).flatMap((r) => r.targets));
      const scripts = new Map(targets.map((p) => [p, []])), loadedSourcePaths = new Set(), loadedDependencyPaths = new Set();
      for (const file of (await readdir(coverageRoot)).filter((p) => p.endsWith('.json')).sort()) {
        const data = JSON.parse(await readFile(path.join(coverageRoot, file), 'utf8'));
        assert(Array.isArray(data.result), 'malformed V8 output');
        for (const script of data.result) {
          if (!script.url.startsWith('file:')) continue;
          const p = path.relative(executionRoot, fileURLToPath(script.url)).split(path.sep).join('/');
          if (p.startsWith('node_modules/hono/')) loadedDependencyPaths.add(p);
          else { assert(Object.hasOwn(plan.sourceBindings, p), `loaded file outside development boundary: ${p}`); loadedSourcePaths.add(p); }
          if (scripts.has(p)) scripts.get(p).push({ functions: script.functions });
        }
      }
      for (const [p, sha] of Object.entries({ ...plan.sourceBindings, ...plan.commonContextBindings })) {
        assert(m11SourceBlobSha(await readFile(path.join(executionRoot, p))) === sha
          && m11SourceBlobSha(await readSource(p)) === sha, 'source changed during collection');
      }
      runs.push(sealM11Supplement({ schemaVersion: 1, kind: 'm11-supplement-suite-observation',
        planSha256: plan.planSha256, inventorySha256: plan.inventorySha256, sourceRevision: plan.sourceRevision,
        sourceBindings: plan.sourceBindings, runtimeDependency: plan.runtimeDependency,
        runtime: process.version, command: ['node', ...args], environment,
        startedAt: runStartedAt, finishedAt: new Date().toISOString(), exitCode, transportError, stdout, stderr,
        controls: summarizeM11SupplementTap(stdout, suite, exitCode, transportError),
        loadedSourcePaths: [...loadedSourcePaths].sort(), loadedDependencyPaths: [...loadedDependencyPaths].sort(),
        targets: targets.map((p) => ({ path: p, gitBlobSha: plan.sourceBindings[p],
          evidenceKinds: uniqueM11Supplement(rows.filter((r) => r.referenceSuite === suite.path && r.targets.includes(p))
            .map((r) => r.referenceEvidenceKind)),
          v8Entries: scripts.get(p), coverage: summarizeM11V8Coverage(scripts.get(p)) })) }, 'observationSha256'));
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
  const result = sealM11Supplement({ schemaVersion: 1, kind: 'm11-development-supplement-collection',
    planSha256: plan.planSha256, inventorySha256: plan.inventorySha256, sourceRevision: plan.sourceRevision,
    staticAuditSha256: plan.staticAuditSha256, startedAt, finishedAt: new Date().toISOString(), runs,
    scope: 'suite-scoped seed observations; no independent outcome or relation label' }, 'collectionSha256');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch((error) => { console.error(`M11 supplement failed: ${error.message}`); process.exitCode = 1; });
