import { spawn } from 'node:child_process';

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(err.trim() || `git exited ${code}`)));
  });
}

export async function temporalCoupling({
  cwd = process.cwd(),
  since = '90 days ago',
  maxCommits = 2000,
  minShared = 2,
} = {}) {
  const out = await git([
    'log', `--max-count=${maxCommits}`, `--since=${since}`,
    '--format=__H19_COMMIT__', '--name-only', '--no-renames',
  ], cwd);

  const commits = [];
  let current = null;
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '__H19_COMMIT__') {
      current = new Set();
      commits.push(current);
    } else if (line && current) {
      current.add(line);
    }
  }

  const fileCommits = new Map();
  const pairs = new Map();
  for (const files of commits) {
    const xs = [...files].sort();
    for (const file of xs) fileCommits.set(file, (fileCommits.get(file) ?? 0) + 1);
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const key = `${xs[i]}\0${xs[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  return [...pairs.entries()]
    .map(([key, shared]) => {
      const [a, b] = key.split('\0');
      const aCount = fileCommits.get(a) ?? 0;
      const bCount = fileCommits.get(b) ?? 0;
      return {
        a, b, shared,
        confidenceAtoB: aCount ? shared / aCount : 0,
        confidenceBtoA: bCount ? shared / bCount : 0,
      };
    })
    .filter((x) => x.shared >= minShared)
    .sort((x, y) => Math.max(y.confidenceAtoB, y.confidenceBtoA) - Math.max(x.confidenceAtoB, x.confidenceBtoA));
}
