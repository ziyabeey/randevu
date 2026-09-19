import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const BLOB_SHA = /^[a-f0-9]{40}$/;
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
export const TRUSTED_CONTROL_FILES = Object.freeze([
  '.github/workflows/ci.yml',
  'package.json',
  'package-lock.json',
  'scripts/ci-scope.mjs',
  'scripts/ci-docs.mjs',
  'scripts/ci-result.mjs',
  'scripts/ci-code.mjs',
  'scripts/ci-files.mjs',
  'scripts/ci-postgres.mjs',
  'scripts/ci-postgres-plan.json',
  'scripts/run-http-tests.mjs',
  'scripts/verify-ci-coverage.mjs',
  'scripts/report-npm-audit.mjs',
  'scripts/test-staging-control-db.mjs',
  'scripts/browser-smoke.sh',
]);

export function eventIdentity(event = {}) {
  if (event?.action !== 'synchronize') return null;
  const prNumber = Number(event?.pull_request?.number ?? event?.number);
  const baseSha = String(event?.pull_request?.base?.sha ?? '');
  const currentHeadSha = String(event?.pull_request?.head?.sha ?? '');
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0
    || !SHA.test(baseSha) || !SHA.test(currentHeadSha)) return null;
  return { prNumber, baseSha, currentHeadSha };
}

export function exactRunAssociation(run, identity) {
  if (!run || !identity || !Number.isSafeInteger(Number(run.id)) || Number(run.id) <= 0) return null;
  const associations = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  if (associations.length !== 1) return null;
  const pr = associations[0];
  const prNumber = Number(pr?.number);
  const baseSha = String(pr?.base?.sha ?? '');
  const sourceHeadSha = String(pr?.head?.sha ?? '');
  if (prNumber !== identity.prNumber || baseSha !== identity.baseSha || !SHA.test(sourceHeadSha)) return null;
  if (sourceHeadSha === identity.currentHeadSha) return null;
  return {
    runId: Number(run.id),
    sourceHeadSha,
    baseSha,
  };
}

export function fullCodeGate(jobsPayload) {
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : null;
  if (!jobs) return null;
  const gates = jobs.filter((job) => job?.name === 'CI gate' && job?.conclusion === 'success');
  if (gates.length !== 1) return null;
  const gate = gates[0];
  if (!Number.isSafeInteger(Number(gate?.id)) || Number(gate.id) <= 0 || !Array.isArray(gate.steps)) return null;
  const codeSteps = gate.steps.filter((step) => step?.name === 'Run all required code checks');
  const aggregateSteps = gate.steps.filter((step) => step?.name === 'Require the selected checks to complete');
  if (codeSteps.length !== 1 || aggregateSteps.length !== 1) return null;
  if (codeSteps[0]?.conclusion !== 'success' || aggregateSteps[0]?.conclusion !== 'success') return null;
  return { jobId: Number(gate.id) };
}

export function sameTrustedControlPlane(baseManifest, candidateManifest) {
  if (!baseManifest || !candidateManifest) return false;
  return TRUSTED_CONTROL_FILES.every((file) => {
    const baseBlob = String(baseManifest[file] ?? '');
    const candidateBlob = String(candidateManifest[file] ?? '');
    return BLOB_SHA.test(baseBlob) && candidateBlob === baseBlob;
  });
}

async function readControlManifest({ api, repo, ref, fetchJson }) {
  const manifest = {};
  for (const file of TRUSTED_CONTROL_FILES) {
    let payload;
    try {
      payload = await fetchJson(apiUrl(
        api,
        repo,
        `contents/${encodeURIComponent(file).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`,
      ));
    } catch {
      return null;
    }
    const blob = String(payload?.sha ?? '');
    if (!BLOB_SHA.test(blob)) return null;
    manifest[file] = blob;
  }
  return manifest;
}

function apiUrl(api, repo, suffix) {
  return `${String(api).replace(/\/$/, '')}/repos/${repo}/${suffix}`;
}

export async function lookupTrustedFullCodeReceipt({
  event,
  repo,
  api,
  fetchJson,
  maxPages = MAX_PAGES,
} = {}) {
  const identity = eventIdentity(event);
  if (!identity || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo ?? ''))
    || typeof fetchJson !== 'function' || !Number.isInteger(maxPages) || maxPages < 1) {
    return { receipts: [], reason: 'invalid_identity' };
  }

  const trustedBaseManifest = await readControlManifest({
    api,
    repo,
    ref: identity.baseSha,
    fetchJson,
  });
  if (!trustedBaseManifest) {
    return { receipts: [], reason: 'base_control_plane_unverifiable' };
  }

  for (let page = 1; page <= maxPages; page += 1) {
    let payload;
    try {
      const url = new URL(apiUrl(api, repo, 'actions/workflows/ci.yml/runs'));
      url.searchParams.set('event', 'pull_request');
      url.searchParams.set('status', 'success');
      url.searchParams.set('per_page', String(PAGE_SIZE));
      url.searchParams.set('page', String(page));
      payload = await fetchJson(url.toString());
    } catch {
      return { receipts: [], reason: 'history_unavailable' };
    }

    if (!Array.isArray(payload?.workflow_runs)) {
      return { receipts: [], reason: 'history_malformed' };
    }

    for (const run of payload.workflow_runs) {
      const association = exactRunAssociation(run, identity);
      if (!association) continue;

      let jobsPayload;
      try {
        jobsPayload = await fetchJson(apiUrl(api, repo, `actions/runs/${association.runId}/jobs?per_page=100`));
      } catch {
        continue;
      }
      const gate = fullCodeGate(jobsPayload);
      if (!gate) continue;

      const candidateManifest = await readControlManifest({
        api,
        repo,
        ref: association.sourceHeadSha,
        fetchJson,
      });
      if (!sameTrustedControlPlane(trustedBaseManifest, candidateManifest)) continue;

      return {
        receipts: [{
          headSha: association.sourceHeadSha,
          baseSha: identity.baseSha,
          runId: association.runId,
          jobId: gate.jobId,
          fullCode: true,
          controlPlaneSha: trustedBaseManifest['.github/workflows/ci.yml'],
        }],
        reason: 'trusted_full_code_receipt',
      };
    }

    if (payload.workflow_runs.length < PAGE_SIZE) {
      return { receipts: [], reason: 'no_full_code_receipt' };
    }
  }

  return { receipts: [], reason: 'bounded_history_exhausted' };
}

async function defaultFetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

async function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    event = {};
  }

  const repo = String(process.env.GITHUB_REPOSITORY ?? '');
  const api = String(process.env.GITHUB_API_URL ?? '');
  const token = String(process.env.GH_TOKEN ?? '');
  let result = { receipts: [], reason: 'runtime_unavailable' };

  if (token && /^https:\/\//.test(api)) {
    try {
      result = await lookupTrustedFullCodeReceipt({
        event,
        repo,
        api,
        fetchJson: (url) => defaultFetchJson(url, token),
      });
    } catch {
      result = { receipts: [], reason: 'lookup_failed_closed' };
    }
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `receipt_json=${JSON.stringify(result.receipts)}\n`, 'utf8');
  }
  console.log(`Trusted CI receipt broker: ${result.reason}; receipts=${result.receipts.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
