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

export function parseNxAffected(output) {
  return [...new Set(String(output ?? '')
    .split(/[\r\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean))].sort();
}

export async function nxAffected({
  cwd = process.cwd(),
  base = 'main',
  head = 'HEAD',
  executable = 'nx',
} = {}) {
  const output = await exec(executable, [
    'show', 'projects', '--affected',
    `--base=${base}`,
    `--head=${head}`,
    '--sep=,',
  ], cwd);
  return {
    provider: 'nx',
    base,
    head,
    projects: parseNxAffected(output),
  };
}
