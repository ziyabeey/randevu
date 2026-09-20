import { classifyPaths } from './ci-scope.mjs';

const sha = /^[a-f0-9]{40}$/;
const fingerprint = /^[a-f0-9]{64}$/;
const roles = ['R1', 'R2'];
const verdicts = ['ACCEPTABLE', 'BLOCKER', 'INCOMPLETE'];
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
export function authenticatedReceipts(items, pr, allowlist = {}) {
  if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)
      || roles.some((role) => !Array.isArray(allowlist[role]) || allowlist[role].length !== 1)
      || allowlist.R1[0] === allowlist.R2[0]) {
    return [];
  }

  const configured = Object.fromEntries(roles.map((role) => [role, allowlist[role][0]]));
  const launches = [];

  for (const item of items) {
    if (item?.user?.login !== 'github-actions[bot]') continue;
    const body = String(item.body ?? '');
    const marker = body.match(/<!-- development-review-launch:(r1|r2):([a-f0-9]{64}) -->/i);
    if (!marker || !/status:\s*ROUTINE_TRIGGERED/i.test(body)) continue;
    const role = marker[1].toUpperCase();
    const requestFingerprint = marker[2].toLowerCase();
    const headSha = body.match(/exact head:\s*([a-f0-9]{40})/i)?.[1]?.toLowerCase();
    const baseSha = body.match(/base main:\s*([a-f0-9]{40})/i)?.[1]?.toLowerCase();
    const dispatcherCaseFingerprint = body.match(/dispatcher case:\s*([a-f0-9]{64})/i)?.[1]?.toLowerCase();
    const roleRequest = body.match(/role request:\s*([a-f0-9]{64})/i)?.[1]?.toLowerCase();
    if (!sha.test(headSha ?? '') || !sha.test(baseSha ?? '')
        || !fingerprint.test(dispatcherCaseFingerprint ?? '')
        || roleRequest !== requestFingerprint) continue;
    launches.push({ role, requestFingerprint, dispatcherCaseFingerprint, headSha, baseSha });
  }

  const found = [];
  for (const item of items) {
    const author = item?.user?.login;
    if (!author || genericBots.has(author) || author === 'github-actions[bot]' || author === pr.user?.login) continue;
    const matches = [...String(item.body ?? '').matchAll(/<!-- development-review-receipt\s+(\{[^\n]*\})\s*-->/g)];
    if (matches.length !== 1) continue;

    let receipt;
    try { receipt = JSON.parse(matches[0][1]); } catch { continue; }

    const {
      schemaVersion, role, headSha, baseSha, prNumber,
      dispatcherCaseFingerprint, requestFingerprint, verdict,
    } = receipt;

    if (schemaVersion !== 'development-review-receipt.v1'
      || !roles.includes(role)
      || author !== configured[role]
      || prNumber !== pr.number
      || !sha.test(headSha ?? '')
      || !sha.test(baseSha ?? '')
      || !fingerprint.test(dispatcherCaseFingerprint ?? '')
      || !fingerprint.test(requestFingerprint ?? '')
      || !verdicts.includes(verdict)
      || (item.commit_id && item.commit_id !== headSha)
      || !Number.isSafeInteger(item.id)
      || !item.html_url) continue;

    const matchingLaunch = launches.find((launch) =>
      launch.role === role
      && launch.requestFingerprint === requestFingerprint
      && launch.dispatcherCaseFingerprint === dispatcherCaseFingerprint
      && launch.headSha === headSha
      && launch.baseSha === baseSha);
    if (!matchingLaunch) continue;

    const receiptTime = Date.parse(item.updated_at ?? item.submitted_at ?? item.created_at ?? '');
    found.push({
      role, author, headSha, baseSha, id: item.id, verdict,
      dispatcherCaseFingerprint, requestFingerprint,
      observedAt: Number.isFinite(receiptTime) ? receiptTime : 0,
      url: item.html_url,
      freshness: headSha === pr.head.sha && baseSha === pr.base.sha ? 'current' : 'stale',
    });
  }

  return found.sort((a, b) => b.observedAt - a.observedAt || b.id - a.id);
}

export function verifiedReceipts(items, pr, allowlist = {}) {
  const found = authenticatedReceipts(items, pr, allowlist);
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
      return r ? `${role}: ${r.url} · verdict ${r.verdict} · request ${r.requestFingerprint} · receipt head ${r.headSha} · receipt base ${r.baseSha} · freshness ${r.freshness}`
        : `${role}: unknown — no verified role receipt`;
    }), '', '_Advisory only. Exact staleness does not imply semantic re-review. No dispatch, acceptance or R1/R2 satisfaction._'].join('\n');
}
