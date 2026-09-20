import { appendFileSync, readFileSync } from 'node:fs';
import { classifyFileRecords, freshnessReport, sameIdentity, verifiedReceipts } from './development-audit-gate.mjs';

const repo = process.env.REPOSITORY;
const number = Number(process.env.PR_NUMBER);
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid PR identity');
const root = `https://api.github.com/repos/${repo}`;
async function api(endpoint, method = 'GET', body) {
  const response = await fetch(root + endpoint, { method, headers: {
    Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${method} ${endpoint}`);
  return response.json();
}
async function pages(endpoint) {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const items = await api(`${endpoint}?per_page=100&page=${page}`);
    if (!Array.isArray(items)) throw new Error('Incomplete GitHub collection');
    all.push(...items);
    if (items.length < 100) return all;
  }
  throw new Error('Collection exceeds bounded evidence budget');
}
const pr = await api(`/pulls/${number}`);
if (pr.state !== 'open' || pr.head?.repo?.full_name !== repo) throw new Error('Only open same-repository PRs supported');
const files = await pages(`/pulls/${number}/files`);
let classification = classifyFileRecords(files, pr.changed_files);
let event = {};
try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* manual */ }
// A docs descendant of a code PR must not spend another model invocation either.
if (classification !== 'docs' && event.action === 'synchronize'
    && event.pull_request?.head?.sha === pr.head.sha && /^[a-f0-9]{40}$/.test(event.before ?? '')) {
  const compare = await api(`/compare/${event.before}...${pr.head.sha}`);
  if (compare.status === 'ahead' && compare.merge_base_commit?.sha === event.before
      && Array.isArray(compare.files) && compare.files.length < 300
      && classifyFileRecords(compare.files, compare.files.length) === 'docs') classification = 'docs';
}
if (!sameIdentity(pr, await api(`/pulls/${number}`))) throw new Error('PR moved during classification');
if (process.argv[2] === 'classify') {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `code=${classification === 'code'}\nhead=${pr.head.sha}\nbase=${pr.base.sha}\n`);
  console.log(`Audit classification: ${classification}; model eligible: ${classification === 'code'}`);
} else if (process.argv[2] === 'stale') {
  const marker = '<!-- development-stale-review -->';
  const allowlist = JSON.parse(process.env.DEVELOPMENT_REVIEWER_ALLOWLIST || '{}');
  async function reviewSnapshot() {
    const comments = await pages(`/issues/${number}/comments`);
    const reviews = await pages(`/pulls/${number}/reviews`);
    return {
      existing: comments.filter((c) => c.user?.login === 'github-actions[bot]' && c.body?.includes(marker)),
      receipts: verifiedReceipts([...comments, ...reviews], pr, allowlist),
    };
  }

  // Read once for bounded evidence, fence live PR identity, then refresh the receipt
  // collections immediately before deciding/publishing. A receipt arriving during
  // this job must not be overwritten by an advisory built from the older snapshot.
  await reviewSnapshot();
  if (!sameIdentity(pr, await api(`/pulls/${number}`))) throw new Error('Discard advisory: PR identity changed');
  const { existing, receipts } = await reviewSnapshot();
  if (!sameIdentity(pr, await api(`/pulls/${number}`))) throw new Error('Discard advisory: PR identity changed');

  // Retire an old misleading advisory, but don't create comments for a NO_ACTION event.
  if (!receipts.length && !existing.length) { console.log('NO_ACTION: no verified receipts; model calls: 0'); }
  else {
    const report = receipts.length ? freshnessReport(pr, receipts)
      : '## Stale Review Detector · Withdrawn\n\nPrevious advisory is not valid role/freshness evidence. No verified current R1/R2 assertion is made.\n\nNO_ACTION: metadata-only or no verified role receipts. Model calls: 0.';
    const body = `${marker}\n${report}`;
    if (existing.length) {
      for (const comment of existing) if (comment.body !== body)
        await api(`/issues/comments/${comment.id}`, 'PATCH', { body });
    } else await api(`/issues/${number}/comments`, 'POST', { body });
  }
} else throw new Error('Expected classify or stale');
