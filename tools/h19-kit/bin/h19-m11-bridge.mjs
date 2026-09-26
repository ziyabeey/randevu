#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { bridgeM11Observations } from '../src/experiments/m11-observation-bridge.mjs';
import { validateM11SourcePath } from '../src/experiments/m11-materializer.mjs';

async function main() {
  const [artifactDirectory, expectedInventorySha256, expectedCollectionSha256, sourceDirectory, ...extra] = process.argv.slice(2);
  if (!sourceDirectory || extra.length) throw new Error('usage: h19-m11-bridge ARTIFACT_DIR INVENTORY_SHA256 COLLECTION_SHA256 SOURCE_ROOT');
  const root = await realpath(sourceDirectory);
  const inputs = {};
  for (const [key, name] of Object.entries({ originalInventory: 'COHORT-v0.1.json', inventory: 'COHORT-v0.2.json',
    snapshot: 'SOURCE-SNAPSHOT-001.json', closure: 'REPOSITORY-CLOSURE-001.json', recipe: 'COLLECTION-RECIPE-001.json',
    collection: 'DEVELOPMENT-COLLECTION-001.json' })) inputs[key] = JSON.parse(await readFile(path.join(artifactDirectory, name), 'utf8'));
  const result = await bridgeM11Observations({ ...inputs, expectedInventorySha256, expectedCollectionSha256,
    readSource: async (p) => {
      validateM11SourcePath(p);
      const resolved = await realpath(path.join(root, p)), relative = path.relative(root, resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source escapes root');
      return readFile(resolved);
    } });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch((error) => { console.error(`M11 bridge failed: ${error.message}`); process.exitCode = 1; });
