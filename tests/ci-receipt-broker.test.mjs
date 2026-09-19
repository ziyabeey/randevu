import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  eventIdentity,
  exactRunAssociation,
  fullCodeGate,
  lookupTrustedFullCodeReceipt,
  sameTrustedCiDefinition,
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

test('event identity is derived only from the trusted pull_request synchronize event', () => {
  assert.deepEqual(eventIdentity(event()), { prNumber: 190, baseSha: base, currentHeadSha: current });
  assert.equal(eventIdentity(event('opened')), null);
  assert.equal(eventIdentity({ action: 'synchronize', pull_request: { number: 190, base: { sha: 'bad' }, head: { sha: current } } }), null);
});

test('run association is exact and uses the source PR head rather than workflow head_sha', () => {
  const identity = eventIdentity(event());
  assert.deepEqual(exactRunAssociation(run(), identity), {
    runId: 11,
    sourceHeadSha: previous,
    baseSha: base,
  });
  assert.equal(exactRunAssociation(run({ extraAssociations: [{ number: 191, base: { sha: base }, head: { sha: sha('f') } }] }), identity), null);
  assert.equal(exactRunAssociation(run({ pr: 191 }), identity), null);
  assert.equal(exactRunAssociation(run({ runBase: sha('f') }), identity), null);
  assert.equal(exactRunAssociation(run({ sourceHead: current }), identity), null);
});

test('full-code gate requires one successful CI gate and an actually executed code step', () => {
  assert.deepEqual(fullCodeGate(jobs()), { jobId: 77 });
  assert.equal(fullCodeGate(jobs({ code: 'skipped' })), null);
  assert.equal(fullCodeGate(jobs({ aggregate: 'failure' })), null);
  assert.equal(fullCodeGate(jobs({ gateCount: 2 })), null);
  assert.equal(fullCodeGate({ jobs: [] }), null);
});

test('trusted CI definition requires the candidate workflow blob to equal the exact base blob', () => {
  assert.equal(sameTrustedCiDefinition({ sha: trustedBlob }, { sha: trustedBlob }), true);
  assert.equal(sameTrustedCiDefinition({ sha: trustedBlob }, { sha: sha('e') }), false);
  assert.equal(sameTrustedCiDefinition({}, { sha: trustedBlob }), false);
});

test('lookup returns a sanitized receipt only for same-PR/base full-code success with trusted CI definition', async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes('contents/.github/workflows/ci.yml?ref=' + base)) return { sha: trustedBlob };
    if (url.includes('actions/workflows/ci.yml/runs')) return { workflow_runs: [run()] };
    if (url.includes('/actions/runs/11/jobs')) return jobs();
    if (url.includes('contents/.github/workflows/ci.yml?ref=' + previous)) return { sha: trustedBlob };
    throw new Error('unexpected ' + url);
  };

  const result = await lookupTrustedFullCodeReceipt({
    event: event(),
    repo: 'ziyabeey1-ai/randevu',
    api: 'https://api.github.com',
    fetchJson,
  });

  assert.equal(result.reason, 'trusted_full_code_receipt');
  assert.deepEqual(result.receipts, [{
    headSha: previous,
    baseSha: base,
    runId: 11,
    jobId: 77,
    fullCode: true,
    ciDefinitionSha: trustedBlob,
  }]);
  assert.ok(calls.some((url) => url.includes('actions/workflows/ci.yml/runs')));
});

test('lookup fails closed for docs-only success, ambiguous association and changed CI definition', async () => {
  const scenarios = [
    {
      candidate: run(),
      jobPayload: jobs({ code: 'skipped' }),
      candidateCi: { sha: trustedBlob },
    },
    {
      candidate: run({ extraAssociations: [{ number: 191, base: { sha: base }, head: { sha: sha('f') } }] }),
      jobPayload: jobs(),
      candidateCi: { sha: trustedBlob },
    },
    {
      candidate: run(),
      jobPayload: jobs(),
      candidateCi: { sha: sha('e') },
    },
  ];

  for (const scenario of scenarios) {
    const fetchJson = async (url) => {
      if (url.includes('contents/.github/workflows/ci.yml?ref=' + base)) return { sha: trustedBlob };
      if (url.includes('actions/workflows/ci.yml/runs')) return { workflow_runs: [scenario.candidate] };
      if (url.includes('/actions/runs/11/jobs')) return scenario.jobPayload;
      if (url.includes('contents/.github/workflows/ci.yml?ref=' + previous)) return scenario.candidateCi;
      throw new Error('unexpected ' + url);
    };
    const result = await lookupTrustedFullCodeReceipt({
      event: event(),
      repo: 'ziyabeey1-ai/randevu',
      api: 'https://api.github.com',
      fetchJson,
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

  const fetchJson = async (url) => {
    if (url.includes('contents/.github/workflows/ci.yml?ref=' + base)) return { sha: trustedBlob };
    if (url.includes('actions/workflows/ci.yml/runs')) {
      const page = new URL(url).searchParams.get('page');
      return page === '1' ? { workflow_runs: wrongRuns } : { workflow_runs: [run()] };
    }
    if (url.includes('/actions/runs/11/jobs')) return jobs();
    if (url.includes('contents/.github/workflows/ci.yml?ref=' + previous)) return { sha: trustedBlob };
    throw new Error('unexpected ' + url);
  };

  const result = await lookupTrustedFullCodeReceipt({
    event: event(),
    repo: 'ziyabeey1-ai/randevu',
    api: 'https://api.github.com',
    fetchJson,
    maxPages: 2,
  });
  assert.equal(result.reason, 'trusted_full_code_receipt');
  assert.equal(result.receipts[0].runId, 11);
});

test('malformed or unavailable history produces no receipt instead of throwing', async () => {
  for (const history of [null, {}, { workflow_runs: null }]) {
    const result = await lookupTrustedFullCodeReceipt({
      event: event(),
      repo: 'ziyabeey1-ai/randevu',
      api: 'https://api.github.com',
      fetchJson: async (url) => url.includes('contents/') ? { sha: trustedBlob } : history,
    });
    assert.deepEqual(result.receipts, []);
  }

  const failed = await lookupTrustedFullCodeReceipt({
    event: event(),
    repo: 'ziyabeey1-ai/randevu',
    api: 'https://api.github.com',
    fetchJson: async () => { throw new Error('network'); },
  });
  assert.deepEqual(failed.receipts, []);
});

test('reusable broker workflow has no caller identity inputs and executes only base-pinned trusted code', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/ci-receipt-broker.yml'), 'utf8');
  assert.doesNotMatch(workflow, /pr_number:|base_sha:|current_head_sha:/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /node scripts\/ci-receipt-broker\.mjs/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});
