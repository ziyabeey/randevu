import { classifyPaths } from './ci-scope.mjs';

const sha = /^[a-f0-9]{40}$/;
const roles = ['R1', 'R2'];
const genericBots = new Set(['copilot-pull-request-reviewer[bot]', 'chatgpt-codex-connector[bot]']);

export function sameIdentity(a, b) {
  return a?.state === 'open' && b?.state === 'open' && a?.number === b?.number
    && sha.test(a?.head?.sha ?? '') && sha.test(a?.base?.sha ?? '')
    && a.head.sha === b?.head?.sha && a.base.sha === b?.base?.sha;
}

export function classifyFileRecords(files, expectedCount) {
  if (!Array.isArray(files) || files.length !== expectedCount) return 'unknown';
  const paths = [];
  for (const file of files) {
    if (!file || typeof file.filename !== 'string') return 'unknown';
    paths.push(file.filename);
    if (file.status === 'renamed') {
      if (typeof file.previous_filename !== 'string') return 'unknown';
      paths.push(file.previous_filename);
    }
  }
  return classifyPaths(paths);
}

export function parseReviewerAllowlist(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Roles come only from configured identities AND an explicit structured receipt.
// Arbitrary prose, GitHub approvals and generic code-review bots are never role evidence.
export function verifiedReceipts(items, pr, allowlist = {}) {
  if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)
      || roles.some((role) => allowlist[role] !== undefined && !Array.isArray(allowlist[role]))) {
    return [];
  }
  const configured = Object.fromEntries(roles.map((role) => [
    role,
    Array.isArray(allowlist[role]) ? allowlist[role] : [],
  ]));
  const found = [];
  for (const item of items) {
    const author = item?.user?.login;
    if (!author || genericBots.has(author) || author === pr.user?.login) continue;
    const matches = [...String(item.body ?? '').matchAll(/<!-- development-review-receipt\s+(\{[^\n]*\})\s*-->/g)];
    if (matches.length !== 1) continue;
    let receipt;
    try { receipt = JSON.parse(matches[0][1]); } catch { continue; }
    const { role, headSha, baseSha, prNumber } = receipt;
    if (!roles.includes(role) || !configured[role].includes(author)
      || roles.some((other) => other !== role && configured[other].includes(author))
      || prNumber !== pr.number || !sha.test(headSha ?? '') || !sha.test(baseSha ?? '')
      || (item.commit_id && item.commit_id !== headSha)
      || !Number.isSafeInteger(item.id) || !item.html_url) continue;
    const receiptTime = Date.parse(item.submitted_at ?? item.created_at ?? item.updated_at ?? '');
    found.push({
      role, author, headSha, baseSha, id: item.id,
      observedAt: Number.isFinite(receiptTime) ? receiptTime : 0,
      url: item.html_url,
      freshness: headSha === pr.head.sha && baseSha === pr.base.sha ? 'current' : 'stale',
    });
  }
  // Comment IDs and review IDs are unrelated namespaces. Use GitHub timestamps for chronology;
  // numeric ID is only a deterministic tie-breaker within equal/missing timestamps.
  return roles.flatMap((role) => found.filter((r) => r.role === role)
    .sort((a, b) => b.observedAt - a.observedAt || b.id - a.id)
    .slice(0, 1));
}

export function freshnessReport(pr, receipts) {
  return ['## Stale Review Detector · Deterministic', '',
    `PR: #${pr.number}`, `Current head: ${pr.head.sha}`, `Current base: ${pr.base.sha}`, '',
    ...roles.map((role) => {
      const r = receipts.find((entry) => entry.role === role);
      return r ? `${role}: ${r.url} · receipt head ${r.headSha} · receipt base ${r.baseSha} · freshness ${r.freshness}`
        : `${role}: unknown — no verified role receipt`;
    }), '', '_Advisory only. Exact staleness does not imply semantic re-review. No dispatch, acceptance or R1/R2 satisfaction._'].join('\n');
}
