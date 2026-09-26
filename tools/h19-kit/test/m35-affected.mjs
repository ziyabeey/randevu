import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import {
  affectedProjects,
  projectForFile,
  projectGraph,
  reverseDependents,
} from '../src/impact/project-graph.mjs';
import {
  normalizeNxGraph,
  nxAffectedProjects,
  nxProjectGraph,
  parseNxAffected,
} from '../src/adapters/nx.mjs';
import { parseTurboLsJson, turboAffectedPackages } from '../src/adapters/turbo.mjs';

const graph = projectGraph({
  projects: [
    { id: 'app', root: 'apps/app' },
    { id: 'lib', root: 'packages/lib' },
    { id: 'util', root: 'packages/util' },
  ],
  dependencies: [
    { source: 'app', target: 'lib' },
    { source: 'lib', target: 'util' },
  ],
});

assert.equal(projectForFile(graph, 'packages/lib/src/index.ts')?.id, 'lib');
assert.deepEqual(reverseDependents(graph, ['util']), ['app', 'lib', 'util']);

const affected = affectedProjects(graph, [
  'packages/lib/src/index.ts',
  'README.md',
]);
assert.deepEqual(affected.touched, ['lib']);
assert.deepEqual(affected.affected, ['app', 'lib']);
assert.deepEqual(affected.unownedFiles, ['README.md']);

const nxRaw = {
  graph: {
    nodes: {
      app: { type: 'app', data: { root: 'apps/app', tags: ['frontend'] } },
      lib: { type: 'lib', data: { root: 'packages/lib' } },
    },
    dependencies: {
      app: [{ source: 'app', target: 'lib', type: 'static' }],
      lib: [],
    },
  },
};
const normalized = normalizeNxGraph(nxRaw);
assert.equal(normalized.projects.length, 2);
assert.deepEqual(normalized.dependencies, [{ source: 'app', target: 'lib', type: 'static' }]);
assert.deepEqual(parseNxAffected('lib,app\napp\n'), ['app', 'lib']);

const affectedCalls = [];
const nxAffected = await nxAffectedProjects({
  base: 'abc',
  head: 'def',
  executeCommand: async (command, args) => {
    affectedCalls.push({ command, args });
    return { stdout: 'lib,app\n', stderr: '' };
  },
});
assert.deepEqual(nxAffected, ['app', 'lib']);
assert.ok(affectedCalls[0].args.includes('--base=abc'));
assert.ok(affectedCalls[0].args.includes('--head=def'));

const nxGraph = await nxProjectGraph({
  executeCommand: async (_command, args) => {
    const arg = args.find((x) => x.startsWith('--file='));
    assert.ok(arg);
    const file = arg.slice('--file='.length);
    await writeFile(file, JSON.stringify(nxRaw));
    return { stdout: '', stderr: '' };
  },
});
assert.equal(nxGraph.projects.find((x) => x.id === 'app')?.root, 'apps/app');


const turboFixture = {
  packageManager: 'pnpm',
  packages: {
    count: 2,
    items: [
      { name: '@repo/lib', path: 'packages/lib' },
      { name: 'web', path: 'apps/web' },
    ],
  },
};
assert.deepEqual(parseTurboLsJson(turboFixture), [
  { name: '@repo/lib', path: 'packages/lib' },
  { name: 'web', path: 'apps/web' },
]);

let turboCall = null;
const turboAffected = await turboAffectedPackages({
  base: 'abc',
  head: 'def',
  executeCommand: async (command, args, options) => {
    turboCall = { command, args, env: options.env };
    return { stdout: JSON.stringify(turboFixture), stderr: '' };
  },
});
assert.equal(turboAffected.length, 2);
assert.deepEqual(turboCall.args, ['turbo', 'ls', '--affected', '--output=json']);
assert.equal(turboCall.env.TURBO_SCM_BASE, 'abc');
assert.equal(turboCall.env.TURBO_SCM_HEAD, 'def');

console.log('h19-kit M3.5 affected-project smoke: ok');
