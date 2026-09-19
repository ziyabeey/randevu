import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  TRUSTED_CONTROL_FILES,
  eventIdentity,
  exactRunAssociation,
  fullCodeGate,
  lookupTrustedFullCodeReceipt,
  sameTrustedControlPlane,
} from '../scripts/ci-receipt-broker.mjs';

const sha = (c) => c.repeat(40);
const base = sha('a');
const current = sha('c');
const previous = sha('b');
const trustedBlob = sha('d');

function event(action = 'synchronize') {
  return {
    action,
    number: 190,
    pull_request: {
      number: 190,
      base: { sha: base },
      head: { sha: current },
    },
  };
}

function run({
  id = 11,
  pr = 190,
  runBase = base,
  sourceHead = previous,
  extraAssociations = [],
} = {}) {
  return {
    id,
    head_sha: sha('e'),
    pull_requests: [{
      number: pr,
      base: { sha: runBase },
      head: { sha: sourceHead },
    }, ...extraAssociations],
  };
}

function jobs({
  code = 'success',
  aggregate = 'success',
  gateConclusion = 'success',
  gateCount = 1,
} = {}) {
  const gate = {
    id: 77,
    name: 'CI gate',
    conclusion: gateConclusion,
    steps: [
      { name: 'Run all required code checks', conclusion: code },
      { name: 'Require the selected checks to complete', conclusion: aggregate },
    ],
  };
  return { jobs: Array.from({ length: gateCount }, () => ({ ...gate })) };
}

function manifest(blob = trustedBlob) {
  return Object.fromEntries(TRUSTED_CONTROL_FILES.map((file) => [file, blob]));
}

function controlFileFromUrl(url) {
  const parsed = new URL(url);
  const marker = '/contents/';
  const index = parsed.pathname.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(parsed.pathname.slice(index + marker.length));
}

function makeFetch({
  history = { workflow_runs: [run()] },
  jobPayload = jobs(),
  baseManifest = manifest(),
  candidateManifest = manifest(),
} = {}) {
  return async (url) => {
    if (url.includes('actions/workflows/ci.yml/runs')) return history;
    if (url.includes('/actions/runs/11/jobs')) return jobPayload;

    const file = controlFileFromUrl(url);
    if (file) {
      const ref = new URL(url).searchParams.get('ref');
      const source = ref === base ? baseManifest : ref === previous ? candidateManifest : null;
      if (!source || !source[file]) throw new Error(`missing manifest entry ${file}@${ref}`);
      return { sha: source[file] };
    }

    throw new Error('unexpected ' + url);
  };
}

test('event identity is derived only from the trusted pull_request synchronize event', () => {
  assert.deepEqual(eventIdentity(event()), { prNumber: 190, baseSha: base, currentHeadSha: current });
  assert.equal(eventIdentity(event('opened')), null);
  assert.equal(eventIdentity({
    action: 'synchronize',
    pull_request: { number: 190, base: { sha: 'bad' }, head: { sha: current } },
  }), null);
});

test('run association is exact and uses the source PR head rather than workflow head_sha', () => {
  const identity = eventIdentity(event());
  assert.deepEqual(exactRunAssociation(run(), identity), {
    runId: 11,
    sourceHeadSha: previous,
    baseSha: base,
  });
  assert.equal(exactRunAssociation(run({
    extraAssociations: [{ number: 191, base: { sha: base }, head: { sha: sha('f') } }],
  }), identity), null);
  assert.equal(exactRunAssociation(run({ pr: 191 }), identity), null);
  assert.equal(exactRunAssociation(run({ runBase: sha('f') }), identity), null);
  assert.equal(exactRunAssociation(run({ sourceHead: current }), identity), null);
});

test('full-code gate requires one successful CI gate and an actually executed code step', () => {
  assert.deepEqual(fullCodeGate(jobs()), { jobId: 77 });
  assert.equal(fullCodeGate(jobs({ code: 'skipped' })), null);
  assert.equal(fullCodeGate(jobs({ aggregate: 'failure' })), null);
  assert.equal(fullCodeGate(jobs({ gateCount: 2 })), null);
  const mixed = jobs();
  mixed.jobs.push({ ...mixed.jobs[0], id: 78, conclusion: 'failure' });
  assert.equal(fullCodeGate(mixed), null);
  assert.equal(fullCodeGate({ jobs: [] }), null);
});

test('trusted control plane requires every gate-defining blob to equal the canonical trust-root blob', () => {
  const baseManifest = manifest();
  assert.equal(sameTrustedControlPlane(baseManifest, manifest()), true);

  for (const file of TRUSTED_CONTROL_FILES) {
    const changed = manifest();
    changed[file] = sha('e');
    assert.equal(sameTrustedControlPlane(baseManifest, changed), false, file);
  }
  assert.equal(sameTrustedControlPlane(baseManifest, null), false);
});

test('control-plane manifest includes workflow, CI scripts, package scripts and indirect runners', () => {
  for (const file of [
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
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.worker.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'wrangler.jsonc',
  ]) assert.ok(TRUSTED_CONTROL_FILES.includes(file), file);
});

test('lookup returns a sanitized receipt only for same-PR/base full-code success with trusted control plane', async () => {
  const calls = [];
  const baseFetch = makeFetch();
  const result = await lookupTrustedFullCodeReceipt({
    event: event(),
    repo: 'ziyabeey1-ai/randevu',
    api: 'https://api.github.com',
    trustedControlRef: base,
    fetchJson: async (url) => {
      calls.push(url);
      return baseFetch(url);
    },
  });

  assert.equal(result.reason, 'trusted_full_code_receipt');
  assert.deepEqual(result.receipts, [{
    headSha: previous,
    baseSha: base,
    runId: 11,
    jobId: 77,
    fullCode: true,
  }]);
  assert.ok(calls.some((url) => url.includes('actions/workflows/ci.yml/runs')));
});

test('lookup fails closed for docs-only success, ambiguous association and any changed control-plane file', async () => {
  const scenarios = [
    { history: { workflow_runs: [run()] }, jobPayload: jobs({ code: 'skipped' }), candidateManifest: manifest() },
    {
      history: { workflow_runs: [run({
        extraAssociations: [{ number: 191, base: { sha: base }, head: { sha: sha('f') } }],
      })] },
      jobPayload: jobs(),
      candidateManifest: manifest(),
    },
  ];

  for (const file of TRUSTED_CONTROL_FILES) {
    const changed = manifest();
    changed[file] = sha('e');
    scenarios.push({ history: { workflow_runs: [run()] }, jobPayload: jobs(), candidateManifest: changed });
  }

  for (const scenario of scenarios) {
    const result = await lookupTrustedFullCodeReceipt({
      event: event(),
      repo: 'ziyabeey1-ai/randevu',
      api: 'https://api.github.com',
      trustedControlRef: base,
      fetchJson: makeFetch(scenario),
    });
    assert.deepEqual(result.receipts, []);
  }
});

test('lookup follows bounded pagination and can find an older valid full-code receipt', async () => {
  const wrongRuns = Array.from({ length: 100 }, (_, index) => run({
    id: 1000 + index,
    pr: 999,
    sourceHead: sha(index % 2 ? 'e' : 'f'),
  }));

  const baseFetch = makeFetch();
  const fetchJson = async (url) => {
    if (url.includes('actions/workflows/ci.yml/runs')) {
      const page = new URL(url).searchParams.get('page');
      return page === '1' ? { workflow_runs: wrongRuns } : { workflow_runs: [run()] };
    }
    return baseFetch(url);
  };

  const result = await lookupTrustedFullCodeReceipt({
    event: event(),
    repo: 'ziyabeey1-ai/randevu',
    api: 'https://api.github.com',
    trustedControlRef: base,
    fetchJson,
    maxPages: 2,
  });
  assert.equal(result.reason, 'trusted_full_code_receipt');
  assert.equal(result.receipts[0].runId, 11);
});

test('malformed or unavailable history/control manifests produce no receipt instead of throwing', async () => {
  for (const history of [null, {}, { workflow_runs: null }]) {
    const result = await lookupTrustedFullCodeReceipt({
      event: event(),
      repo: 'ziyabeey1-ai/randevu',
      api: 'https://api.github.com',
      trustedControlRef: base,
      fetchJson: makeFetch({ history }),
    });
    assert.deepEqual(result.receipts, []);
  }

  const missingBase = manifest();
  delete missingBase['scripts/ci-code.mjs'];
  const noBase = await lookupTrustedFullCodeReceipt({
    event: event(),
    repo: 'ziyabeey1-ai/randevu',
    api: 'https://api.github.com',
    trustedControlRef: base,
    fetchJson: makeFetch({ baseManifest: missingBase }),
  });
  assert.deepEqual(noBase.receipts, []);

  const failed = await lookupTrustedFullCodeReceipt({
    event: event(),
    repo: 'ziyabeey1-ai/randevu',
    api: 'https://api.github.com',
    trustedControlRef: base,
    fetchJson: async () => { throw new Error('network'); },
  });
  assert.deepEqual(failed.receipts, []);
});

test('reusable broker workflow has no caller identity inputs and executes token-bearing code only from canonical main', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/ci-receipt-broker.yml'), 'utf8');
  assert.doesNotMatch(workflow, /pr_number:|base_sha:|current_head_sha:/);
  assert.match(workflow, /ref: main/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /node scripts\/ci-receipt-broker\.mjs/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});
