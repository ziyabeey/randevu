#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { buildM11DependencyClosure, refreezeM11Inventory } from '../src/experiments/m11-closure.mjs';
import { m11Digest, materializeM11Development, validateM11SourcePath } from '../src/experiments/m11-materializer.mjs';

async function main() {
  const [inventoryFile, inventorySha, snapshotFile, snapshotSha, sourceDirectory, ...extra] = process.argv.slice(2);
  if (!sourceDirectory || extra.length) throw new Error('usage: h19-m11-refreeze INVENTORY SHA256 SNAPSHOT SHA256 SOURCE_ROOT');
  const inventory = JSON.parse(await readFile(inventoryFile, 'utf8'));
  const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
  const root = await realpath(sourceDirectory);
  const readSource = async (p) => {
    validateM11SourcePath(p);
    const resolved = await realpath(path.join(root, p));
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source escapes root');
    return readFile(resolved);
  };
  const closure = await buildM11DependencyClosure({ inventory, expectedInventorySha256: inventorySha,
    snapshot, expectedSnapshotSha256: snapshotSha, readSource });
  let refrozenInventory = null, readiness = null;
  let status = 'blocked-unresolved-repository-inputs';
  if (closure.repositoryFileClosureComplete) {
    refrozenInventory = refreezeM11Inventory({ inventory, expectedInventorySha256: inventorySha, closure });
    status = refrozenInventory.metadata.evaluationReadiness;
    if (refrozenInventory.metadata.independentRepositoryComponents.evaluation > 0) {
      // Complete only for the current empty observation set under the frozen
      // file-input profile. Future facts must extend and revalidate lineage.
      const body = { schemaVersion: 1, kind: 'm11-offline-observations',
        inventorySha256: refrozenInventory.manifest_sha256, sourceRevision: closure.sourceRevision,
        clusters: closure.components.map((c) => ({ cluster: c.component, complete: true, sourceBindings: c.sourceBindings })), receipts: [] };
      const observations = { ...body, bundleSha256: m11Digest(body) };
      const materialization = await materializeM11Development({ inventory: refrozenInventory,
        expectedInventorySha256: refrozenInventory.manifest_sha256, observations, readSource });
      const receipt = { schemaVersion: 1, kind: 'm11-source-refreeze-readiness',
        closureSha256: closure.closureSha256, observationScope: 'empty-receipts-repository-file-closure-only',
        futureObservationLineageComplete: false, observations, materialization };
      readiness = { ...receipt, readinessSha256: m11Digest(receipt) };
    }
  }
  process.stdout.write(`${JSON.stringify({ status, closure, inventory: refrozenInventory, readiness }, null, 2)}\n`);
}

main().catch((error) => { console.error(`M11 refreeze failed: ${error.message}`); process.exitCode = 1; });
