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

export function normalizeTrustedReceipts(raw, baseSha) {
  if (!Array.isArray(raw) || !sha.test(baseSha ?? '')) return [];
  const seen = new Set();
  const receipts = [];
  for (const item of raw) {
    const headSha = item?.headSha;
    const receiptBaseSha = item?.baseSha;
    const runId = Number(item?.runId);
    if (!sha.test(headSha ?? '') || receiptBaseSha !== baseSha
      || !Number.isSafeInteger(runId) || runId <= 0 || seen.has(headSha)) continue;
    seen.add(headSha);
    receipts.push({ headSha, baseSha: receiptBaseSha, runId });
  }
  return receipts;
}

function readTrustedReceipts(target) {
  if (!target) return [];
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function selectScope({
  root = process.cwd(),
  eventName,
  event,
  git,
  trustedReceipts = [],
} = {}) {
  const run = git ?? ((args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }));

  try {
    if (eventName === 'pull_request') {
      const baseSha = event.pull_request?.base?.sha;
      const headSha = event.pull_request?.head?.sha;
      if (!sha.test(baseSha ?? '') || !sha.test(headSha ?? '')) throw new Error('Missing PR revisions');

      const mergeBase = run(['merge-base', baseSha, headSha]).trim();
      if (!sha.test(mergeBase)) throw new Error('Missing merge base');
      const fullPaths = diffPaths(run(['diff', '--name-status', '-z', '--no-renames', mergeBase, headSha, '--']));

      if (event.action === 'synchronize') {
        const receipts = normalizeTrustedReceipts(trustedReceipts, baseSha);
        for (const receipt of receipts) {
          if (receipt.headSha === headSha) continue;
          let lineageBase;
          try {
            lineageBase = run(['merge-base', receipt.headSha, headSha]).trim();
          } catch {
            continue;
          }
          if (lineageBase !== receipt.headSha) continue;

          let deltaPaths;
          try {
            deltaPaths = diffPaths(run([
              'diff', '--name-status', '-z', '--no-renames', receipt.headSha, headSha, '--',
            ]));
          } catch {
            continue;
          }
          if (classifyPaths(deltaPaths) === 'docs') {
            return {
              mode: 'docs',
              reason: 'green-descendant-docs-only',
              count: deltaPaths.length,
              inheritedFrom: receipt.headSha,
              inheritedRunId: receipt.runId,
            };
          }
        }
      }

      return { mode: 'code', reason: 'git-diff', count: fullPaths.length };
    }

    if (eventName === 'push') {
      const base = event.before;
      const head = event.after;
      if (!sha.test(base ?? '') || !sha.test(head ?? '') || /^0+$/.test(base) || /^0+$/.test(head)) {
        throw new Error('Missing revisions');
      }
      const paths = diffPaths(run(['diff', '--name-status', '-z', '--no-renames', base, head, '--']));
      return { mode: classifyPaths(paths), reason: 'git-diff', count: paths.length };
    }

    throw new Error('Unknown event');
  } catch {
    return { mode: 'code', reason: 'full-fallback', count: 0 };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let event = {};
  try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* full fallback */ }

  const trustedReceipts = readTrustedReceipts(process.env.TRUSTED_CI_RECEIPTS_FILE);
  const result = selectScope({
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
    trustedReceipts,
  });

  console.log(`CI scope: ${result.mode}; ${result.reason}; ${result.count} changed paths.`);
  if (result.inheritedFrom) {
    console.log(`Reusing full-code evidence from green ancestor ${result.inheritedFrom} (run ${result.inheritedRunId}).`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nreason=${result.reason}\n`);
    if (result.inheritedFrom) {
      appendFileSync(process.env.GITHUB_OUTPUT,
        `inherited_from=${result.inheritedFrom}\ninherited_run_id=${result.inheritedRunId}\n`);
    }
  }
}
