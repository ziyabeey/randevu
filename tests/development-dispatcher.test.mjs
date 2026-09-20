import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  deriveConditions,
  deriveDispatcherResult,
  normalizeFacts,
  recommendNextAction,
} from '../scripts/development-dispatcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (value) => value.repeat(40);
const main = sha('a');
const head = sha('b');
const mergeRef = sha('c');
const oldHead = sha('d');
const mergeSha = sha('e');

function base(overrides = {}) {
  const input = {
    task: {
      id: 'DEV-ENGINE-EXPERIMENT',
      liveStatus: 'review',
      dependencyState: 'ready',
      assignmentState: 'assigned',
      writerStatus: 'clear',
    },
    candidate: {
      taskId: 'DEV-ENGINE-EXPERIMENT',
      prNumber: 179,
      branch: 'copilot/experimentdev-dispatcher-copilot',
      presence: 'active',
      headSha: head,
      baseMainSha: main,
      mergeSha: null,
    },
    observation: {
      observedHeadSha: head,
      liveHeadSha: head,
      observedMainSha: main,
      liveMainSha: main,
    },
    ci: {
      status: 'pass',
      exactHeadSha: head,
      testedCheckoutSha: mergeRef,
      baseMainSha: main,
      explicitlyBoundToHead: true,
      run: '1',
      job: '2',
      attempt: 1,
    },
    r0: {
      requirement: 'not_required',
      receipt: 'missing',
      freeze: 'unknown',
      frozenBlockers: [],
      blockerClosures: [],
      lineage: 'same_head',
      change: 'same',
      deltaConfirmation: 'unknown',
    },
    reviews: {
      r1: { requirement: 'not_required', verdict: 'not_required', receipt: 'missing', reviewedHeadSha: null },
      r2: { requirement: 'not_required', verdict: 'not_required', receipt: 'missing', reviewedHeadSha: null },
    },
    proofs: [],
    postMain: { status: 'not_applicable', mergeSha: null },
    sourceRefs: ['TASKS.md#development-tooling-track', 'docs/plan/agent-workflow.md#review-lineage-kernel'],
  };

  return {
    ...input,
    ...overrides,
    task: { ...input.task, ...(overrides.task ?? {}) },
    candidate: { ...input.candidate, ...(overrides.candidate ?? {}) },
    observation: { ...input.observation, ...(overrides.observation ?? {}) },
    ci: { ...input.ci, ...(overrides.ci ?? {}) },
    r0: { ...input.r0, ...(overrides.r0 ?? {}) },
    reviews: {
      r1: { ...input.reviews.r1, ...(overrides.reviews?.r1 ?? {}) },
      r2: { ...input.reviews.r2, ...(overrides.reviews?.r2 ?? {}) },
    },
    proofs: overrides.proofs ?? input.proofs,
    postMain: { ...input.postMain, ...(overrides.postMain ?? {}) },
    sourceRefs: overrides.sourceRefs ?? input.sourceRefs,
  };
}

function result(overrides) {
  return deriveDispatcherResult(base(overrides));
}

test('normalization keeps missing authority facts UNKNOWN instead of optimistic defaults', () => {
  const facts = normalizeFacts({});
  assert.equal(facts.task.dependencyState, 'unknown');
  assert.equal(facts.task.assignmentState, 'unknown');
  assert.equal(facts.task.writerStatus, 'unknown');
  assert.equal(facts.r0.requirement, 'unknown');
  assert.equal(facts.reviews.r1.requirement, 'unknown');
  assert.equal(facts.reviews.r2.requirement, 'unknown');
  assert.equal(facts.candidate.presence, 'unknown');
});

test('the three layers are independently inspectable and deterministic', () => {
  const facts = normalizeFacts(base());
  const conditions = deriveConditions(facts);
  const recommendation = recommendNextAction(conditions);
  assert.equal(conditions.state.ci.headApplicability, 'current');
  assert.equal(recommendation.suggestedAction, 'assess_current_evidence');
  assert.deepEqual(deriveDispatcherResult(base()), deriveDispatcherResult(base()));
});

test('implementation eligibility requires explicit ready dependency, assignment and clear writer', async (t) => {
  const absent = {
    presence: 'absent', prNumber: null, branch: null, headSha: null, baseMainSha: null,
  };
  const observation = { observedHeadSha: null, liveHeadSha: null };

  await t.test('eligible only when explicit', () => {
    const output = result({
      task: { liveStatus: 'planned', dependencyState: 'ready', assignmentState: 'assigned', writerStatus: 'clear' },
      candidate: absent,
      observation,
      ci: { status: 'missing', exactHeadSha: null, testedCheckoutSha: null, baseMainSha: null },
    });
    assert.equal(output.recommendation.suggestedAction, 'implementation_eligible');
    assert.equal(output.recommendation.nextActor, 'implementer');
  });

  await t.test('unknown assignment refuses', () => {
    const output = result({
      task: { liveStatus: 'planned', dependencyState: 'ready', assignmentState: 'unknown', writerStatus: 'clear' },
      candidate: absent,
      observation,
      ci: { status: 'missing', exactHeadSha: null, testedCheckoutSha: null, baseMainSha: null },
    });
    assert.equal(output.recommendation.kind, 'refuse');
    assert.equal(output.recommendation.nextActor, 'coordinator');
  });
});


test('malformed SHA identity and candidate/snapshot disagreement refuse deterministic routing', async (t) => {
  await t.test('malformed SHA', () => {
    const output = result({ candidate: { headSha: 'not-a-sha' }, observation: { observedHeadSha: 'not-a-sha', liveHeadSha: 'not-a-sha' } });
    assert.ok(output.contradictions.includes('CANDIDATE_HEAD_SHA_INVALID'));
    assert.equal(output.recommendation.kind, 'refuse');
  });
  await t.test('candidate differs from observed head', () => {
    const output = result({ observation: { observedHeadSha: oldHead, liveHeadSha: oldHead } });
    assert.ok(output.contradictions.includes('CANDIDATE_OBSERVED_HEAD_MISMATCH'));
    assert.equal(output.recommendation.suggestedAction, 'resolve_contradictory_evidence');
  });
});

test('live main movement is visible even when head-bound observations are unchanged', () => {
  const output = result({ observation: { liveMainSha: oldHead } });
  assert.equal(output.state.snapshotFreshness, 'current');
  assert.equal(output.state.mainFreshness, 'stale');
  assert.equal(output.recommendation.suggestedAction, 'refresh_integration_base');
});

test('active candidate does not route past a blocked dependency', () => {
  const output = result({ task: { dependencyState: 'blocked' } });
  assert.equal(output.recommendation.kind, 'wait');
  assert.equal(output.recommendation.suggestedAction, 'wait_for_dependency');
});

test('head freshness invalidates every head-bound routing conclusion', () => {
  const output = result({ observation: { observedHeadSha: oldHead, liveHeadSha: head } });
  assert.equal(output.state.snapshotFreshness, 'stale');
  assert.equal(output.recommendation.kind, 'refuse');
  assert.equal(output.recommendation.suggestedAction, 'refresh_snapshot');
  assert.equal(output.recommendation.provenance[0].rule, 'R1_FRESHNESS_INVALIDATES_HEAD_BOUND_ROUTING');
});

test('writer conflict overrides otherwise green evidence without hiding other state', () => {
  const output = result({ task: { writerStatus: 'conflict' } });
  assert.equal(output.state.ci.result, 'pass');
  assert.equal(output.state.writer, 'conflict');
  assert.equal(output.recommendation.suggestedAction, 'resolve_writer_scope');
});

test('current CI failure is neutral investigation, never automatic candidate repair', () => {
  const output = result({ ci: { status: 'fail' } });
  assert.equal(output.state.ci.result, 'fail');
  assert.ok(output.obligations.some((item) => item.code === 'CI_FAILURE_INVESTIGATION_REQUIRED'));
  assert.equal(output.recommendation.nextActor, 'coordinator');
  assert.equal(output.recommendation.suggestedAction, 'investigate_current_ci_failure');
  assert.notEqual(output.recommendation.suggestedAction, 'repair_candidate');
});

test('main/base drift degrades integration evidence without marking the head stale', () => {
  const output = result({ ci: { baseMainSha: oldHead } });
  assert.equal(output.state.snapshotFreshness, 'current');
  assert.equal(output.state.ci.baseApplicability, 'stale');
  assert.equal(output.recommendation.suggestedAction, 'refresh_candidate_bound_ci_evidence');
});

test('an explicitly bound merge-ref is valid candidate evidence', () => {
  const output = result({ ci: { testedCheckoutSha: mergeRef, explicitlyBoundToHead: true } });
  assert.equal(output.state.ci.checkoutBinding, 'bound_merge_ref');
  assert.equal(output.recommendation.suggestedAction, 'assess_current_evidence');
});

test('R0 discovery, verification and frozen-blocker closure are distinct conditions', async (t) => {
  await t.test('missing durable receipt means discovery', () => {
    const output = result({ r0: { requirement: 'required', receipt: 'missing' } });
    assert.equal(output.state.r0.mode, 'discovery_needed');
    assert.equal(output.recommendation.nextActor, 'r0');
    assert.equal(output.recommendation.suggestedAction, 'run_r0_discovery');
  });

  await t.test('descendant repair means bounded verification', () => {
    const output = result({
      r0: {
        requirement: 'required', receipt: 'accessible', reviewedHeadSha: oldHead, freeze: 'none', lineage: 'descendant',
        change: 'semantic_descendant',
      },
    });
    assert.equal(output.state.r0.mode, 'verification_needed');
    assert.equal(output.recommendation.suggestedAction, 'run_r0_verification');
  });

  await t.test('same-head open frozen blocker is repair-eligible only with assignment', () => {
    const output = result({
      r0: {
        requirement: 'required', receipt: 'accessible', reviewedHeadSha: head, freeze: 'blockers', lineage: 'same_head',
        frozenBlockers: ['R0-B1'], blockerClosures: [{ id: 'R0-B1', status: 'open' }],
      },
    });
    assert.equal(output.state.r0.mode, 'blocked');
    assert.deepEqual(output.state.r0.openBlockers, ['R0-B1']);
    assert.equal(output.recommendation.suggestedAction, 'repair_frozen_r0_blockers');
  });

  await t.test('same-head unverified frozen blocker requires R0 verification', () => {
    const output = result({
      r0: {
        requirement: 'required', receipt: 'accessible', reviewedHeadSha: head, freeze: 'blockers', lineage: 'same_head',
        frozenBlockers: ['R0-B1'], blockerClosures: [{ id: 'R0-B1', status: 'unverified' }],
      },
    });
    assert.equal(output.state.r0.mode, 'verification_needed');
    assert.equal(output.recommendation.nextActor, 'r0');
  });

  await t.test('all same-head frozen blockers closed is satisfied', () => {
    const output = result({
      r0: {
        requirement: 'required', receipt: 'accessible', reviewedHeadSha: head, freeze: 'blockers', lineage: 'same_head',
        frozenBlockers: ['R0-B1'], blockerClosures: [{ id: 'R0-B1', status: 'closed' }],
      },
    });
    assert.equal(output.state.r0.mode, 'satisfied_blockers');
    assert.equal(output.recommendation.suggestedAction, 'assess_current_evidence');
  });
});

test('docs-only descendants never silently make stale review receipts current', async (t) => {
  const reviews = {
    r1: { requirement: 'required', verdict: 'acceptable', receipt: 'accessible', reviewedHeadSha: oldHead, reviewedBaseSha: main },
  };

  await t.test('unconfirmed delta requires coordinator confirmation', () => {
    const output = result({
      r0: { lineage: 'descendant', change: 'docs_only_descendant', deltaConfirmation: 'unconfirmed' },
      reviews,
    });
    assert.equal(output.state.reviews.r1.status, 'stale');
    assert.ok(output.obligations.some((item) => item.code === 'DOCS_ONLY_DELTA_CONFIRMATION_REQUIRED'));
    assert.equal(output.recommendation.suggestedAction, 'confirm_docs_only_delta');
  });

  await t.test('explicit confirmation carries review without relabeling it current', () => {
    const output = result({
      r0: {
        reviewedHeadSha: oldHead,
        lineage: 'descendant',
        change: 'docs_only_descendant',
        deltaConfirmation: 'confirmed',
      },
      reviews,
    });
    assert.equal(output.state.reviews.r1.freshness, 'carried_forward');
    assert.equal(output.state.reviews.r1.status, 'acceptable_carried_forward');
    assert.equal(output.recommendation.suggestedAction, 'assess_current_evidence');
  });

  await t.test('confirmation carries only the exact confirmed ancestor receipt', () => {
    const output = result({
      r0: {
        reviewedHeadSha: oldHead,
        lineage: 'descendant',
        change: 'docs_only_descendant',
        deltaConfirmation: 'confirmed',
      },
      reviews: {
        r1: {
          requirement: 'required',
          verdict: 'acceptable',
          receipt: 'accessible',
          reviewedHeadSha: sha('f'),
          reviewedBaseSha: main,
        },
      },
    });
    assert.equal(output.state.reviews.r1.freshness, 'stale');
    assert.equal(output.state.reviews.r1.status, 'stale');
    assert.equal(output.recommendation.suggestedAction, 'request_required_reviews');
  });
});

test('same-head independent review receipt from an older base is stale', () => {
  const output = result({
    reviews: {
      r1: {
        requirement: 'required',
        verdict: 'acceptable',
        receipt: 'accessible',
        reviewedHeadSha: head,
        reviewedBaseSha: oldHead,
      },
    },
  });
  assert.equal(output.state.reviews.r1.freshness, 'stale');
  assert.equal(output.state.reviews.r1.status, 'stale');
  assert.equal(output.recommendation.suggestedAction, 'request_required_reviews');
});

test('R1 and R2 remain independent obligations while recommendation can request both', () => {
  const output = result({
    reviews: {
      r1: { requirement: 'required', verdict: 'pending', receipt: 'missing' },
      r2: { requirement: 'required', verdict: 'pending', receipt: 'missing' },
    },
  });
  assert.ok(output.obligations.some((item) => item.code === 'R1_REVIEW_REQUIRED'));
  assert.ok(output.obligations.some((item) => item.code === 'R2_REVIEW_REQUIRED'));
  assert.deepEqual(output.recommendation.eligibleRoles, ['r1', 'r2']);
  assert.equal(output.recommendation.suggestedAction, 'request_required_reviews');
});


test('required non-pass proof without exact candidate SHA remains an explicit provenance gap', () => {
  const output = result({ proofs: [{ key: 'browser', status: 'fail', exactHeadSha: null, required: true }] });
  assert.ok(output.obligations.some((item) => item.code === 'UNBOUND_NON_PASS_PROOF:browser'));
  assert.equal(output.recommendation.kind, 'refuse');
  assert.equal(output.recommendation.suggestedAction, 'resolve_proof_provenance');
});

test('mixed current PASS/non-PASS proof is a first-class contradiction and cannot be masked', () => {
  const output = result({
    proofs: [
      { key: 'browser', status: 'pass', exactHeadSha: head, required: true },
      { key: 'browser', status: 'fail', exactHeadSha: head, required: true },
      { key: 'browser', status: 'fail', exactHeadSha: oldHead, required: true },
    ],
  });
  assert.ok(output.contradictions.includes('MIXED_CURRENT_PROOF_STATUS:browser'));
  assert.ok(output.obligations.some((item) => item.code === 'CURRENT_PROOF_NOT_PASS:browser'));
  assert.equal(output.recommendation.kind, 'refuse');
  assert.equal(output.recommendation.suggestedAction, 'resolve_contradictory_evidence');
});

test('historical non-pass proof does not poison a current pass', () => {
  const output = result({
    proofs: [
      { key: 'browser', status: 'pass', exactHeadSha: head, required: true },
      { key: 'browser', status: 'fail', exactHeadSha: oldHead, required: true },
    ],
  });
  assert.deepEqual(output.contradictions, []);
  assert.equal(output.recommendation.suggestedAction, 'assess_current_evidence');
});

test('structurally contradictory R0 freeze refuses routing', () => {
  const output = result({
    r0: {
      requirement: 'required', receipt: 'accessible', freeze: 'none', lineage: 'same_head',
      frozenBlockers: ['R0-B1'],
    },
  });
  assert.ok(output.contradictions.includes('R0_FREEZE_NONE_WITH_BLOCKERS'));
  assert.equal(output.recommendation.suggestedAction, 'resolve_contradictory_evidence');
});

test('merged candidate never becomes self-authorized closure', async (t) => {
  const candidate = { presence: 'merged', mergeSha, headSha: head };
  const ci = { status: 'missing', exactHeadSha: null, testedCheckoutSha: null, baseMainSha: null };

  await t.test('pending post-main waits', () => {
    const output = result({ candidate, ci, postMain: { status: 'pending', mergeSha } });
    assert.equal(output.recommendation.kind, 'wait');
    assert.equal(output.recommendation.suggestedAction, 'obtain_post_main_verification');
  });


  await t.test('pass without merge-SHA binding cannot support closure assessment', () => {
    const output = result({ candidate, ci, postMain: { status: 'pass', mergeSha: null } });
    assert.ok(output.obligations.some((item) => item.code === 'POST_MAIN_MERGE_BINDING_REQUIRED'));
    assert.equal(output.recommendation.kind, 'refuse');
    assert.equal(output.recommendation.suggestedAction, 'confirm_post_main_evidence');
  });

  await t.test('post-main pass only allows coordinator closure assessment', () => {
    const output = result({ candidate, ci, postMain: { status: 'pass', mergeSha } });
    assert.equal(output.recommendation.nextActor, 'coordinator');
    assert.equal(output.recommendation.suggestedAction, 'assess_closure_candidate');
    assert.notEqual(output.recommendation.suggestedAction, 'close_task');
  });
});

test('CLI prints the layered deterministic result', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'dispatcher-c-'));
  try {
    const inputFile = path.join(fixture, 'snapshot.json');
    const cliFile = path.join(root, 'scripts/run-development-dispatcher.mjs');
    writeFileSync(inputFile, JSON.stringify(base({ ci: { status: 'pending' } })));
    const completed = spawnSync(process.execPath, [cliFile, inputFile], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(completed.error);
    assert.equal(completed.status, 0, completed.stdout + completed.stderr);
    const parsed = JSON.parse(completed.stdout);
    assert.ok(parsed.facts);
    assert.ok(parsed.state);
    assert.ok(parsed.obligations);
    assert.equal(parsed.recommendation.suggestedAction, 'wait_for_ci');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
