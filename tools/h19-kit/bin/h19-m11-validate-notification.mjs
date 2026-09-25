#!/usr/bin/env node
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  m11Digest,
  m11SourceBlobSha,
  validateM11SourcePath,
} from '../src/experiments/m11-materializer.mjs';
import {
  summarizeM11Tap,
  summarizeM11V8Coverage,
} from '../src/experiments/m11-collection.mjs';
import {
  interpretM11NotificationRun,
  validateM11NotificationInputs,
} from '../src/experiments/m11-notification-validation.mjs';

const execute = promisify(execFile);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

async function main() {
  const [artifactDirectory, planFile, expectedPlanSha256, sourceDirectory, ...extra] = process.argv.slice(2);
  assert(sourceDirectory && !extra.length,
    'usage: h19-m11-validate-notification ARTIFACT_DIR PLAN_FILE PLAN_SHA256 SOURCE_ROOT');

  const start = performance.now();
  const startedAt = new Date().toISOString();
  const inputs = {
    expectedPlanSha256,
    plan: JSON.parse(await readFile(planFile, 'utf8')),
  };

  for (const [key, file] of Object.entries({
    bridge: 'supplement-001/BRIDGE.json',
    supplementalCollection: 'supplement-001/COLLECTION.json',
    closure: 'REPOSITORY-CLOSURE-001.json',
    snapshot: 'SOURCE-SNAPSHOT-001.json',
    inventory: 'COHORT-v0.2.json',
  })) {
    inputs[key] = JSON.parse(await readFile(path.join(artifactDirectory, file), 'utf8'));
  }

  const { plan } = validateM11NotificationInputs(inputs);
  assert(process.version === plan.runtime, 'runtime differs from frozen notification plan');

  const sourceRoot = await realpath(sourceDirectory);
  const artifactRoot = await realpath(artifactDirectory);
  const boundedRead = async (root, relativePath) => {
    validateM11SourcePath(relativePath);
    const resolved = await realpath(path.join(root, relativePath));
    const relative = path.relative(root, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      'notification input escapes root');
    return readFile(resolved);
  };

  const toolkit = fileURLToPath(new URL('..', import.meta.url));
  for (const [producerPath, sha] of Object.entries(plan.producerBindings)) {
    assert(m11SourceBlobSha(await boundedRead(toolkit, producerPath)) === sha,
      `notification producer bytes differ from plan: ${producerPath}`);
  }

  const candidate = await boundedRead(artifactRoot, plan.candidate.path);
  assert(m11SourceBlobSha(candidate) === plan.candidate.gitBlobSha,
    'notification candidate bytes differ from plan');

  const sources = new Map();
  for (const [sourcePath, sha] of Object.entries({
    ...plan.sourceBindings,
    ...plan.oracleBindings,
  })) {
    const bytes = await boundedRead(sourceRoot, sourcePath);
    assert(m11SourceBlobSha(bytes) === sha, `pinned notification source mismatch: ${sourcePath}`);
    if (Object.hasOwn(plan.sourceBindings, sourcePath)) sources.set(sourcePath, bytes);
  }

  const temp = await mkdtemp(path.join(tmpdir(), 'h19-m11-notification-validation-'));
  try {
    for (const [sourcePath, bytes] of sources) {
      const target = path.join(temp, sourcePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }

    const validationDirectory = path.join(temp, 'validation');
    await mkdir(validationDirectory);
    const candidatePath = path.join(validationDirectory, 'notification-template.test.mjs');
    await writeFile(candidatePath, candidate);

    const coverageDirectory = path.join(temp, 'coverage');
    await mkdir(coverageDirectory);

    const setupMs = performance.now() - start;
    const executionStart = performance.now();
    let stdout = '';
    let stderr = '';
    let exitCode = null;
    let completed = false;

    try {
      ({ stdout, stderr } = await execute(process.execPath, [
        '--test',
        '--test-reporter=tap',
        'validation/notification-template.test.mjs',
      ], {
        cwd: temp,
        env: {
          PATH: process.env.PATH,
          NODE_OPTIONS: '',
          NODE_V8_COVERAGE: coverageDirectory,
          TZ: 'UTC',
        },
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      }));
      exitCode = 0;
      completed = true;
    } catch (error) {
      stdout = String(error.stdout ?? '');
      stderr = String(error.stderr ?? '');
      exitCode = Number.isInteger(error.code) ? error.code : null;
      completed = exitCode !== null && !error.killed;
    }

    const executionMs = performance.now() - executionStart;
    const v8Entries = [];
    const targetUrl = new URL(`file://${path.join(temp, plan.targetPath)}`).href;

    for (const file of (await readdir(coverageDirectory))
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      const data = JSON.parse(await readFile(path.join(coverageDirectory, file), 'utf8'));
      for (const script of data.result ?? []) {
        if (script.url === targetUrl) v8Entries.push({ functions: script.functions });
      }
    }

    for (const [sourcePath, sha] of Object.entries(plan.sourceBindings)) {
      assert(m11SourceBlobSha(await readFile(path.join(temp, sourcePath))) === sha,
        `notification source changed during validation: ${sourcePath}`);
    }
    assert(m11SourceBlobSha(await readFile(candidatePath)) === plan.candidate.gitBlobSha,
      'notification candidate changed during validation');

    let testSummary = null;
    try {
      testSummary = summarizeM11Tap(stdout);
    } catch {
      // Partial output remains inconclusive.
    }

    const body = {
      schemaVersion: 1,
      kind: 'm11-notification-behavioral-suite-observation',
      planSha256: plan.planSha256,
      sourceRevision: plan.sourceRevision,
      sourceBindings: plan.sourceBindings,
      oracleBindings: plan.oracleBindings,
      candidateGitBlobSha: plan.candidate.gitBlobSha,
      producerBindings: plan.producerBindings,
      runtime: process.version,
      command: [
        'node',
        '--test',
        '--test-reporter=tap',
        'validation/notification-template.test.mjs',
      ],
      environment: {
        NODE_OPTIONS: '',
        NODE_V8_COVERAGE: 'isolated-temporary-directory',
        TZ: 'UTC',
      },
      startedAt,
      finishedAt: new Date().toISOString(),
      timings: {
        setupMs,
        executionMs,
        totalMs: performance.now() - start,
      },
      completed,
      exitCode,
      stdout,
      stderr,
      testSummary,
      target: {
        path: plan.targetPath,
        gitBlobSha: plan.sourceBindings[plan.targetPath],
        v8Entries,
        coverage: summarizeM11V8Coverage(v8Entries),
      },
    };

    const run = { ...body, observationSha256: m11Digest(body) };
    process.stdout.write(`${JSON.stringify(interpretM11NotificationRun(inputs, run), null, 2)}\n`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`M11 notification validation failed: ${error.message}`);
  process.exitCode = 1;
});
