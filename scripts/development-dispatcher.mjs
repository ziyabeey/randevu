function stableList(values) {
  return [...new Set(Array.from(values ?? []).filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function cloneReview(review = {}) {
  return {
    required: Boolean(review.required),
    verdict: review.verdict ?? 'not_required',
    reviewedHeadSha: review.reviewedHeadSha ?? null,
    receipt: review.receipt ?? 'missing',
  };
}

function defaultSnapshot() {
  return {
    candidate: {
      taskId: null,
      prNumber: null,
      branch: null,
      state: 'none',
      headSha: null,
      baseMainSha: null,
      mergeSha: null,
    },
    task: {
      dependencyState: 'ready',
      sharedWriter: 'clear',
    },
    freshness: {
      observedHeadSha: null,
      liveHeadSha: null,
    },
    ci: {
      status: 'missing',
      exactHeadSha: null,
      testedCheckoutSha: null,
      baseMainSha: null,
      explicitlyBoundToHead: false,
    },
    r0: {
      applies: false,
      receipt: 'missing',
      freeze: 'unknown',
      frozenBlockers: [],
      lineage: 'same_head',
      change: 'same',
    },
    reviews: {
      r1: cloneReview(),
      r2: cloneReview(),
    },
    proofs: [],
    postMain: {
      status: 'none',
      mergeSha: null,
    },
    sourceRefs: [],
  };
}

export function normalizeDispatcherSnapshot(input = {}) {
  const base = defaultSnapshot();
  const snapshot = {
    candidate: { ...base.candidate, ...(input.candidate ?? {}) },
    task: { ...base.task, ...(input.task ?? {}) },
    freshness: { ...base.freshness, ...(input.freshness ?? {}) },
    ci: { ...base.ci, ...(input.ci ?? {}) },
    r0: { ...base.r0, ...(input.r0 ?? {}) },
    reviews: {
      r1: cloneReview(input.reviews?.r1),
      r2: cloneReview(input.reviews?.r2),
    },
    proofs: (input.proofs ?? []).map((proof) => ({
      key: proof.key ?? null,
      status: proof.status ?? 'unknown',
      exactHeadSha: proof.exactHeadSha ?? null,
      required: proof.required !== false,
      sourceRef: proof.sourceRef ?? null,
    })),
    postMain: { ...base.postMain, ...(input.postMain ?? {}) },
    sourceRefs: stableList(input.sourceRefs),
  };
  snapshot.r0.frozenBlockers = stableList(snapshot.r0.frozenBlockers);
  return snapshot;
}

function withDecision(snapshot, draft) {
  return {
    candidate: {
      taskId: snapshot.candidate.taskId,
      prNumber: snapshot.candidate.prNumber,
      branch: snapshot.candidate.branch,
      state: snapshot.candidate.state,
      headSha: snapshot.candidate.headSha,
      baseMainSha: snapshot.candidate.baseMainSha,
      mergeSha: snapshot.candidate.mergeSha,
    },
    lifecycle: draft.lifecycle,
    nextRole: draft.nextRole,
    nextAction: draft.nextAction,
    mode: draft.mode,
    pendingReviews: stableList(draft.pendingReviews),
    reasonCodes: stableList(draft.reasonCodes),
    evidenceGaps: stableList(draft.evidenceGaps),
    review: {
      r0: {
        applies: snapshot.r0.applies,
        receipt: snapshot.r0.receipt,
        freeze: snapshot.r0.freeze,
        lineage: snapshot.r0.lineage,
        change: snapshot.r0.change,
        frozenBlockers: snapshot.r0.frozenBlockers,
      },
      r1: summarizeReview(snapshot.reviews.r1, snapshot.candidate.headSha, snapshot.r0),
      r2: summarizeReview(snapshot.reviews.r2, snapshot.candidate.headSha, snapshot.r0),
    },
    coordinatorInterventionRequired: draft.coordinatorInterventionRequired,
    sourceRefs: snapshot.sourceRefs,
  };
}

function summarizeReview(review, headSha, r0) {
  return {
    required: review.required,
    verdict: review.verdict,
    receipt: review.receipt,
    reviewedHeadSha: review.reviewedHeadSha,
    freshness: reviewFreshness(review, headSha, r0),
  };
}

function reviewFreshness(review, headSha, r0) {
  if (!review.required) return 'not_required';
  if (review.receipt === 'inaccessible') return 'unknown';
  if (review.verdict !== 'acceptable') return 'incomplete';
  if (review.reviewedHeadSha && headSha && review.reviewedHeadSha === headSha) return 'current';
  if (r0.lineage === 'descendant' && r0.change === 'docs_only_descendant') return 'current';
  if (r0.lineage === 'descendant' && r0.change === 'semantic_descendant') return 'stale';
  if (r0.lineage === 'non_descendant' || r0.lineage === 'unknown') return 'unknown';
  return 'unknown';
}

function addCurrentProofWarnings(snapshot, reasonCodes, evidenceGaps) {
  const headSha = snapshot.candidate.headSha;
  const blocked = [];
  for (const proof of snapshot.proofs) {
    if (!proof.required) continue;
    if (!proof.exactHeadSha || !headSha || proof.exactHeadSha !== headSha) continue;
    if (proof.status === 'pass') continue;
    blocked.push(proof.key ?? 'unnamed-proof');
    reasonCodes.add('CURRENT_PROOF_NOT_PASS');
    evidenceGaps.add(`PROOF_${String(proof.key ?? 'unnamed-proof').toUpperCase()}_${String(proof.status).toUpperCase()}`);
  }
  return blocked;
}

function classifyReviewNeeds(snapshot, reasonCodes, evidenceGaps) {
  const pending = [];
  for (const role of ['r1', 'r2']) {
    const review = snapshot.reviews[role];
    if (!review.required) continue;
    if (review.receipt === 'inaccessible') {
      reasonCodes.add(`${role.toUpperCase()}_RECEIPT_UNKNOWN`);
      evidenceGaps.add(`${role.toUpperCase()}_RECEIPT_UNKNOWN`);
      pending.push(role);
      continue;
    }
    if (review.verdict !== 'acceptable') {
      reasonCodes.add(`${role.toUpperCase()}_${String(review.verdict).toUpperCase()}`);
      evidenceGaps.add(`${role.toUpperCase()}_${String(review.verdict).toUpperCase()}`);
      pending.push(role);
      continue;
    }
    const freshness = reviewFreshness(review, snapshot.candidate.headSha, snapshot.r0);
    if (freshness === 'stale') {
      reasonCodes.add('SEMANTIC_ACCEPTANCE_STALE');
      evidenceGaps.add(`${role.toUpperCase()}_STALE`);
      pending.push(role);
      continue;
    }
    if (freshness === 'unknown') {
      reasonCodes.add(`${role.toUpperCase()}_PROVENANCE_UNKNOWN`);
      evidenceGaps.add(`${role.toUpperCase()}_PROVENANCE_UNKNOWN`);
      pending.push(role);
      continue;
    }
    if (snapshot.r0.lineage === 'descendant' && snapshot.r0.change === 'docs_only_descendant') {
      reasonCodes.add('DOCS_ONLY_DESCENDANT');
    }
  }
  return pending;
}

function ciStatusForHead(snapshot, reasonCodes, evidenceGaps) {
  const { ci, candidate } = snapshot;
  if (!candidate.headSha) {
    evidenceGaps.add('CANDIDATE_HEAD_UNKNOWN');
    return 'missing';
  }
  if (ci.exactHeadSha !== candidate.headSha) {
    reasonCodes.add('CI_HEAD_STALE');
    evidenceGaps.add('CI_HEAD_STALE');
    return 'missing';
  }
  if (ci.status === 'success') {
    if (!candidate.baseMainSha || !ci.baseMainSha) {
      reasonCodes.add('CI_BASE_UNKNOWN');
      evidenceGaps.add('CI_BASE_UNKNOWN');
      return 'missing';
    }
    if (candidate.baseMainSha !== ci.baseMainSha) {
      reasonCodes.add('CI_BASE_STALE');
      evidenceGaps.add('CI_BASE_STALE');
      return 'missing';
    }
    if (ci.testedCheckoutSha && ci.testedCheckoutSha !== candidate.headSha && !ci.explicitlyBoundToHead) {
      reasonCodes.add('CI_CHECKOUT_UNBOUND');
      evidenceGaps.add('CI_CHECKOUT_UNBOUND');
      return 'missing';
    }
  }
  return ci.status;
}

export function deriveEffectiveState(input = {}) {
  const snapshot = normalizeDispatcherSnapshot(input);
  const reasonCodes = new Set();
  const evidenceGaps = new Set();

  if (snapshot.freshness.observedHeadSha && snapshot.freshness.liveHeadSha
    && snapshot.freshness.observedHeadSha !== snapshot.freshness.liveHeadSha) {
    reasonCodes.add('SNAPSHOT_STALE');
    evidenceGaps.add('HEAD_CHANGED');
    return withDecision(snapshot, {
      lifecycle: 'SNAPSHOT_STALE',
      nextRole: 'coordinator',
      nextAction: 'REFRESH_SNAPSHOT',
      mode: null,
      pendingReviews: [],
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: true,
    });
  }

  if (snapshot.task.sharedWriter === 'conflict') {
    reasonCodes.add('SHARED_WRITER_CONFLICT');
    evidenceGaps.add('SHARED_WRITER_CONFLICT');
    return withDecision(snapshot, {
      lifecycle: 'PROVENANCE_CONFLICT',
      nextRole: 'coordinator',
      nextAction: 'RESOLVE_WRITER_SCOPE',
      mode: null,
      pendingReviews: [],
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: true,
    });
  }

  if (snapshot.candidate.state === 'none') {
    if (snapshot.task.dependencyState === 'blocked') {
      reasonCodes.add('DEPENDENCY_BLOCKED');
      evidenceGaps.add('DEPENDENCY_BLOCKED');
      return withDecision(snapshot, {
        lifecycle: 'DEPENDENCY_WAIT',
        nextRole: 'coordinator',
        nextAction: 'UNBLOCK_DEPENDENCY',
        mode: null,
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: true,
      });
    }
    if (snapshot.task.dependencyState === 'unknown') {
      reasonCodes.add('DEPENDENCY_UNKNOWN');
      evidenceGaps.add('DEPENDENCY_UNKNOWN');
      return withDecision(snapshot, {
        lifecycle: 'UNKNOWN',
        nextRole: 'coordinator',
        nextAction: 'CONFIRM_DEPENDENCIES',
        mode: null,
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: true,
      });
    }
    reasonCodes.add('NO_ACTIVE_CANDIDATE');
    return withDecision(snapshot, {
      lifecycle: 'IMPLEMENTATION_READY',
      nextRole: 'implementer',
      nextAction: 'START_IMPLEMENTATION',
      mode: null,
      pendingReviews: [],
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: false,
    });
  }

  if (snapshot.candidate.state === 'merged') {
    if (snapshot.postMain.status === 'success') {
      reasonCodes.add('POST_MAIN_SUCCESS');
      return withDecision(snapshot, {
        lifecycle: 'CLOSURE_CANDIDATE',
        nextRole: 'coordinator',
        nextAction: 'ASSESS_CLOSURE',
        mode: null,
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: true,
      });
    }
    reasonCodes.add('POST_MAIN_PENDING');
    if (snapshot.postMain.status === 'none') evidenceGaps.add('POST_MAIN_MISSING');
    return withDecision(snapshot, {
      lifecycle: 'POST_MAIN_VERIFY',
      nextRole: 'coordinator',
      nextAction: 'WAIT_POST_MAIN',
      mode: null,
      pendingReviews: [],
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: true,
    });
  }

  const ciState = ciStatusForHead(snapshot, reasonCodes, evidenceGaps);
  if (ciState === 'pending' || ciState === 'missing' || ciState === 'unknown' || ciState === 'cancelled'
    || ciState === 'skipped') {
    reasonCodes.add(ciState === 'pending' ? 'CI_PENDING' : 'CI_INCOMPLETE');
    return withDecision(snapshot, {
      lifecycle: 'WAIT_CI',
      nextRole: 'none',
      nextAction: 'WAIT_FOR_CI',
      mode: null,
      pendingReviews: [],
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: false,
    });
  }

  if (ciState === 'failure') {
    reasonCodes.add('CI_FAILED');
    return withDecision(snapshot, {
      lifecycle: 'CI_FAILED',
      nextRole: 'implementer',
      nextAction: 'REPAIR_CANDIDATE',
      mode: null,
      pendingReviews: [],
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: false,
    });
  }

  const blockedProofs = addCurrentProofWarnings(snapshot, reasonCodes, evidenceGaps);
  if (blockedProofs.length > 0) {
    return withDecision(snapshot, {
      lifecycle: 'WAIT_PROOF',
      nextRole: 'implementer',
      nextAction: 'ADDRESS_CURRENT_PROOF_GAPS',
      mode: null,
      pendingReviews: [],
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: false,
    });
  }

  if (snapshot.r0.applies) {
    if (snapshot.r0.receipt === 'inaccessible') {
      reasonCodes.add('R0_RECEIPT_UNKNOWN');
      evidenceGaps.add('R0_RECEIPT_UNKNOWN');
      return withDecision(snapshot, {
        lifecycle: 'UNKNOWN',
        nextRole: 'coordinator',
        nextAction: 'RECOVER_R0_RECEIPT',
        mode: null,
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: true,
      });
    }
    if (snapshot.r0.lineage === 'non_descendant') {
      reasonCodes.add('R0_PROVENANCE_CONFLICT');
      evidenceGaps.add('R0_PROVENANCE_CONFLICT');
      return withDecision(snapshot, {
        lifecycle: 'PROVENANCE_CONFLICT',
        nextRole: 'coordinator',
        nextAction: 'REFRESH_LINEAGE',
        mode: null,
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: true,
      });
    }
    if (snapshot.r0.lineage === 'unknown') {
      reasonCodes.add('R0_LINEAGE_UNKNOWN');
      evidenceGaps.add('R0_LINEAGE_UNKNOWN');
      return withDecision(snapshot, {
        lifecycle: 'UNKNOWN',
        nextRole: 'coordinator',
        nextAction: 'REFRESH_LINEAGE',
        mode: null,
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: true,
      });
    }
    if (snapshot.r0.receipt === 'missing') {
      reasonCodes.add('R0_DISCOVERY_REQUIRED');
      return withDecision(snapshot, {
        lifecycle: 'R0_REVIEW',
        nextRole: 'r0',
        nextAction: 'RUN_DISCOVERY',
        mode: 'DISCOVERY',
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: false,
      });
    }
    if (snapshot.r0.lineage === 'descendant') {
      reasonCodes.add('R0_VERIFICATION_REQUIRED');
      if (snapshot.r0.freeze === 'none') reasonCodes.add('R0_FROZEN_NONE');
      if (snapshot.r0.change === 'semantic_descendant') reasonCodes.add('SEMANTIC_ACCEPTANCE_STALE');
      if (snapshot.r0.change === 'docs_only_descendant') reasonCodes.add('DOCS_ONLY_DESCENDANT');
      return withDecision(snapshot, {
        lifecycle: 'R0_REVIEW',
        nextRole: 'r0',
        nextAction: 'RUN_VERIFICATION',
        mode: 'VERIFICATION',
        pendingReviews: [],
        reasonCodes,
        evidenceGaps,
        coordinatorInterventionRequired: false,
      });
    }
    if (snapshot.r0.freeze === 'none') reasonCodes.add('R0_FROZEN_NONE');
  }

  const pendingReviews = classifyReviewNeeds(snapshot, reasonCodes, evidenceGaps);
  if (pendingReviews.length > 0) {
    return withDecision(snapshot, {
      lifecycle: 'REVIEW_DISPATCH',
      nextRole: 'coordinator',
      nextAction: 'REQUEST_REQUIRED_REVIEWS',
      mode: null,
      pendingReviews,
      reasonCodes,
      evidenceGaps,
      coordinatorInterventionRequired: true,
    });
  }

  return withDecision(snapshot, {
    lifecycle: 'COORDINATOR_REVIEW',
    nextRole: 'coordinator',
    nextAction: 'REVIEW_CURRENT_EVIDENCE',
    mode: null,
    pendingReviews: [],
    reasonCodes,
    evidenceGaps,
    coordinatorInterventionRequired: true,
  });
}
