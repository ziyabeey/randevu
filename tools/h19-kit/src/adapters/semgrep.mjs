import { spawn } from 'node:child_process';

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || code === 1) resolve({ code, stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 1000)}`));
    });
  });
}

export async function semgrepFacts({
  cwd = process.cwd(),
  config,
  targets = ['.'],
  executable = 'semgrep',
} = {}) {
  if (!config) throw new Error('semgrep config is required');
  const { stdout } = await run(executable, ['scan', '--json', '--config', config, ...targets], cwd);
  const parsed = JSON.parse(stdout || '{}');
  const results = Array.isArray(parsed.results) ? parsed.results : [];

  return results.map((r) => ({
    provider: 'semgrep-cli',
    checkId: r.check_id ?? 'unknown',
    path: r.path ?? null,
    start: r.start ?? null,
    end: r.end ?? null,
    message: r.extra?.message ?? '',
    severity: r.extra?.severity ?? 'INFO',
  }));
}
