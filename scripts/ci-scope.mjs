import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDocs = new Set(['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'PROJECT_STATE.md',
  'PRODUCT_SPEC.md', 'ROADMAP.md', 'TASKS.md', 'DECISIONS.md', 'MVP_ACCEPTANCE.md']);
const sha = /^[a-f0-9]{40}$/;

export function classifyPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return 'code';
  return paths.every((name) => typeof name === 'string' && !name.includes('\0')
    && path.posix.normalize(name) === name && !name.startsWith('/') && !name.startsWith('../')
    && (rootDocs.has(name) || /^docs\/[^\r\n]+\.md$/.test(name))) ? 'docs' : 'code';
}

export function diffPaths(raw) {
  const parts = raw.split('\0');
  if (parts.pop() !== '') throw new Error('Incomplete diff');
  const paths = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!/^(?:[ACDMRTUXB]|[RC][0-9]{1,3})$/.test(status)) throw new Error('Invalid diff status');
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let n = 0; n < count; n++) {
      if (!parts[i]) throw new Error('Missing diff path');
      paths.push(parts[i++]);
    }
  }
  return paths;
}

export function findTrustedPreviousHead({ event, runs, complete = true } = {}) {
  if (!complete || event?.action !== 'synchronize' || !Array.isArray(runs)) return null;
  const previousHead = event.before;
  const baseSha = event.pull_request?.base?.sha;
  const prNumber = event.number ?? event.pull_request?.number;
  if (!sha.test(previousHead ?? '') || !sha.test(baseSha ?? '') || !Number.isInteger(prNumber)) return null;

  const match = runs.find((run) => run?.name === 'CI'
    && run?.conclusion === 'success'
    && run?.head_sha === previousHead
    && Array.isArray(run?.pull_requests)
    && run.pull_requests.some((pr) => pr?.number === prNumber && pr?.base?.sha === baseSha));

  return match ? { sha: previousHead, baseSha, runId: match.id ?? null } : null;
}

export function selectScope({ root = process.cwd(), eventName, event, git, trustedPreviousHead = null } = {}) {
  const run = git ?? ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  try {
    let base;
    let head;
    if (eventName === 'pull_request') {
      const baseSha = event.pull_request?.base?.sha;
      head = event.pull_request?.head?.sha;
      if (!sha.test(baseSha ?? '') || !sha.test(head ?? '')) throw new Error('Missing PR revisions');
      base = run(['merge-base', baseSha, head]).trim();
      if (!sha.test(base)) throw new Error('Missing merge base');

      const fullPaths = diffPaths(run(['diff', '--name-status', '-z', '--no-renames', base, head, '--']));
      const fullMode = classifyPaths(fullPaths);
      if (fullMode === 'docs') return { mode: 'docs', reason: 'git-diff', count: fullPaths.length };

      const previousHead = event.before;
      const trusted = event.action === 'synchronize'
        && sha.test(previousHead ?? '')
        && trustedPreviousHead?.sha === previousHead
        && trustedPreviousHead?.baseSha === baseSha;

      if (trusted) {
        const lineageBase = run(['merge-base', previousHead, head]).trim();
        if (lineageBase === previousHead) {
          const deltaPaths = diffPaths(run(['diff', '--name-status', '-z', '--no-renames', previousHead, head, '--']));
          if (classifyPaths(deltaPaths) === 'docs') {
            return {
              mode: 'docs',
              reason: 'green-descendant-docs-only',
              count: deltaPaths.length,
              inheritedFrom: previousHead,
              inheritedRunId: trustedPreviousHead.runId ?? null,
            };
          }
        }
      }

      return { mode: 'code', reason: 'git-diff', count: fullPaths.length };
    }

    if (eventName === 'push') {
      base = event.before;
      head = event.after;
      if (!sha.test(base ?? '') || !sha.test(head ?? '') || /^0+$/.test(base) || /^0+$/.test(head)) throw new Error('Missing revisions');
      const paths = diffPaths(run(['diff', '--name-status', '-z', '--no-renames', base, head, '--']));
      return { mode: classifyPaths(paths), reason: 'git-diff', count: paths.length };
    }

    throw new Error('Unknown event');
  } catch {
    return { mode: 'code', reason: 'full-fallback', count: 0 };
  }
}

async function fetchPreviousHeadRuns(event) {
  if (event?.action !== 'synchronize') return { runs: [], complete: false };
  const previousHead = event.before;
  const repository = process.env.GITHUB_REPOSITORY;
  const api = process.env.GITHUB_API_URL;
  const token = process.env.GITHUB_TOKEN;
  if (!sha.test(previousHead ?? '') || !repository || !api || !token) return { runs: [], complete: false };

  try {
    const url = new URL(`${api}/repos/${repository}/actions/runs`);
    url.searchParams.set('head_sha', previousHead);
    url.searchParams.set('event', 'pull_request');
    url.searchParams.set('status', 'completed');
    url.searchParams.set('per_page', '100');
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { runs: [], complete: false };
    const body = await response.json();
    const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
    const total = Number(body?.total_count);
    return { runs, complete: Number.isInteger(total) && total <= runs.length };
  } catch {
    return { runs: [], complete: false };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let event = {};
  try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* full fallback */ }
  const previous = await fetchPreviousHeadRuns(event);
  const trustedPreviousHead = findTrustedPreviousHead({ event, ...previous });
  const result = selectScope({ eventName: process.env.GITHUB_EVENT_NAME, event, trustedPreviousHead });
  console.log(`CI scope: ${result.mode}; ${result.reason}; ${result.count} changed paths.`);
  if (result.inheritedFrom) {
    console.log(`Reusing full-code evidence from green ancestor ${result.inheritedFrom}${result.inheritedRunId ? ` (run ${result.inheritedRunId})` : ''}.`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nreason=${result.reason}\n`);
    if (result.inheritedFrom) appendFileSync(process.env.GITHUB_OUTPUT, `inherited_from=${result.inheritedFrom}\n`);
  }
}
