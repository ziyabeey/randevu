#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeM11Supplement } from '../src/experiments/m11-supplement-bridge.mjs';
import { validateM11SourcePath } from '../src/experiments/m11-materializer.mjs';

async function main() {
  const [artifactDirectory, expectedPlanSha256, expectedSupplementalCollectionSha256, sourceDirectory, ...extra] = process.argv.slice(2);
  if (!sourceDirectory || extra.length) throw new Error('usage: h19-m11-supplement-bridge ARTIFACT_DIR PLAN_SHA256 COLLECTION_SHA256 SOURCE_ROOT');
  const root = await realpath(sourceDirectory), kit = fileURLToPath(new URL('../', import.meta.url));
  const inputs = {};
  for (const [key, name] of Object.entries({ originalInventory: 'COHORT-v0.1.json', inventory: 'COHORT-v0.2.json',
    snapshot: 'SOURCE-SNAPSHOT-001.json', closure: 'REPOSITORY-CLOSURE-001.json', recipe: 'COLLECTION-RECIPE-001.json',
    collection: 'DEVELOPMENT-COLLECTION-001.json', previousBridge: 'DEVELOPMENT-BRIDGE-001.json',
    plan: 'supplement-001/PLAN.json', staticAudit: 'supplement-001/STATIC-AUDIT.json', supplementalCollection: 'supplement-001/COLLECTION.json' })) {
    inputs[key] = JSON.parse(await readFile(path.join(artifactDirectory, name), 'utf8'));
  }
  const result = await materializeM11Supplement({ ...inputs, expectedPlanSha256, expectedSupplementalCollectionSha256,
    readProducer: async (p) => { validateM11SourcePath(p); return readFile(path.join(kit, p)); },
    readSource: async (p) => {
      validateM11SourcePath(p);
      const resolved = await realpath(path.join(root, p)), relative = path.relative(root, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source escapes root');
      return readFile(resolved);
    } });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch((error) => { console.error(`M11 supplement bridge failed: ${error.message}`); process.exitCode = 1; });
