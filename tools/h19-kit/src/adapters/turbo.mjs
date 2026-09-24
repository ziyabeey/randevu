import { spawn } from 'node:child_process';

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

export function parseTurboLsJson(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const items = raw?.packages?.items;
  if (!Array.isArray(items)) throw new Error('unexpected turbo ls JSON: packages.items missing');

  return items.map((item) => {
    if (!item?.name) throw new Error('unexpected turbo ls JSON: package name missing');
    return Object.freeze({
      name: String(item.name),
      path: String(item.path ?? item.directory ?? ''),
    });
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function turboPackages({
  cwd = process.cwd(),
  affected = false,
  base = null,
  head = null,
  command = 'npx',
  executeCommand = execute,
} = {}) {
  const args = ['turbo', 'ls'];
  if (affected) args.push('--affected');
  args.push('--output=json');

  const env = { ...process.env };
  if (base) env.TURBO_SCM_BASE = base;
  if (head) env.TURBO_SCM_HEAD = head;

  const { stdout } = await executeCommand(command, args, { cwd, env });
  return parseTurboLsJson(stdout);
}

export async function turboAffectedPackages(options = {}) {
  return turboPackages({ ...options, affected: true });
}
