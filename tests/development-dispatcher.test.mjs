import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { deriveEffectiveState, normalizeDispatcherSnapshot } from '../scripts/development-dispatcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (value) => value.repeat(40);
const mainA = sha('a');
const headA = sha('b');
const mergeA = sha('c');
const oldHead = sha('d');
const mergeB = sha('e');
const mergeSha = sha('f');

function baseSnapshot(overrides = {}) {
  const input = {
    candidate: {
      taskId: 'DEV-ENGINE-EXPERIMENT',
      prNumber: 177,
      branch: 'copilot/experimentdev-dispatcher-copilot',
      state: 'pr',
      headSha: headA,
      baseMainSha: mainA,
    },
    freshness: {
      observedHeadSha: headA,
      liveHeadSha: headA,
    },
    ci: {
      status: 'success',
      exactHeadSha: headA,
      testedCheckoutSha: mergeA,
      baseMainSha: mainA,
      explicitlyBoundToHead: true,
    },
    reviews: {
      r1: { required: false, verdict: 'not_required', receipt: 'missing' },
      r2: { required: false, verdict: 'not_required', receipt: 'missing' },
    },
    sourceRefs: ['TASKS.md#dev-engine', 'docs/plan/agent-workflow.md#review-lineage-kernel'],
  };
  return {
    ...input,
    ...overrides,
    candidate: { ...input.candidate, ...(overrides.candidate ?? {}) },
    task: { dependencyState: 'ready', sharedWriter: 'clear', ...(overrides.task ?? {}) },
    freshness: { ...input.freshness, ...(overrides.freshness ?? {}) },
    ci: { ...input.ci, ...(overrides.ci ?? {}) },
    r0: { applies: false, receipt: 'missing', freeze: 'unknown', frozenBlockers: [], lineage: 'same_head', change: 'same', ...(overrides.r0 ?? {}) },
    reviews: {
      r1: { ...input.reviews.r1, ...(overrides.reviews?.r1 ?? {}) },
      r2: { ...input.reviews.r2, ...(overrides.reviews?.r2 ?? {}) },
    },
    proofs: overrides.proofs ?? [],
    postMain: { status: 'none', mergeSha: null, ...(overrides.postMain ?? {}) },
    sourceRefs: overrides.sourceRefs ?? input.sourceRefs,
  };
}

test('normalization is stable and deduplicates deterministic lists', () => {
  const normalized = normalizeDispatcherSnapshot({
    r0: { frozenBlockers: ['R0-B2', 'R0-B1', 'R0-B2'] },
    sourceRefs: ['b', 'a', 'b'],
  });
  assert.deepEqual(normalized.r0.frozenBlockers, ['R0-B1', 'R0-B2']);
  assert.deepEqual(normalized.sourceRefs, ['a', 'b']);
});

test('no active candidate routes to implementation or dependency wait', async (t) => {
  await t.test('implementation ready', () => {
    const result = deriveEffectiveState(baseSnapshot({
      candidate: { state: 'none', prNumber: null, headSha: null, baseMainSha: null },
      freshness: { observedHeadSha: null, liveHeadSha: null },
      ci: { status: 'missing', exactHeadSha: null, testedCheckoutSha: null, baseMainSha: null },
    }));
    assert.equal(result.lifecycle, 'IMPLEMENTATION_READY');
    assert.equal(result.nextRole, 'implementer');
    assert.ok(result.reasonCodes.includes('NO_ACTIVE_CANDIDATE'));
  });

  await t.test('dependency wait', () => {
    const result = deriveEffectiveState(baseSnapshot({
      candidate: { state: 'none', prNumber: null, headSha: null, baseMainSha: null },
      task: { dependencyState: 'blocked' },
      freshness: { observedHeadSha: null, liveHeadSha: null },
      ci: { status: 'missing', exactHeadSha: null, testedCheckoutSha: null, baseMainSha: null },
    }));
    assert.equal(result.lifecycle, 'DEPENDENCY_WAIT');
    assert.equal(result.nextRole, 'coordinator');
    assert.ok(result.evidenceGaps.includes('DEPENDENCY_BLOCKED'));
  });
});

test('PR candidate with pending exact-head CI waits for CI', () => {
  const result = deriveEffectiveState(baseSnapshot({
    ci: { status: 'pending' },
  }));
  assert.equal(result.lifecycle, 'WAIT_CI');
  assert.equal(result.nextAction, 'WAIT_FOR_CI');
  assert.ok(result.reasonCodes.includes('CI_PENDING'));
});

test('exact-head CI failure blocks reviewer dispatch', () => {
  const result = deriveEffectiveState(baseSnapshot({
    ci: { status: 'failure' },
    r0: { applies: true },
  }));
  assert.equal(result.lifecycle, 'CI_FAILED');
  assert.equal(result.nextRole, 'implementer');
  assert.equal(result.mode, null);
  assert.ok(result.reasonCodes.includes('CI_FAILED'));
});

test('exact-head CI success with no R0 freeze routes to R0 discovery', () => {
  const result = deriveEffectiveState(baseSnapshot({
    r0: { applies: true, receipt: 'missing' },
  }));
  assert.equal(result.lifecycle, 'R0_REVIEW');
  assert.equal(result.nextRole, 'r0');
  assert.equal(result.mode, 'DISCOVERY');
  assert.ok(result.reasonCodes.includes('R0_DISCOVERY_REQUIRED'));
});

test('durable R0 freeze with descendant repair routes to verification and preserves NONE', async (t) => {
  await t.test('frozen blockers descendant', () => {
    const result = deriveEffectiveState(baseSnapshot({
      r0: {
        applies: true,
        receipt: 'accessible',
        freeze: 'blockers',
        frozenBlockers: ['R0-B2', 'R0-B1'],
        lineage: 'descendant',
        change: 'semantic_descendant',
      },
    }));
    assert.equal(result.lifecycle, 'R0_REVIEW');
    assert.equal(result.mode, 'VERIFICATION');
    assert.deepEqual(result.review.r0.frozenBlockers, ['R0-B1', 'R0-B2']);
    assert.ok(result.reasonCodes.includes('SEMANTIC_ACCEPTANCE_STALE'));
  });

  await t.test('explicit NONE remains known-empty', () => {
    const result = deriveEffectiveState(baseSnapshot({
      r0: {
        applies: true,
        receipt: 'accessible',
        freeze: 'none',
        lineage: 'descendant',
        change: 'docs_only_descendant',
      },
    }));
    assert.equal(result.lifecycle, 'R0_REVIEW');
    assert.equal(result.mode, 'VERIFICATION');
    assert.equal(result.review.r0.freeze, 'none');
    assert.deepEqual(result.review.r0.frozenBlockers, []);
    assert.ok(result.reasonCodes.includes('R0_FROZEN_NONE'));
  });
});

test('missing or inaccessible prior R0 receipt stays unknown and never becomes NONE', () => {
  const result = deriveEffectiveState(baseSnapshot({
    r0: {
      applies: true,
      receipt: 'inaccessible',
      freeze: 'none',
      lineage: 'unknown',
      change: 'unknown',
    },
  }));
  assert.equal(result.lifecycle, 'UNKNOWN');
  assert.equal(result.nextRole, 'coordinator');
  assert.equal(result.review.r0.receipt, 'inaccessible');
  assert.ok(result.evidenceGaps.includes('R0_RECEIPT_UNKNOWN'));
});

test('non-descendant lineage becomes a provenance conflict', () => {
  const result = deriveEffectiveState(baseSnapshot({
    r0: {
      applies: true,
      receipt: 'accessible',
      freeze: 'blockers',
      lineage: 'non_descendant',
      change: 'non_descendant',
    },
  }));
  assert.equal(result.lifecycle, 'PROVENANCE_CONFLICT');
  assert.equal(result.nextRole, 'coordinator');
  assert.ok(result.reasonCodes.includes('R0_PROVENANCE_CONFLICT'));
});

test('docs-only descendants keep current acceptable reviews while semantic descendants invalidate them', async (t) => {
  await t.test('semantic descendant invalidates acceptance', () => {
    const result = deriveEffectiveState(baseSnapshot({
      r0: { change: 'semantic_descendant', lineage: 'descendant' },
      reviews: {
        r1: { required: true, verdict: 'acceptable', reviewedHeadSha: oldHead, receipt: 'accessible' },
      },
    }));
    assert.equal(result.lifecycle, 'REVIEW_DISPATCH');
    assert.deepEqual(result.pendingReviews, ['r1']);
    assert.ok(result.reasonCodes.includes('SEMANTIC_ACCEPTANCE_STALE'));
    assert.ok(result.evidenceGaps.includes('R1_STALE'));
  });

  await t.test('docs-only descendant does not force full semantic review', () => {
    const result = deriveEffectiveState(baseSnapshot({
      r0: { change: 'docs_only_descendant', lineage: 'descendant' },
      reviews: {
        r1: { required: true, verdict: 'acceptable', reviewedHeadSha: oldHead, receipt: 'accessible' },
      },
    }));
    assert.equal(result.lifecycle, 'COORDINATOR_REVIEW');
    assert.deepEqual(result.pendingReviews, []);
    assert.ok(result.reasonCodes.includes('DOCS_ONLY_DESCENDANT'));
  });
});

test('required R1 and R2 states remain distinct and block merge-ready inference', () => {
  const result = deriveEffectiveState(baseSnapshot({
    reviews: {
      r1: { required: true, verdict: 'pending', receipt: 'accessible' },
      r2: { required: true, verdict: 'blocker', receipt: 'accessible' },
    },
  }));
  assert.equal(result.lifecycle, 'REVIEW_DISPATCH');
  assert.deepEqual(result.pendingReviews, ['r1', 'r2']);
  assert.ok(result.reasonCodes.includes('R1_PENDING'));
  assert.ok(result.reasonCodes.includes('R2_BLOCKER'));
});

test('same raw head tested against stale or unknown base stays an integration evidence gap', async (t) => {
  for (const ci of [
    { baseMainSha: null },
    { baseMainSha: oldHead },
  ]) {
    await t.test(JSON.stringify(ci), () => {
      const result = deriveEffectiveState(baseSnapshot({ ci }));
      assert.equal(result.lifecycle, 'WAIT_CI');
      assert.ok(result.evidenceGaps.some((gap) => gap.startsWith('CI_BASE_')));
    });
  }
});

test('explicitly bound merge-ref differs from raw head without becoming stale', () => {
  const result = deriveEffectiveState(baseSnapshot({
    ci: { testedCheckoutSha: mergeB, explicitlyBoundToHead: true },
  }));
  assert.equal(result.lifecycle, 'COORDINATOR_REVIEW');
  assert.deepEqual(result.evidenceGaps, []);
});

test('current failing or pending proof cannot be masked by another pass', () => {
  const result = deriveEffectiveState(baseSnapshot({
    proofs: [
      { key: 'browser', status: 'pass', exactHeadSha: headA, required: true },
      { key: 'browser', status: 'fail', exactHeadSha: headA, required: true },
      { key: 'docs', status: 'pass', exactHeadSha: oldHead, required: true },
    ],
  }));
  assert.equal(result.lifecycle, 'WAIT_PROOF');
  assert.ok(result.reasonCodes.includes('CURRENT_PROOF_NOT_PASS'));
  assert.ok(result.evidenceGaps.includes('PROOF_BROWSER_FAIL'));
});

test('shared-writer overlap requires coordinator intervention', () => {
  const result = deriveEffectiveState(baseSnapshot({
    task: { sharedWriter: 'conflict' },
  }));
  assert.equal(result.lifecycle, 'PROVENANCE_CONFLICT');
  assert.equal(result.nextAction, 'RESOLVE_WRITER_SCOPE');
  assert.equal(result.coordinatorInterventionRequired, true);
});

test('head changes make the snapshot stale instead of current routing', () => {
  const result = deriveEffectiveState(baseSnapshot({
    freshness: { observedHeadSha: oldHead, liveHeadSha: headA },
  }));
  assert.equal(result.lifecycle, 'SNAPSHOT_STALE');
  assert.equal(result.nextAction, 'REFRESH_SNAPSHOT');
  assert.ok(result.evidenceGaps.includes('HEAD_CHANGED'));
});

test('merged candidate uses post-main verification and closure states', async (t) => {
  await t.test('post-main pending', () => {
    const result = deriveEffectiveState(baseSnapshot({
      candidate: { state: 'merged', mergeSha },
      postMain: { status: 'pending', mergeSha },
    }));
    assert.equal(result.lifecycle, 'POST_MAIN_VERIFY');
    assert.equal(result.nextRole, 'coordinator');
    assert.ok(result.reasonCodes.includes('POST_MAIN_PENDING'));
  });

  await t.test('post-main success', () => {
    const result = deriveEffectiveState(baseSnapshot({
      candidate: { state: 'merged', mergeSha },
      postMain: { status: 'success', mergeSha },
    }));
    assert.equal(result.lifecycle, 'CLOSURE_CANDIDATE');
    assert.equal(result.nextAction, 'ASSESS_CLOSURE');
    assert.ok(result.reasonCodes.includes('POST_MAIN_SUCCESS'));
  });
});

test('CLI prints the deterministic dispatcher decision as JSON', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'dispatcher-cli-'));
  try {
    const file = path.join(fixture, 'snapshot.json');
    writeFileSync(file, JSON.stringify(baseSnapshot({ ci: { status: 'pending' } })));
    const result = spawnSync(process.execPath, ['scripts/run-development-dispatcher.mjs', file], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.lifecycle, 'WAIT_CI');
    assert.equal(parsed.nextAction, 'WAIT_FOR_CI');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
