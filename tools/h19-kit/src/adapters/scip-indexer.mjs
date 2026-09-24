import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

function exec(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (x) => { stdout += x; });
    child.stderr.on('data', (x) => { stderr += x; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 2000)}`)));
  });
}

export function scipTypeScriptArgs({
  inferTsconfig = false,
  pnpmWorkspaces = false,
  yarnWorkspaces = false,
  noGlobalCaches = true,
  progressBar = false,
} = {}) {
  if (pnpmWorkspaces && yarnWorkspaces) {
    throw new Error('choose at most one workspace mode');
  }
  const args = ['index'];
  if (inferTsconfig) args.push('--infer-tsconfig');
  if (pnpmWorkspaces) args.push('--pnpm-workspaces');
  if (yarnWorkspaces) args.push('--yarn-workspaces');
  if (noGlobalCaches) args.push('--no-global-caches');
  if (progressBar) args.push('--progress-bar');
  return args;
}

export async function indexTypeScriptScip({
  cwd = process.cwd(),
  executable = 'scip-typescript',
  indexPath = 'index.scip',
  ...options
} = {}) {
  const args = scipTypeScriptArgs(options);
  const result = await exec(executable, args, cwd);
  const resolved = path.resolve(cwd, indexPath);
  await access(resolved);
  return {
    provider: 'scip-typescript',
    executable,
    args,
    indexPath: resolved,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
