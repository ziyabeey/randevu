function stableList(values) {
  return [...new Set(Array.from(values ?? [])
    .filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function stableObjects(values, key = 'code') {
  const seen = new Set();
  return Array.from(values ?? [])
    .filter((value) => value && typeof value === 'object' && typeof value[key] === 'string')
    .filter((value) => {
      const marker = JSON.stringify([value[key], value.role ?? null, value.source ?? null]);
      if (seen.has(marker)) return false;
      seen.add(marker);
      return true;
    })
    .sort((left, right) => {
      const a = `${left[key]}:${left.role ?? ''}:${left.source ?? ''}`;
      const b = `${right[key]}:${right.role ?? ''}:${right.source ?? ''}`;
      return a.localeCompare(b, 'en');
    });
}

function pick(value, allowed, fallback = 'unknown') {
  return allowed.includes(value) ? value : fallback;
}

function normalizeCandidate(candidate = {}) {
  const legacyState = candidate.state;
  const inferredPresence = legacyState === 'none'
    ? 'absent'
    : legacyState === 'pr'
      ? 'active'
      : legacyState === 'merged'
        ? 'merged'
        : 'unknown';

  return {
    taskId: candidate.taskId ?? null,
    prNumber: Number.isInteger(candidate.prNumber) ? candidate.prNumber : null,
    branch: candidate.branch ?? null,
    presence: pick(candidate.presence ?? inferredPresence, ['absent', 'active', 'merged', 'unknown']),
    headSha: candidate.headSha ?? null,
    baseMainSha: candidate.baseMainSha ?? null,
    mergeSha: candidate.mergeSha ?? null,
  };
}

function normalizeTask(task = {}) {
  return {
    id: task.id ?? null,
    liveStatus: pick(task.liveStatus, ['planned', 'active', 'review', 'merged', 'closed', 'blocked', 'unknown']),
    dependencyState: pick(task.dependencyState, ['ready', 'blocked', 'unknown']),
    assignmentState: pick(task.assignmentState, ['assigned', 'unassigned', 'unknown']),
    writerStatus: pick(task.writerStatus ?? task.sharedWriter, ['clear', 'conflict', 'unknown']),
  };
}

function normalizeObservation(observation = {}, freshness = {}) {
  return {
    observedHeadSha: observation.observedHeadSha ?? freshness.observedHeadSha ?? null,
    liveHeadSha: observation.liveHeadSha ?? freshness.liveHeadSha ?? null,
    observedMainSha: observation.observedMainSha ?? freshness.observedMainSha ?? null,
    liveMainSha: observation.liveMainSha ?? freshness.liveMainSha ?? null,
  };
}

function normalizeCi(ci = {}) {
  const status = ci.status === 'success'
    ? 'pass'
    : ci.status === 'failure'
      ? 'fail'
      : ci.status;
  return {
    status: pick(status, ['pass', 'fail', 'pending', 'cancelled', 'skipped', 'missing', 'unknown']),
    exactHeadSha: ci.exactHeadSha ?? ci.exactSha ?? null,
    testedCheckoutSha: ci.testedCheckoutSha ?? null,
    baseMainSha: ci.baseMainSha ?? null,
    explicitlyBoundToHead: ci.explicitlyBoundToHead === true,
    run: ci.run ?? null,
    job: ci.job ?? null,
    attempt: Number.isInteger(ci.attempt) ? ci.attempt : null,
  };
}

function normalizeR0(r0 = {}) {
  let requirement = r0.requirement;
  if (!requirement && Object.prototype.hasOwnProperty.call(r0, 'applies')) {
    requirement = r0.applies === true ? 'required' : r0.applies === false ? 'not_required' : 'unknown';
  }

  const blockerClosures = Array.from(r0.blockerClosures ?? []).map((entry) => ({
    id: typeof entry?.id === 'string' ? entry.id : null,
    status: pick(entry?.status, ['open', 'closed', 'unverified', 'unknown']),
    sourceRef: entry?.sourceRef ?? null,
  })).filter((entry) => entry.id);

  return {
    requirement: pick(requirement, ['required', 'not_required', 'unknown']),
    receipt: pick(r0.receipt, ['missing', 'accessible', 'inaccessible', 'unknown']),
    freeze: pick(r0.freeze, ['none', 'blockers', 'missing', 'unknown']),
    frozenBlockers: stableList(r0.frozenBlockers),
    blockerClosures: stableObjects(blockerClosures, 'id'),
    lineage: pick(r0.lineage, ['same_head', 'descendant', 'non_descendant', 'unknown']),
    change: pick(r0.change, ['same', 'docs_only_descendant', 'semantic_descendant', 'unknown']),
    deltaConfirmation: pick(r0.deltaConfirmation, ['confirmed', 'unconfirmed', 'unknown']),
  };
}

function normalizeReview(review = {}) {
  let requirement = review.requirement;
  if (!requirement && Object.prototype.hasOwnProperty.call(review, 'required')) {
    requirement = review.required === true ? 'required' : review.required === false ? 'not_required' : 'unknown';
  }
  return {
    requirement: pick(requirement, ['required', 'optional', 'not_required', 'unknown']),
    verdict: pick(review.verdict, ['pending', 'acceptable', 'blocker', 'incomplete', 'not_required', 'unknown']),
    receipt: pick(review.receipt, ['missing', 'accessible', 'inaccessible', 'unknown']),
    reviewedHeadSha: review.reviewedHeadSha ?? review.sha ?? null,
  };
}

function normalizeProof(proof = {}) {
  return {
    key: typeof proof.key === 'string' && proof.key ? proof.key : 'unnamed-proof',
    status: pick(proof.status, ['pass', 'fail', 'pending', 'skipped', 'unknown']),
    exactHeadSha: proof.exactHeadSha ?? proof.exact_sha ?? null,
    required: proof.required === false ? false : true,
    sourceRef: proof.sourceRef ?? proof.ref ?? null,
  };
}

function normalizePostMain(postMain = {}) {
  const status = postMain.status === 'success'
    ? 'pass'
    : postMain.status === 'failure'
      ? 'fail'
      : postMain.status;
  return {
    status: pick(status, ['pass', 'fail', 'pending', 'missing', 'not_applicable', 'unknown']),
    mergeSha: postMain.mergeSha ?? null,
  };
}

export function normalizeFacts(input = {}) {
  return {
    task: normalizeTask(input.task),
    candidate: normalizeCandidate(input.candidate),
    observation: normalizeObservation(input.observation, input.freshness),
    ci: normalizeCi(input.ci),
    r0: normalizeR0(input.r0),
    reviews: {
      r1: normalizeReview(input.reviews?.r1),
      r2: normalizeReview(input.reviews?.r2),
    },
    proofs: Array.from(input.proofs ?? []).map(normalizeProof),
    postMain: normalizePostMain(input.postMain),
    sourceRefs: stableList(input.sourceRefs),
  };
}

function addObligation(list, code, { role = null, source = null, blocking = true } = {}) {
  list.push({ code, role, source, blocking });
}

function headFreshness(facts, unknowns) {
  const { observedHeadSha, liveHeadSha } = facts.observation;
  if (!observedHeadSha || !liveHeadSha) {
    if (facts.candidate.presence === 'active') unknowns.add('HEAD_FRESHNESS_UNKNOWN');
    return facts.candidate.presence === 'active' ? 'unknown' : 'not_applicable';
  }
  return observedHeadSha === liveHeadSha ? 'current' : 'stale';
}

function mainFreshness(facts, unknowns) {
  const { observedMainSha, liveMainSha } = facts.observation;
  if (!observedMainSha || !liveMainSha) {
    unknowns.add('MAIN_FRESHNESS_UNKNOWN');
    return 'unknown';
  }
  return observedMainSha === liveMainSha ? 'current' : 'stale';
}

function deriveCi(facts, unknowns, obligations) {
  if (facts.candidate.presence !== 'active') {
    return {
      headApplicability: 'not_applicable',
      baseApplicability: 'not_applicable',
      checkoutBinding: 'not_applicable',
      result: facts.ci.status,
    };
  }

  let headApplicability = 'unknown';
  if (!facts.candidate.headSha) {
    unknowns.add('CANDIDATE_HEAD_UNKNOWN');
  } else if (!facts.ci.exactHeadSha) {
    headApplicability = facts.ci.status === 'missing' ? 'missing' : 'unknown';
    unknowns.add('CI_HEAD_BINDING_UNKNOWN');
  } else {
    headApplicability = facts.ci.exactHeadSha === facts.candidate.headSha ? 'current' : 'stale';
  }

  let baseApplicability = 'unknown';
  if (!facts.candidate.baseMainSha || !facts.ci.baseMainSha) {
    unknowns.add('CI_BASE_BINDING_UNKNOWN');
  } else {
    baseApplicability = facts.candidate.baseMainSha === facts.ci.baseMainSha ? 'current' : 'stale';
  }

  let checkoutBinding = 'unknown';
  if (!facts.ci.testedCheckoutSha) {
    unknowns.add('CI_TESTED_CHECKOUT_UNKNOWN');
  } else if (facts.ci.testedCheckoutSha === facts.candidate.headSha) {
    checkoutBinding = 'raw_head';
  } else if (facts.ci.explicitlyBoundToHead) {
    checkoutBinding = 'bound_merge_ref';
  } else {
    checkoutBinding = 'unbound';
  }

  if (headApplicability === 'stale') addObligation(obligations, 'REFRESH_CI_FOR_CURRENT_HEAD', { source: 'ci' });
  if (baseApplicability === 'stale') addObligation(obligations, 'REFRESH_INTEGRATION_EVIDENCE', { source: 'ci' });
  if (checkoutBinding === 'unbound') addObligation(obligations, 'BIND_TESTED_CHECKOUT_TO_CANDIDATE', { source: 'ci' });

  if (headApplicability === 'current' && facts.ci.status === 'fail') {
    addObligation(obligations, 'CI_FAILURE_INVESTIGATION_REQUIRED', { source: 'ci' });
  }
  if (headApplicability === 'current' && facts.ci.status === 'pending') {
    addObligation(obligations, 'CI_PENDING', { source: 'ci' });
  }

  return {
    headApplicability,
    baseApplicability,
    checkoutBinding,
    result: facts.ci.status,
  };
}

function deriveR0(facts, contradictions, unknowns, obligations) {
  const r0 = facts.r0;
  if (r0.freeze === 'none' && r0.frozenBlockers.length > 0) {
    contradictions.add('R0_FREEZE_NONE_WITH_BLOCKERS');
  }
  if (r0.freeze === 'blockers' && r0.frozenBlockers.length === 0) {
    contradictions.add('R0_BLOCKER_FREEZE_WITHOUT_BLOCKERS');
  }

  if (r0.requirement === 'not_required') return { mode: 'not_applicable', openBlockers: [], unverifiedBlockers: [] };
  if (r0.requirement === 'unknown') {
    unknowns.add('R0_REQUIREMENT_UNKNOWN');
    return { mode: 'unknown', openBlockers: [], unverifiedBlockers: [] };
  }

  if (r0.receipt === 'inaccessible') {
    unknowns.add('R0_RECEIPT_INACCESSIBLE');
    addObligation(obligations, 'RECOVER_R0_RECEIPT', { role: 'coordinator', source: 'r0' });
    return { mode: 'unknown', openBlockers: [], unverifiedBlockers: [] };
  }
  if (r0.receipt === 'unknown') {
    unknowns.add('R0_RECEIPT_UNKNOWN');
    return { mode: 'unknown', openBlockers: [], unverifiedBlockers: [] };
  }
  if (r0.receipt === 'missing') {
    addObligation(obligations, 'R0_DISCOVERY_REQUIRED', { role: 'r0', source: 'r0' });
    return { mode: 'discovery_needed', openBlockers: [], unverifiedBlockers: [] };
  }
  if (r0.lineage === 'non_descendant') {
    addObligation(obligations, 'R0_LINEAGE_REFRESH_REQUIRED', { role: 'coordinator', source: 'r0' });
    return { mode: 'conflict', openBlockers: [], unverifiedBlockers: [] };
  }
  if (r0.lineage === 'unknown') {
    unknowns.add('R0_LINEAGE_UNKNOWN');
    return { mode: 'unknown', openBlockers: [], unverifiedBlockers: [] };
  }
  if (r0.lineage === 'descendant') {
    addObligation(obligations, 'R0_VERIFICATION_REQUIRED', { role: 'r0', source: 'r0' });
    return { mode: 'verification_needed', openBlockers: [], unverifiedBlockers: [] };
  }

  if (r0.freeze === 'none') return { mode: 'satisfied_none', openBlockers: [], unverifiedBlockers: [] };
  if (r0.freeze === 'missing' || r0.freeze === 'unknown') {
    unknowns.add('R0_FREEZE_UNKNOWN');
    return { mode: 'unknown', openBlockers: [], unverifiedBlockers: [] };
  }

  const closureById = new Map(r0.blockerClosures.map((entry) => [entry.id, entry.status]));
  const openBlockers = [];
  const unverifiedBlockers = [];
  for (const id of r0.frozenBlockers) {
    const status = closureById.get(id) ?? 'unverified';
    if (status === 'open') openBlockers.push(id);
    if (status === 'unverified' || status === 'unknown') unverifiedBlockers.push(id);
  }

  if (openBlockers.length > 0) {
    addObligation(obligations, 'R0_FROZEN_BLOCKER_REPAIR_REQUIRED', { role: 'implementer', source: 'r0' });
    return { mode: 'blocked', openBlockers: stableList(openBlockers), unverifiedBlockers: stableList(unverifiedBlockers) };
  }
  if (unverifiedBlockers.length > 0) {
    addObligation(obligations, 'R0_VERIFICATION_REQUIRED', { role: 'r0', source: 'r0' });
    return { mode: 'verification_needed', openBlockers: [], unverifiedBlockers: stableList(unverifiedBlockers) };
  }
  return { mode: 'satisfied_blockers', openBlockers: [], unverifiedBlockers: [] };
}

function reviewFreshness(facts, review) {
  if (!facts.candidate.headSha || !review.reviewedHeadSha) return 'unknown';
  if (review.reviewedHeadSha === facts.candidate.headSha) return 'current';
  if (facts.r0.lineage === 'descendant'
    && facts.r0.change === 'docs_only_descendant'
    && facts.r0.deltaConfirmation === 'confirmed') return 'carried_forward';
  if (facts.r0.lineage === 'descendant') return 'stale';
  if (facts.r0.lineage === 'non_descendant') return 'conflict';
  return 'unknown';
}

function deriveReview(role, facts, unknowns, obligations) {
  const review = facts.reviews[role];
  if (review.requirement === 'not_required') {
    return { requirement: 'not_required', verdict: review.verdict, freshness: 'not_applicable', status: 'not_required' };
  }
  if (review.requirement === 'unknown') {
    unknowns.add(`${role.toUpperCase()}_REQUIREMENT_UNKNOWN`);
    return { requirement: 'unknown', verdict: review.verdict, freshness: 'unknown', status: 'unknown' };
  }
  if (review.requirement === 'optional') {
    return { requirement: 'optional', verdict: review.verdict, freshness: reviewFreshness(facts, review), status: 'optional' };
  }

  if (review.receipt === 'inaccessible') {
    unknowns.add(`${role.toUpperCase()}_RECEIPT_INACCESSIBLE`);
    addObligation(obligations, `${role.toUpperCase()}_RECEIPT_RECOVERY_REQUIRED`, { role: 'coordinator', source: role });
    return { requirement: 'required', verdict: review.verdict, freshness: 'unknown', status: 'unknown' };
  }

  const freshness = reviewFreshness(facts, review);
  if (review.receipt === 'unknown') {
    unknowns.add(`${role.toUpperCase()}_RECEIPT_UNKNOWN`);
    return { requirement: 'required', verdict: review.verdict, freshness, status: 'unknown' };
  }
  if (review.receipt === 'missing' || review.verdict === 'pending' || review.verdict === 'incomplete' || review.verdict === 'unknown') {
    addObligation(obligations, `${role.toUpperCase()}_REVIEW_REQUIRED`, { role, source: role });
    return { requirement: 'required', verdict: review.verdict, freshness, status: 'pending' };
  }
  if (review.verdict === 'not_required') {
    unknowns.add(`${role.toUpperCase()}_REQUIRED_BUT_VERDICT_NOT_REQUIRED`);
    return { requirement: 'required', verdict: review.verdict, freshness, status: 'unknown' };
  }

  if (freshness === 'current' || freshness === 'carried_forward') {
    if (review.verdict === 'acceptable') {
      return {
        requirement: 'required',
        verdict: review.verdict,
        freshness,
        status: freshness === 'current' ? 'acceptable_current' : 'acceptable_carried_forward',
      };
    }
    if (review.verdict === 'blocker') {
      addObligation(obligations, `${role.toUpperCase()}_BLOCKER_REPAIR_REQUIRED`, { role: 'coordinator', source: role });
      return { requirement: 'required', verdict: review.verdict, freshness, status: 'blocker_current' };
    }
  }

  if (freshness === 'stale' || freshness === 'conflict') {
    addObligation(obligations, `${role.toUpperCase()}_REVIEW_REQUIRED`, { role, source: role });
    return { requirement: 'required', verdict: review.verdict, freshness, status: 'stale' };
  }

  unknowns.add(`${role.toUpperCase()}_FRESHNESS_UNKNOWN`);
  return { requirement: 'required', verdict: review.verdict, freshness, status: 'unknown' };
}

function deriveProofs(facts, contradictions, obligations) {
  const currentByKey = new Map();
  for (const proof of facts.proofs) {
    if (!proof.required) continue;
    if (!facts.candidate.headSha || proof.exactHeadSha !== facts.candidate.headSha) continue;
    if (!currentByKey.has(proof.key)) currentByKey.set(proof.key, new Set());
    currentByKey.get(proof.key).add(proof.status);
  }

  const current = [];
  for (const [key, statuses] of currentByKey.entries()) {
    const ordered = stableList(statuses);
    current.push({ key, statuses: ordered });
    const nonPass = ordered.filter((status) => status !== 'pass');
    if (ordered.includes('pass') && nonPass.length > 0) contradictions.add(`MIXED_CURRENT_PROOF_STATUS:${key}`);
    if (nonPass.length > 0) addObligation(obligations, `CURRENT_PROOF_NOT_PASS:${key}`, { source: 'proof' });
  }
  return current.sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

function derivePostMain(facts, unknowns, obligations) {
  if (facts.candidate.presence !== 'merged') return { applicability: 'not_applicable', status: 'not_applicable' };
  if (!facts.candidate.mergeSha) unknowns.add('MERGE_SHA_UNKNOWN');
  if (facts.postMain.mergeSha && facts.candidate.mergeSha && facts.postMain.mergeSha !== facts.candidate.mergeSha) {
    return { applicability: 'required', status: 'mismatched_merge' };
  }
  if (facts.postMain.status === 'pass') return { applicability: 'required', status: 'pass' };
  if (facts.postMain.status === 'pending') {
    addObligation(obligations, 'POST_MAIN_VERIFICATION_PENDING', { source: 'post_main' });
    return { applicability: 'required', status: 'pending' };
  }
  if (facts.postMain.status === 'fail') {
    addObligation(obligations, 'POST_MAIN_FAILURE_INVESTIGATION_REQUIRED', { source: 'post_main' });
    return { applicability: 'required', status: 'fail' };
  }
  if (facts.postMain.status === 'missing') {
    addObligation(obligations, 'POST_MAIN_VERIFICATION_REQUIRED', { source: 'post_main' });
    return { applicability: 'required', status: 'missing' };
  }
  unknowns.add('POST_MAIN_STATUS_UNKNOWN');
  return { applicability: 'required', status: 'unknown' };
}

export function deriveConditions(inputFacts) {
  const facts = inputFacts?.candidate && inputFacts?.task && inputFacts?.ci
    ? inputFacts
    : normalizeFacts(inputFacts);

  const contradictions = new Set();
  const unknowns = new Set();
  const obligations = [];

  const snapshotFreshness = headFreshness(facts, unknowns);
  const currentMainFreshness = mainFreshness(facts, unknowns);

  if (facts.candidate.presence === 'active' && !facts.candidate.headSha) {
    unknowns.add('ACTIVE_CANDIDATE_HEAD_UNKNOWN');
  }
  if (facts.candidate.presence === 'merged' && !facts.candidate.mergeSha) {
    contradictions.add('MERGED_CANDIDATE_WITHOUT_MERGE_SHA');
  }

  if (snapshotFreshness === 'stale') addObligation(obligations, 'REFRESH_SNAPSHOT', { role: 'coordinator', source: 'observation' });
  if (facts.task.writerStatus === 'conflict') addObligation(obligations, 'RESOLVE_WRITER_CONFLICT', { role: 'coordinator', source: 'task' });
  if (facts.task.writerStatus === 'unknown') unknowns.add('WRITER_STATUS_UNKNOWN');
  if (facts.task.dependencyState === 'blocked') addObligation(obligations, 'DEPENDENCY_BLOCKED', { source: 'task' });
  if (facts.task.dependencyState === 'unknown') unknowns.add('DEPENDENCY_STATE_UNKNOWN');
  if (facts.task.assignmentState === 'unknown') unknowns.add('ASSIGNMENT_STATE_UNKNOWN');

  if (facts.candidate.presence === 'absent'
    && facts.task.dependencyState === 'ready'
    && facts.task.assignmentState === 'assigned'
    && facts.task.writerStatus === 'clear'
    && ['planned', 'active'].includes(facts.task.liveStatus)) {
    addObligation(obligations, 'IMPLEMENTATION_ELIGIBLE', { role: 'implementer', source: 'task', blocking: false });
  }

  const ci = deriveCi(facts, unknowns, obligations);
  const r0 = deriveR0(facts, contradictions, unknowns, obligations);
  const reviews = {
    r1: deriveReview('r1', facts, unknowns, obligations),
    r2: deriveReview('r2', facts, unknowns, obligations),
  };
  const proofs = deriveProofs(facts, contradictions, obligations);
  const postMain = derivePostMain(facts, unknowns, obligations);

  if (postMain.status === 'mismatched_merge') contradictions.add('POST_MAIN_MERGE_SHA_MISMATCH');

  if (facts.r0.change === 'docs_only_descendant'
    && facts.r0.lineage === 'descendant'
    && facts.r0.deltaConfirmation !== 'confirmed') {
    addObligation(obligations, 'DOCS_ONLY_DELTA_CONFIRMATION_REQUIRED', { role: 'coordinator', source: 'r0' });
  }

  return {
    facts,
    state: {
      candidatePresence: facts.candidate.presence,
      snapshotFreshness,
      mainFreshness: currentMainFreshness,
      task: {
        liveStatus: facts.task.liveStatus,
        dependencyState: facts.task.dependencyState,
        assignmentState: facts.task.assignmentState,
      },
      writer: facts.task.writerStatus,
      ci,
      r0,
      reviews,
      proofs,
      postMain,
    },
    contradictions: stableList(contradictions),
    unknowns: stableList(unknowns),
    obligations: stableObjects(obligations),
  };
}

function recommendation(kind, nextActor, suggestedAction, reasonCodes, {
  eligibleRoles = [],
  blockedBy = [],
  rule,
  facts = [],
  conditions = [],
} = {}) {
  return {
    kind,
    nextActor,
    suggestedAction,
    eligibleRoles: stableList(eligibleRoles),
    reasonCodes: stableList(reasonCodes),
    blockedBy: stableList(blockedBy),
    provenance: rule ? [{ rule, facts: stableList(facts), conditions: stableList(conditions) }] : [],
  };
}

function hasObligation(conditions, code) {
  return conditions.obligations.some((item) => item.code === code);
}

function obligationPrefix(conditions, prefix) {
  return conditions.obligations.filter((item) => item.code.startsWith(prefix));
}

export function recommendNextAction(conditions) {
  const { facts, state, contradictions, unknowns } = conditions;

  if (state.snapshotFreshness === 'stale') {
    return recommendation('refuse', 'coordinator', 'refresh_snapshot', ['HEAD_CHANGED_DURING_OBSERVATION'], {
      blockedBy: ['stale_snapshot'],
      rule: 'R1_FRESHNESS_INVALIDATES_HEAD_BOUND_ROUTING',
      facts: ['observation.observedHeadSha', 'observation.liveHeadSha'],
      conditions: ['state.snapshotFreshness'],
    });
  }

  if (contradictions.length > 0) {
    return recommendation('refuse', 'coordinator', 'resolve_contradictory_evidence', ['CONTRADICTORY_EVIDENCE_PRESENT'], {
      blockedBy: contradictions,
      rule: 'R2_CONTRADICTIONS_REFUSE_ROUTING',
      conditions: ['contradictions'],
    });
  }

  if (state.writer === 'conflict') {
    return recommendation('refuse', 'coordinator', 'resolve_writer_scope', ['SHARED_WRITER_CONFLICT'], {
      blockedBy: ['writer_conflict'],
      rule: 'R3_WRITER_CONFLICT_PRECEDES_NORMAL_ROUTING',
      conditions: ['state.writer'],
    });
  }

  if (state.writer === 'unknown') {
    return recommendation('refuse', 'coordinator', 'confirm_writer_state', ['WRITER_STATUS_UNKNOWN'], {
      blockedBy: ['writer_unknown'],
      rule: 'R4_UNKNOWN_WRITER_STATE_REFUSES_WRITE_ROUTING',
      conditions: ['state.writer'],
    });
  }

  if (state.candidatePresence === 'absent') {
    if (state.task.dependencyState === 'blocked') {
      return recommendation('wait', 'coordinator', 'wait_for_dependency', ['DEPENDENCY_BLOCKED'], {
        blockedBy: ['dependency'],
        rule: 'R5_DEPENDENCY_BLOCKS_IMPLEMENTATION',
        conditions: ['state.task.dependencyState'],
      });
    }
    if (hasObligation(conditions, 'IMPLEMENTATION_ELIGIBLE')) {
      return recommendation('unique', 'implementer', 'implementation_eligible', ['IMPLEMENTATION_ELIGIBLE'], {
        rule: 'R6_ASSIGNED_READY_TASK_IS_IMPLEMENTATION_ELIGIBLE',
        facts: ['task.liveStatus', 'task.assignmentState'],
        conditions: ['state.task.dependencyState', 'state.writer'],
      });
    }
    return recommendation('refuse', 'coordinator', 'confirm_task_assignment_and_dependencies', ['IMPLEMENTATION_ELIGIBILITY_UNKNOWN'], {
      blockedBy: unknowns,
      rule: 'R7_UNKNOWN_TASK_FACTS_REFUSE_IMPLEMENTATION_ROUTING',
      conditions: ['unknowns'],
    });
  }

  if (state.candidatePresence === 'merged') {
    if (state.postMain.status === 'pass') {
      return recommendation('unique', 'coordinator', 'assess_closure_candidate', ['POST_MAIN_PASS_PRESENT'], {
        rule: 'R8_POST_MAIN_PASS_ALLOWS_CLOSURE_ASSESSMENT_ONLY',
        conditions: ['state.postMain'],
      });
    }
    if (state.postMain.status === 'pending' || state.postMain.status === 'missing') {
      return recommendation('wait', 'coordinator', 'obtain_post_main_verification', ['POST_MAIN_VERIFICATION_OPEN'], {
        blockedBy: ['post_main'],
        rule: 'R9_POST_MAIN_EVIDENCE_PRECEDES_CLOSURE',
        conditions: ['state.postMain'],
      });
    }
    if (state.postMain.status === 'fail') {
      return recommendation('unique', 'coordinator', 'investigate_post_main_failure', ['POST_MAIN_FAILURE_PRESENT'], {
        rule: 'R10_POST_MAIN_FAILURE_IS_NOT_AUTOMATIC_CODE_REPAIR',
        conditions: ['state.postMain'],
      });
    }
    return recommendation('refuse', 'coordinator', 'confirm_post_main_evidence', ['POST_MAIN_STATUS_UNKNOWN'], {
      blockedBy: ['post_main_unknown'],
      rule: 'R11_UNKNOWN_POST_MAIN_EVIDENCE_REFUSES_CLOSURE_ROUTING',
      conditions: ['state.postMain'],
    });
  }

  if (state.candidatePresence !== 'active') {
    return recommendation('refuse', 'coordinator', 'confirm_candidate_identity', ['CANDIDATE_IDENTITY_UNKNOWN'], {
      blockedBy: ['candidate_unknown'],
      rule: 'R12_UNKNOWN_CANDIDATE_IDENTITY_REFUSES_ROUTING',
      conditions: ['state.candidatePresence'],
    });
  }

  if (state.ci.headApplicability !== 'current'
    || state.ci.baseApplicability !== 'current'
    || state.ci.checkoutBinding === 'unbound'
    || state.ci.checkoutBinding === 'unknown') {
    return recommendation('refuse', 'coordinator', 'refresh_candidate_bound_ci_evidence', ['CI_PROVENANCE_INCOMPLETE'], {
      blockedBy: [
        `ci_head:${state.ci.headApplicability}`,
        `ci_base:${state.ci.baseApplicability}`,
        `ci_checkout:${state.ci.checkoutBinding}`,
      ],
      rule: 'R13_CI_PROVENANCE_PRECEDES_CI_RESULT_ROUTING',
      conditions: ['state.ci'],
    });
  }

  if (state.ci.result === 'pending') {
    return recommendation('wait', 'none', 'wait_for_ci', ['CI_PENDING'], {
      blockedBy: ['ci_pending'],
      rule: 'R14_CURRENT_PENDING_CI_BLOCKS_DOWNSTREAM_REVIEW',
      conditions: ['state.ci.result'],
    });
  }

  if (state.ci.result === 'fail') {
    return recommendation('unique', 'coordinator', 'investigate_current_ci_failure', ['CURRENT_CI_FAILURE_PRESENT'], {
      rule: 'R15_CI_FAILURE_DOES_NOT_IMPLY_CANDIDATE_CAUSALITY',
      conditions: ['state.ci.result'],
    });
  }

  if (['missing', 'unknown', 'cancelled', 'skipped'].includes(state.ci.result)) {
    return recommendation('refuse', 'coordinator', 'obtain_current_ci_evidence', ['CURRENT_CI_EVIDENCE_INCOMPLETE'], {
      blockedBy: [`ci_result:${state.ci.result}`],
      rule: 'R16_INCOMPLETE_CI_REFUSES_DOWNSTREAM_ROUTING',
      conditions: ['state.ci.result'],
    });
  }

  const proofGaps = obligationPrefix(conditions, 'CURRENT_PROOF_NOT_PASS:');
  if (proofGaps.length > 0) {
    return recommendation('refuse', 'coordinator', 'investigate_current_proof_gap', ['CURRENT_PROOF_NOT_PASS'], {
      blockedBy: proofGaps.map((item) => item.code),
      rule: 'R17_CURRENT_NON_PASS_PROOF_CANNOT_BE_MASKED',
      conditions: ['state.proofs'],
    });
  }

  if (state.r0.mode === 'conflict' || state.r0.mode === 'unknown') {
    return recommendation('refuse', 'coordinator', 'resolve_r0_provenance', ['R0_PROVENANCE_INCOMPLETE'], {
      blockedBy: unknowns.filter((item) => item.startsWith('R0_')),
      rule: 'R18_R0_PROVENANCE_PRECEDES_REVIEW_ROUTING',
      conditions: ['state.r0'],
    });
  }
  if (state.r0.mode === 'discovery_needed') {
    return recommendation('unique', 'r0', 'run_r0_discovery', ['R0_DISCOVERY_REQUIRED'], {
      rule: 'R19_R0_DISCOVERY_PRECEDES_INDEPENDENT_REVIEW',
      conditions: ['state.r0.mode'],
    });
  }
  if (state.r0.mode === 'verification_needed') {
    return recommendation('unique', 'r0', 'run_r0_verification', ['R0_VERIFICATION_REQUIRED'], {
      rule: 'R20_DESCENDANT_REPAIR_USES_BOUNDED_R0_VERIFICATION',
      conditions: ['state.r0.mode'],
    });
  }
  if (state.r0.mode === 'blocked') {
    if (facts.task.assignmentState === 'assigned') {
      return recommendation('unique', 'implementer', 'repair_frozen_r0_blockers', ['R0_FROZEN_BLOCKERS_OPEN'], {
        rule: 'R21_DURABLE_OPEN_FROZEN_BLOCKERS_ALLOW_BOUNDED_REPAIR',
        conditions: ['state.r0.openBlockers'],
      });
    }
    return recommendation('refuse', 'coordinator', 'assign_r0_blocker_repair', ['R0_FROZEN_BLOCKERS_OPEN', 'ASSIGNMENT_REQUIRED'], {
      rule: 'R22_REPAIR_REQUIRES_EXPLICIT_ASSIGNMENT',
      conditions: ['state.r0.openBlockers', 'state.task.assignmentState'],
    });
  }

  if (hasObligation(conditions, 'DOCS_ONLY_DELTA_CONFIRMATION_REQUIRED')) {
    return recommendation('refuse', 'coordinator', 'confirm_docs_only_delta', ['DOCS_ONLY_DELTA_UNCONFIRMED'], {
      rule: 'R23_DOCS_ONLY_DESCENDANT_DOES_NOT_SILENTLY_CARRY_REVIEW',
      facts: ['r0.change', 'r0.deltaConfirmation'],
      conditions: ['obligations'],
    });
  }

  const currentReviewBlockers = ['r1', 'r2'].filter((role) => state.reviews[role].status === 'blocker_current');
  if (currentReviewBlockers.length > 0) {
    return recommendation('unique', 'coordinator', 'coordinate_review_blocker_repair', ['CURRENT_REVIEW_BLOCKER_PRESENT'], {
      eligibleRoles: currentReviewBlockers,
      rule: 'R24_CURRENT_INDEPENDENT_REVIEW_BLOCKER_PRECEDES_FURTHER_REVIEW',
      conditions: currentReviewBlockers.map((role) => `state.reviews.${role}`),
    });
  }

  const pendingReviews = ['r1', 'r2'].filter((role) => {
    const status = state.reviews[role].status;
    return state.reviews[role].requirement === 'required'
      && !['acceptable_current', 'acceptable_carried_forward'].includes(status);
  });
  if (pendingReviews.length > 0) {
    const unknownReview = pendingReviews.some((role) => state.reviews[role].status === 'unknown');
    if (unknownReview) {
      return recommendation('refuse', 'coordinator', 'resolve_review_provenance', ['REQUIRED_REVIEW_PROVENANCE_UNKNOWN'], {
        eligibleRoles: pendingReviews,
        blockedBy: unknowns.filter((item) => item.startsWith('R1_') || item.startsWith('R2_')),
        rule: 'R25_UNKNOWN_REVIEW_PROVENANCE_REFUSES_DISPATCH',
        conditions: pendingReviews.map((role) => `state.reviews.${role}`),
      });
    }
    return recommendation('unique', 'coordinator', 'request_required_reviews', ['REQUIRED_REVIEWS_OPEN'], {
      eligibleRoles: pendingReviews,
      rule: 'R26_REVIEW_OBLIGATIONS_REMAIN_INDEPENDENT',
      conditions: pendingReviews.map((role) => `state.reviews.${role}`),
    });
  }

  return recommendation('unique', 'coordinator', 'assess_current_evidence', ['COORDINATOR_ASSESSMENT_REQUIRED'], {
    rule: 'R27_REDUCER_NEVER_COMPUTES_MERGE_READY',
    conditions: ['state', 'obligations'],
  });
}

export function deriveDispatcherResult(input = {}) {
  const facts = normalizeFacts(input);
  const conditions = deriveConditions(facts);
  return {
    facts,
    state: conditions.state,
    contradictions: conditions.contradictions,
    unknowns: conditions.unknowns,
    obligations: conditions.obligations,
    recommendation: recommendNextAction(conditions),
    sourceRefs: facts.sourceRefs,
  };
}

// Compatibility facade for the v0 experiment. The architecture center is the
// three explicit pure layers above, not this wrapper.
export const deriveEffectiveState = deriveDispatcherResult;
