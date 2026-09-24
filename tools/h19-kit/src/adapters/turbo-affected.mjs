import { spawn } from 'node:child_process';

function exec(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (x) => { stdout += x; });
    child.stderr.on('data', (x) => { stderr += x; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 2000)}`)));
  });
}

function itemsOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

export function parseTurboAffected(payload) {
  const data = payload?.data ?? payload ?? {};
  const packages = itemsOf(data.affectedPackages).map((x) => ({
    name: x.name ?? null,
    path: x.path ?? null,
    reason: x.reason ?? null,
  })).filter((x) => x.name || x.path);
  const tasks = itemsOf(data.affectedTasks).map((x) => ({
    name: x.name ?? x.task ?? null,
    package: x.package ?? x.packageName ?? null,
    reason: x.reason ?? null,
  }));
  return { packages, tasks };
}

export async function turboAffected({
  cwd = process.cwd(),
  base = 'main',
  head = 'HEAD',
  task = null,
  packages = [],
  executable = 'turbo',
} = {}) {
  const args = ['query', 'affected', '--base', base, '--head', head];
  if (task) args.push('--tasks', task);
  for (const pkg of packages) args.push('--packages', pkg);
  const output = await exec(executable, args, cwd);
  return {
    provider: 'turborepo',
    base,
    head,
    ...parseTurboAffected(JSON.parse(output)),
  };
}
