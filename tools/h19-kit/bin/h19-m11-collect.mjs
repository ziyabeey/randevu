#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { auditM11CollectionSources, summarizeM11Tap, summarizeM11V8Coverage } from '../src/experiments/m11-collection.mjs';
import { m11Digest, m11SourceBlobSha, validateM11SourcePath } from '../src/experiments/m11-materializer.mjs';

const execute = promisify(execFile);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

async function main() {
  const [inventoryFile, expectedInventorySha256, recipeFile, sourceDirectory, ...extra] = process.argv.slice(2);
  assert(sourceDirectory && !extra.length, 'usage: h19-m11-collect INVENTORY SHA256 RECIPE SOURCE_ROOT');
  const inventory = JSON.parse(await readFile(inventoryFile, 'utf8'));
  const recipe = JSON.parse(await readFile(recipeFile, 'utf8'));
  const root = await realpath(sourceDirectory);
  const readSource = async (p) => {
    validateM11SourcePath(p);
    const resolved = await realpath(path.join(root, p));
    const relative = path.relative(root, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'source escapes root');
    return readFile(resolved);
  };
  const { audit } = await auditM11CollectionSources({ inventory, expectedInventorySha256, recipe, readSource });
  const runs = [];
  for (const suite of recipe.referenceSuites) {
    // This command executes trusted pinned tests. No evaluation suite is eligible.
    const temp = await mkdtemp(path.join(tmpdir(), 'h19-m11-v8-'));
    try {
      const args = ['--test', '--test-reporter=tap', suite];
      let stdout, stderr, exitCode;
      try {
        ({ stdout, stderr } = await execute(process.execPath, args, { cwd: root,
          env: { ...process.env, NODE_OPTIONS: '', NODE_V8_COVERAGE: temp },
          timeout: 30000, maxBuffer: 4 * 1024 * 1024 }));
        exitCode = 0;
      } catch (error) {
        assert(Number.isInteger(error.code) && !error.killed, 'reference execution did not complete');
        ({ stdout, stderr } = error);
        exitCode = error.code;
      }
      const testSummary = summarizeM11Tap(stdout);
      assert(testSummary.tests === testSummary.pass + testSummary.fail + testSummary.cancelled
        + testSummary.skipped + testSummary.todo, 'inconsistent reference test summary');
      const targets = [...new Set(inventory.cases.filter((r) => r.split === 'development'
        && r.referenceSuite === suite).flatMap((r) => r.targets))].sort();
      const scripts = new Map(targets.map((p) => [p, []]));
      const coverageFiles = (await readdir(temp)).filter((p) => p.endsWith('.json')).sort();
      assert(coverageFiles.length, 'V8 coverage output absent');
      for (const file of coverageFiles) {
        const data = JSON.parse(await readFile(path.join(temp, file), 'utf8'));
        assert(Array.isArray(data.result), 'malformed V8 coverage output');
        for (const script of data.result) {
          if (!script.url.startsWith('file:')) continue;
          const p = path.relative(root, fileURLToPath(script.url)).split(path.sep).join('/');
          if (scripts.has(p)) scripts.get(p).push({ functions: script.functions });
        }
      }
      // Detect accidental source changes by the invoked suite before retaining data.
      for (const [p, sha] of Object.entries(recipe.sourceBindings)) {
        assert(m11SourceBlobSha(await readSource(p)) === sha, 'source changed during collection');
      }
      const body = { schemaVersion: 1, kind: 'm11-development-suite-observation',
        sourceRevision: recipe.sourceRevision, inventorySha256: expectedInventorySha256,
        recipeSha256: recipe.recipeSha256, sourceBindings: recipe.sourceBindings,
        runtime: process.version, command: ['node', ...args], environment: { NODE_OPTIONS: '', NODE_V8_COVERAGE: 'isolated-temporary-directory' },
        exitCode, stdout, stderr, testSummary,
        targets: targets.map((p) => ({ path: p, gitBlobSha: recipe.sourceBindings[p],
          evidenceKinds: [...new Set(inventory.cases.filter((r) => r.referenceSuite === suite && r.targets.includes(p))
            .map((r) => r.referenceEvidenceKind))].sort(),
          v8Entries: scripts.get(p), coverage: summarizeM11V8Coverage(scripts.get(p)) })) };
      runs.push({ ...body, observationSha256: m11Digest(body) });
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  const body = { schemaVersion: 1, kind: 'm11-development-collection',
    inventorySha256: expectedInventorySha256, sourceRevision: recipe.sourceRevision,
    recipeSha256: recipe.recipeSha256, dependencyAudit: audit, runs,
    materialization: { status: 'blocked', reason: audit.status, invoked: false, packets: 0, batches: 0, cases: 0 },
    limits: ['Static import witnesses are sufficient to reject a split; they do not certify complete closure.',
      'V8 named-function entries are scoped to one suite, not whole-product coverage or defect labels.',
      'No evaluation test, independent outcome, relation label or provider call is collected.'] };
  process.stdout.write(`${JSON.stringify({ ...body, collectionSha256: m11Digest(body) }, null, 2)}\n`);
}

main().catch((error) => { console.error(`M11 collection failed: ${error.message}`); process.exitCode = 1; });
