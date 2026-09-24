import assert from 'node:assert/strict';

import {
  ScipIndexerRegistry,
  clearIndexerVersionProbeCacheForTests,
  externalScipIndexer,
  probeIndexerVersion,
  resolveIndexerIdentity,
} from '../src/indexing/indexer-registry.mjs';
import { scipTypeScriptIndexer } from '../src/indexing/scip-launcher.mjs';

clearIndexerVersionProbeCacheForTests();

let versionCalls = 0;
const version = await probeIndexerVersion({
  command: 'fake-scip',
  args: ['--version'],
  execute: async () => {
    versionCalls += 1;
    return { stdout: 'fake-scip 1.2.3\n', stderr: '' };
  },
});
assert.equal(version, 'fake-scip 1.2.3');

const versionAgain = await probeIndexerVersion({
  command: 'fake-scip',
  args: ['--version'],
  execute: async () => {
    versionCalls += 1;
    return { stdout: 'SHOULD NOT RUN', stderr: '' };
  },
});
assert.equal(versionAgain, 'fake-scip 1.2.3');
assert.equal(versionCalls, 1);

const ts = scipTypeScriptIndexer({
  version: '0.3.0',
  command: 'scip-typescript',
});

const python = externalScipIndexer({
  id: 'scip-python',
  command: 'scip-python',
  version: 'auto',
  priority: 80,
  languages: ['python'],
  buildArgs: () => ['index', '.', '--project-name=demo'],
});

const clang = externalScipIndexer({
  id: 'scip-clang',
  command: 'scip-clang',
  version: 'auto',
  priority: 70,
  languages: ['c', 'cpp', 'cuda'],
  buildArgs: () => ['--compdb-path', 'build/compile_commands.json'],
});

const registry = new ScipIndexerRegistry();
registry.register({
  ...ts,
  priority: 100,
  languages: ['typescript', 'javascript'],
  supports(context = {}) {
    return (context.languages ?? []).some((x) => ['typescript','javascript'].includes(String(x).toLowerCase()));
  },
});
registry.register(python);
registry.register(clang);

assert.equal(registry.select({ languages: ['typescript'] })?.id, 'scip-typescript');
assert.equal(registry.select({ languages: ['python'] })?.id, 'scip-python');
assert.equal(registry.select({ languages: ['cpp'] })?.id, 'scip-clang');
assert.equal(registry.select({ languages: ['ruby'] }), null);

let probeArgs = null;
const resolved = await resolveIndexerIdentity(python, {
  executeVersion: async (command, args) => {
    probeArgs = { command, args };
    return { stdout: 'scip-python 9.9.9\n', stderr: '' };
  },
});
assert.equal(resolved.version, 'scip-python 9.9.9');
assert.equal(probeArgs.command, 'scip-python');

assert.throws(
  () => registry.register(python),
  /duplicate SCIP indexer/,
);

console.log('h19-kit M3.5 indexer registry smoke: ok');
