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

export function selectScope({ root = process.cwd(), eventName, event, git } = {}) {
  const run = git ?? ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  try {
    let base;
    let head;
    if (eventName === 'pull_request') {
      base = event.pull_request?.base?.sha;
      head = event.pull_request?.head?.sha;
      if (!sha.test(base ?? '') || !sha.test(head ?? '')) throw new Error('Missing PR revisions');
      base = run(['merge-base', base, head]).trim();
    } else if (eventName === 'push') {
      base = event.before;
      head = event.after;
    } else throw new Error('Unknown event');
    if (!sha.test(base ?? '') || !sha.test(head ?? '') || /^0+$/.test(base) || /^0+$/.test(head)) throw new Error('Missing revisions');
    // No pagination or changed-file cap; both rename sides are represented.
    const paths = diffPaths(run(['diff', '--name-status', '-z', '--no-renames', base, head, '--']));
    return { mode: classifyPaths(paths), reason: 'git-diff', count: paths.length };
  } catch {
    return { mode: 'code', reason: 'full-fallback', count: 0 };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let event = {};
  try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* full fallback */ }
  const result = selectScope({ eventName: process.env.GITHUB_EVENT_NAME, event });
  console.log(`CI scope: ${result.mode}; ${result.reason}; ${result.count} changed paths.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\n`);
}
