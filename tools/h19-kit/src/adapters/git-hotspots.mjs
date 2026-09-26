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

export async function gitHotspots({
  cwd = process.cwd(),
  since = '90 days ago',
  maxCommits = 5000,
} = {}) {
  const log = await git([
    'log',
    `--max-count=${maxCommits}`,
    `--since=${since}`,
    '--format=format:__H19__%H%x09%an',
    '--numstat',
    '--no-renames',
  ], cwd);

  const files = new Map();
  let current = null;
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith('__H19__')) {
      const [commit, ...authorParts] = line.slice('__H19__'.length).split('\t');
      current = { commit, author: authorParts.join('\t') };
      continue;
    }
    if (!line.trim() || !current) continue;
    const [addedRaw, deletedRaw, file] = line.split('\t');
    if (!file) continue;
    const added = addedRaw === '-' ? 0 : Number(addedRaw);
    const deleted = deletedRaw === '-' ? 0 : Number(deletedRaw);
    const row = files.get(file) ?? {
      path: file,
      commits: new Set(),
      authors: new Set(),
      additions: 0,
      deletions: 0,
    };
    row.commits.add(current.commit);
    row.authors.add(current.author);
    row.additions += Number.isFinite(added) ? added : 0;
    row.deletions += Number.isFinite(deleted) ? deleted : 0;
    files.set(file, row);
  }

  return [...files.values()]
    .map((x) => ({
      path: x.path,
      commits: x.commits.size,
      authors: x.authors.size,
      additions: x.additions,
      deletions: x.deletions,
      churn: x.additions + x.deletions,
      hotspotScore: x.commits.size * Math.log2(2 + x.additions + x.deletions),
    }))
    .sort((a, b) => b.hotspotScore - a.hotspotScore || b.churn - a.churn || a.path.localeCompare(b.path));
}

export function missingCompanions(couplings, changedPaths, {
  minConfidence = 0.75,
  minShared = 3,
} = {}) {
  const changed = new Set(changedPaths);
  const found = [];

  for (const row of couplings) {
    if (row.shared < minShared) continue;
    if (changed.has(row.a) && !changed.has(row.b) && row.confidenceAtoB >= minConfidence) {
      found.push({ changed: row.a, missing: row.b, confidence: row.confidenceAtoB, shared: row.shared });
    }
    if (changed.has(row.b) && !changed.has(row.a) && row.confidenceBtoA >= minConfidence) {
      found.push({ changed: row.b, missing: row.a, confidence: row.confidenceBtoA, shared: row.shared });
    }
  }

  return found.sort((a, b) => b.confidence - a.confidence || b.shared - a.shared);
}
