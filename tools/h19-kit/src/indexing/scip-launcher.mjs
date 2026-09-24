import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ArtifactCache } from '../core/artifact-cache.mjs';
import { projectFingerprint } from './project-fingerprint.mjs';

function defaultExecute(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve({ code, stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 2000)}`)));
  });
}

export function scipTypeScriptIndexer({
  version,
  command = 'scip-typescript',
  flags = [],
} = {}) {
  if (!version) throw new TypeError('scip-typescript version required');
  return Object.freeze({
    id: 'scip-typescript',
    version,
    command,
    flags: [...flags],
    buildArgs: ({ output }) => ['index', '--output', output, ...flags],
  });
}

export async function indexProject({
  cwd = process.cwd(),
  projectRoot = '.',
  sourceFiles = [],
  configFiles = [],
  dependencySurfaces = {},
  indexer,
  cache = new ArtifactCache(),
  execute = defaultExecute,
  env = process.env,
} = {}) {
  if (!indexer?.command || typeof indexer.buildArgs !== 'function') {
    throw new TypeError('indexer command/buildArgs required');
  }

  const fingerprint = await projectFingerprint({
    cwd,
    projectRoot,
    sourceFiles,
    configFiles,
    dependencySurfaces,
    indexer,
  });

  const namespace = 'scip-project-v1';
  const artifactName = 'index.scip';
  const hit = await cache.has(namespace, fingerprint.fingerprint, artifactName);
  if (hit) {
    return Object.freeze({
      cache: 'hit',
      fingerprint,
      indexFile: cache.fileFor(namespace, fingerprint.fingerprint, artifactName),
    });
  }

  const tempRoot = await mkdir(path.join(os.tmpdir(), 'h19-scip-'), { recursive: true })
    .then(() => os.tmpdir());
  const tempDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(tempRoot, 'h19-scip-')));
  const output = path.join(tempDir, artifactName);
  const projectCwd = path.resolve(cwd, projectRoot);

  try {
    const args = indexer.buildArgs({ output, projectRoot });
    await execute(indexer.command, args, { cwd: projectCwd, env });
    const manifest = {
      schemaVersion: 1,
      projectRoot,
      fingerprint: fingerprint.fingerprint,
      indexer: fingerprint.indexer,
      sources: fingerprint.sources,
      configs: fingerprint.configs,
      dependencySurfaces: fingerprint.dependencySurfaces,
    };
    const cached = await cache.putFile(namespace, fingerprint.fingerprint, artifactName, output, manifest);
    return Object.freeze({ cache: 'miss', fingerprint, indexFile: cached });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
