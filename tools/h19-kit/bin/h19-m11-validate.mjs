#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, writeFile, readdir, realpath, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { m11Digest, m11SourceBlobSha, validateM11SourcePath } from '../src/experiments/m11-materializer.mjs';
import { summarizeM11Tap, summarizeM11V8Coverage } from '../src/experiments/m11-collection.mjs';
import { validateM11TargetedInputs, interpretM11TargetedRun } from '../src/experiments/m11-targeted-validation.mjs';

const execute = promisify(execFile);
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function main() {
  const [artifactDirectory, planFile, expectedPlanSha256, sourceDirectory, ...extra] = process.argv.slice(2);
  assert(sourceDirectory && !extra.length, 'usage: h19-m11-validate ARTIFACT_DIR PLAN_FILE PLAN_SHA256 SOURCE_ROOT');
  const start = performance.now(), startedAt = new Date().toISOString();
  const inputs = { expectedPlanSha256, plan: JSON.parse(await readFile(planFile, 'utf8')) };
  for (const [key, file] of Object.entries({ bridge: 'DEVELOPMENT-BRIDGE-001.json', collection: 'DEVELOPMENT-COLLECTION-001.json',
    closure: 'REPOSITORY-CLOSURE-001.json', snapshot: 'SOURCE-SNAPSHOT-001.json', inventory: 'COHORT-v0.2.json' })) {
    inputs[key] = JSON.parse(await readFile(path.join(artifactDirectory, file), 'utf8'));
  }
  const { plan } = validateM11TargetedInputs(inputs);
  assert(process.version === plan.runtime, 'runtime differs from frozen execution plan');
  const sourceRoot = await realpath(sourceDirectory), artifactRoot = await realpath(artifactDirectory);
  const boundedRead = async (root, p) => {
    validateM11SourcePath(p);
    const resolved = await realpath(path.join(root, p)), relative = path.relative(root, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'input escapes root');
    return readFile(resolved);
  };
  const toolkit = fileURLToPath(new URL('..', import.meta.url));
  for (const [p, sha] of Object.entries(plan.producerBindings)) assert(m11SourceBlobSha(await boundedRead(toolkit, p)) === sha, 'producer bytes differ from plan');
  const candidate = await boundedRead(artifactRoot, plan.candidate.path);
  assert(m11SourceBlobSha(candidate) === plan.candidate.gitBlobSha, 'candidate bytes differ from plan');
  const sources = new Map();
  for (const [p, sha] of Object.entries({ ...plan.sourceBindings, ...plan.oracleBindings })) {
    const bytes = await boundedRead(sourceRoot, p); assert(m11SourceBlobSha(bytes) === sha, `pinned source mismatch: ${p}`);
    if (Object.hasOwn(plan.sourceBindings, p)) sources.set(p, bytes);
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'h19-m11-validation-'));
  try {
    for (const [p, bytes] of sources) { await mkdir(path.dirname(path.join(temp, p)), { recursive: true }); await writeFile(path.join(temp, p), bytes); }
    await mkdir(path.join(temp, 'validation')); await writeFile(path.join(temp, 'validation/booking-pagination.test.mjs'), candidate);
    const coverageDirectory = path.join(temp, 'coverage'); await mkdir(coverageDirectory);
    const setupMs = performance.now() - start, executionStart = performance.now();
    let stdout = '', stderr = '', exitCode = null, completed = false;
    try {
      ({ stdout, stderr } = await execute(process.execPath, ['--test', '--test-reporter=tap', 'validation/booking-pagination.test.mjs'], {
        cwd: temp, env: { PATH: process.env.PATH, NODE_OPTIONS: '', NODE_V8_COVERAGE: coverageDirectory, TZ: 'UTC' },
        timeout: 10000, maxBuffer: 1024 * 1024 }));
      exitCode = 0; completed = true;
    } catch (error) {
      stdout = String(error.stdout ?? ''); stderr = String(error.stderr ?? '');
      exitCode = Number.isInteger(error.code) ? error.code : null; completed = exitCode !== null && !error.killed;
    }
    const executionMs = performance.now() - executionStart, v8Entries = [];
    for (const file of (await readdir(coverageDirectory)).filter((p) => p.endsWith('.json')).sort()) {
      const data = JSON.parse(await readFile(path.join(coverageDirectory, file), 'utf8'));
      for (const script of data.result ?? []) if (script.url === new URL(`file://${path.join(temp, plan.targetPath)}`).href) v8Entries.push({ functions: script.functions });
    }
    for (const [p, sha] of Object.entries(plan.sourceBindings)) assert(m11SourceBlobSha(await readFile(path.join(temp, p))) === sha, 'source changed during validation');
    assert(m11SourceBlobSha(await readFile(path.join(temp, 'validation/booking-pagination.test.mjs'))) === plan.candidate.gitBlobSha, 'candidate changed during validation');
    let testSummary = null;
    try { testSummary = summarizeM11Tap(stdout); } catch { /* transport/partial test output remains inconclusive */ }
    const body = { schemaVersion: 1, kind: 'm11-targeted-suite-observation', planSha256: plan.planSha256,
      sourceRevision: plan.sourceRevision, sourceBindings: plan.sourceBindings, oracleBindings: plan.oracleBindings,
      candidateGitBlobSha: plan.candidate.gitBlobSha, producerBindings: plan.producerBindings, runtime: process.version,
      command: ['node', '--test', '--test-reporter=tap', 'validation/booking-pagination.test.mjs'],
      environment: { NODE_OPTIONS: '', NODE_V8_COVERAGE: 'isolated-temporary-directory', TZ: 'UTC' },
      startedAt, finishedAt: new Date().toISOString(), timings: { setupMs, executionMs, totalMs: performance.now() - start },
      completed, exitCode, stdout, stderr, testSummary,
      target: { path: plan.targetPath, gitBlobSha: plan.sourceBindings[plan.targetPath], v8Entries, coverage: summarizeM11V8Coverage(v8Entries) } };
    const run = { ...body, observationSha256: m11Digest(body) };
    process.stdout.write(`${JSON.stringify(interpretM11TargetedRun(inputs, run), null, 2)}\n`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(`M11 targeted validation failed: ${error.message}`); process.exitCode = 1; });
