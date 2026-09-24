import { spawn } from 'node:child_process';
import { FileCache, cacheKey } from '../core/cache.mjs';
import { temporalCoupling } from './git-history.mjs';
import { gitHotspots } from './git-hotspots.mjs';

function revParse(cwd, ref = 'HEAD') {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', ref], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim())));
  });
}

export async function historySnapshot({
  cwd = process.cwd(),
  since = '90 days ago',
  maxCommits = 2000,
  cache = new FileCache(),
} = {}) {
  const head = await revParse(cwd);
  const params = { head, since, maxCommits };
  const key = cacheKey('git-history-v1', params);
  const hit = await cache.get('git-history-v1', key);
  if (hit) return { ...hit, cache: 'hit' };

  const [couplings, hotspots] = await Promise.all([
    temporalCoupling({ cwd, since, maxCommits }),
    gitHotspots({ cwd, since, maxCommits }),
  ]);
  const value = {
    version: 1,
    head,
    since,
    maxCommits,
    couplings,
    hotspots,
  };
  await cache.set('git-history-v1', key, value);
  return { ...value, cache: 'miss' };
}
