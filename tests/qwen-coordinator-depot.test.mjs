import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDepotEvidence,
  depotCommentBody,
  depotEligible,
  depotFetchRef,
  normalizeDepotStatus,
  parseDepotRunId,
  qwenEligibleDecisions,
  workflowHash,
} from '../scripts/qwen-coordinator/depot.mjs';

const headSha = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const decision = {
  prNumber: 7,
  taskId: 'F00-01',
  headSha,
  baseSha,
  syntheticClosure: false,
  choice: 'C',
  label: 'REVIEW',
  reason: 'review needed',
  ci: { status: 'pending' },
  surface: { docsOnly: false, incomplete: false },
  gaps: [],
  readyEligible: false,
  mergeEligible: false,
};
const pr = {
  number: 7,
  headSha,
  baseSha,
  headRef: 'feature/test',
  fromFork: false,
};

test('Depot run identity parsing rejects ambiguous output', () => {
  assert.equal(parseDepotRunId('Run ID: 39ccx70t42'), '39ccx70t42');
  assert.equal(parseDepotRunId('{"run_id":"39ccx70t42"}'), '39ccx70t42');
  assert.equal(parseDepotRunId('ambiguous 39ccx70t42 and z177hxw1tj'), null);
  assert.equal(workflowHash('abc').length, 64);
});

test('Depot starts only for an exact, mapped, non-doc PR while GitHub CI is pending', () => {
  assert.equal(depotEligible(pr, decision, { depotShadowEnabled: true }), true);
  assert.equal(depotEligible(pr, {
    ...decision,
    surface: { docsOnly: true, incomplete: false },
  }, { depotShadowEnabled: true }), false);
  assert.equal(depotEligible({ ...pr, headRef: '../unsafe' }, decision, {
    depotShadowEnabled: true,
  }), false);
  assert.deepEqual(depotFetchRef(pr), {
    remoteRef: 'refs/heads/feature/test',
    localRef: 'refs/qwen-coordinator/pr-7',
  });
  assert.throws(() => depotFetchRef({ ...pr, headRef: '../unsafe' }), /Unsafe Depot PR fetch identity/);
});

test('Depot payload normalization preserves pass/fail evidence', () => {
  const passPayload = {
    run_id: '39ccx70t42',
    status: 'finished',
    workflows: [{
      status: 'finished',
      jobs: [{ status: 'finished', attempts: [{ status: 'finished', view_url: 'https://depot.dev/run' }] }],
    }],
  };
  assert.deepEqual(normalizeDepotStatus(passPayload), {
    status: 'pass',
    runId: '39ccx70t42',
    viewUrl: 'https://depot.dev/run',
    failedJobs: [],
    rawStatus: 'finished',
  });
  assert.equal(normalizeDepotStatus({
    run_id: 'x',
    status: 'failed',
    workflows: [{ jobs: [{ job_key: 'verify', status: 'failed', attempts: [] }] }],
  }).status, 'fail');
});

test('CI conflicts and identity errors fail closed', () => {
  const pendingDepot = applyDepotEvidence({ ...decision, ci: { status: 'pass' } }, {
    headSha, baseSha, runId: '39ccx70t42', status: 'running', workflowHash: 'a'.repeat(64),
  });
  assert.equal(pendingDepot.choice, 'A');
  assert.ok(pendingDepot.gaps.includes('DEPOT_SHADOW_PENDING'));

  const earlyFailure = applyDepotEvidence(decision, {
    headSha, baseSha, runId: '39ccx70t42', status: 'fail', workflowHash: 'a'.repeat(64),
  });
  assert.equal(earlyFailure.choice, 'B');

  const conflict = applyDepotEvidence({ ...decision, ci: { status: 'pass' } }, {
    headSha, baseSha, runId: '39ccx70t42', status: 'fail', workflowHash: 'a'.repeat(64),
  });
  assert.equal(conflict.choice, 'A');
  assert.ok(conflict.gaps.includes('CI_EVIDENCE_CONFLICT'));

  const invalidIdentity = applyDepotEvidence({ ...decision, ci: { status: 'pass' } }, {
    headSha, baseSha, runId: '39ccx70t42', status: 'identity-error', workflowHash: 'a'.repeat(64),
  });
  assert.equal(invalidIdentity.choice, 'A');
  assert.ok(invalidIdentity.gaps.includes('DEPOT_IDENTITY_UNVERIFIED'));

  const staleBase = applyDepotEvidence({
    ...decision,
    choice: 'D',
    label: 'MERGE',
    ci: { status: 'pass' },
    mergeEligible: true,
  }, {
    headSha,
    baseSha: '3'.repeat(40),
    runId: '39ccx70t42',
    status: 'pass',
    workflowHash: 'a'.repeat(64),
  });
  assert.equal(staleBase.depot.status, 'not-run');
  assert.equal(staleBase.choice, 'A');
  assert.ok(staleBase.gaps.includes('DEPOT_SHADOW_MISSING'));
  assert.equal(staleBase.mergeEligible, false);
});

test('Qwen sees only dual-green review/merge candidates', () => {
  const bothGreen = applyDepotEvidence({ ...decision, ci: { status: 'pass' } }, {
    headSha, baseSha, runId: '39ccx70t42', status: 'pass', workflowHash: 'a'.repeat(64),
  });
  assert.equal(qwenEligibleDecisions([bothGreen]).length, 1);
  assert.equal(qwenEligibleDecisions([{
    ...bothGreen,
    surface: { docsOnly: true },
  }]).length, 0);

  const comment = depotCommentBody({
    status: 'pass',
    headSha,
    baseSha,
    runId: '39ccx70t42',
    viewUrl: 'https://depot.dev/run',
    workflowHash: 'a'.repeat(64),
    treeSha: 'b'.repeat(40),
    observedSha: headSha,
    failedJobs: [],
  }, 'shadow-v1');
  assert.match(comment, /does not replace the required GitHub `CI gate`/);
  assert.match(comment, new RegExp(headSha));
});
