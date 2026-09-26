import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { projectGraph } from '../impact/project-graph.mjs';

function execute(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 2000)}`)));
  });
}

export function normalizeNxGraph(raw = {}) {
  const graph = raw.graph ?? raw;
  const nodes = graph.nodes ?? {};
  const deps = graph.dependencies ?? {};

  const projects = Object.entries(nodes).map(([id, node]) => ({
    id,
    root: node?.data?.root ?? node?.root ?? '',
    metadata: {
      type: node?.type ?? node?.data?.projectType ?? null,
      tags: node?.data?.tags ?? [],
    },
  }));

  const dependencies = [];
  for (const [source, rows] of Object.entries(deps)) {
    for (const row of rows ?? []) {
      const target = row?.target ?? row;
      if (typeof target !== 'string') continue;
      dependencies.push({
        source,
        target,
        type: row?.type ?? 'static',
      });
    }
  }

  return projectGraph({ projects, dependencies });
}

export function parseNxAffected(stdout) {
  return [...new Set(String(stdout)
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean))]
    .sort();
}

export async function nxProjectGraph({
  cwd = process.cwd(),
  command = 'npx',
  executeCommand = execute,
} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'h19-nx-'));
  const file = path.join(dir, 'graph.json');
  try {
    await executeCommand(command, ['nx', 'graph', `--file=${file}`], { cwd });
    return normalizeNxGraph(JSON.parse(await readFile(file, 'utf8')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function nxAffectedProjects({
  cwd = process.cwd(),
  base,
  head,
  files = [],
  command = 'npx',
  executeCommand = execute,
} = {}) {
  const args = ['nx', 'show', 'projects', '--affected', '--sep=,'];
  if (base) args.push(`--base=${base}`);
  if (head) args.push(`--head=${head}`);
  if (files.length) args.push(`--files=${files.join(',')}`);
  const { stdout } = await executeCommand(command, args, { cwd });
  return parseNxAffected(stdout);
}
