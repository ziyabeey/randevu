import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FileCache } from '../src/core/cache.mjs';
import { normalizedScipGraph } from '../src/indexing/graph-cache.mjs';
import { SCIP_ROLES } from '../src/adapters/scip.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-graph-cache-'));
try {
  const indexFile = path.join(temp, 'index.scip');
  await writeFile(indexFile, Buffer.from('fake-index-v1'));
  const cache = new FileCache(path.join(temp, '.h19', 'cache'));

  let reads = 0;
  const readIndex = async () => {
    reads += 1;
    return {
      documents: [{
        relativePath: 'src/a.ts',
        occurrences: [{
          symbol: 'typescript npm demo 1.0.0 src/a.ts/foo().',
          symbolRoles: SCIP_ROLES.DEFINITION,
          singleLineRange: { line: 0, startCharacter: 0, endCharacter: 3 },
        }],
      }],
    };
  };

  const first = await normalizedScipGraph({
    indexFile,
    converterVersion: 'scip-cli-test-1',
    graphSchemaVersion: 1,
    cache,
    readIndex,
  });
  assert.equal(first.cache, 'miss');
  assert.equal(first.graph.nodeCount, 1);
  assert.equal(reads, 1);

  const second = await normalizedScipGraph({
    indexFile,
    converterVersion: 'scip-cli-test-1',
    graphSchemaVersion: 1,
    cache,
    readIndex,
  });
  assert.equal(second.cache, 'hit');
  assert.equal(second.indexSha256, first.indexSha256);
  assert.equal(reads, 1);

  const converterChanged = await normalizedScipGraph({
    indexFile,
    converterVersion: 'scip-cli-test-2',
    graphSchemaVersion: 1,
    cache,
    readIndex,
  });
  assert.equal(converterChanged.cache, 'miss');
  assert.equal(reads, 2);

  const schemaChanged = await normalizedScipGraph({
    indexFile,
    converterVersion: 'scip-cli-test-2',
    graphSchemaVersion: 2,
    cache,
    readIndex,
  });
  assert.equal(schemaChanged.cache, 'miss');
  assert.equal(reads, 3);

  await writeFile(indexFile, Buffer.from('fake-index-v2'));
  const bytesChanged = await normalizedScipGraph({
    indexFile,
    converterVersion: 'scip-cli-test-2',
    graphSchemaVersion: 2,
    cache,
    readIndex,
  });
  assert.equal(bytesChanged.cache, 'miss');
  assert.notEqual(bytesChanged.indexSha256, first.indexSha256);
  assert.equal(reads, 4);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit M3.5 normalized graph cache smoke: ok');
