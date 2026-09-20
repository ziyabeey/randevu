import { createHash } from 'node:crypto';

const DISPOSITIONS = new Set([
  'NO_ACTION',
  'DETERMINISTIC_ACTION',
  'HUMAN_REQUIRED',
  'REASONING_REQUIRED',
]);

const NO_ACTIONS = new Set([
  'wait_for_dependency',
  'wait_for_ci',
  'obtain_post_main_verification',
]);

const DETERMINISTIC_ACTIONS = new Set([
  'refresh_snapshot',
  'confirm_writer_state',
  'refresh_integration_base',
  'establish_main_freshness',
  'confirm_dependency_state',
  'refresh_candidate_bound_ci_evidence',
  'obtain_current_ci_evidence',
  'resolve_proof_provenance',
  'resolve_r0_provenance',
  'run_r0_discovery',
  'run_r0_verification',
  'request_required_reviews',
  'resolve_review_provenance',
  'confirm_post_main_evidence',
]);

const REASONING_ACTIONS = new Set([
  'resolve_contradictory_evidence',
  'investigate_current_ci_failure',
  'investigate_current_proof_gap',
  'confirm_docs_only_delta',
  'investigate_post_main_failure',
]);

const HUMAN_ACTIONS = new Set([
  'resolve_writer_scope',
  'implementation_eligible',
  'confirm_task_assignment_and_dependencies',
  'assess_closure_candidate',
  'confirm_candidate_identity',
  'repair_frozen_r0_blockers',
  'assign_r0_blocker_repair',
  'coordinate_review_blocker_repair',
  'assess_current_evidence',
]);

function sortStrings(values) {
  return [...new Set(Array.from(values ?? [])
    .filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeMaterialEvidence(evidence = {}) {
  return {
    observedAt: typeof evidence.observedAt === 'string' ? evidence.observedAt : null,
    question: typeof evidence.question === 'string' && evidence.question.trim()
      ? evidence.question.trim()
      : null,
    escalationType: typeof evidence.escalationType === 'string' && evidence.escalationType.trim()
      ? evidence.escalationType.trim()
      : null,
    actionsAlreadyTaken: sortStrings(evidence.actionsAlreadyTaken),
    forbiddenScope: sortStrings(evidence.forbiddenScope),
    sourceRefs: sortStrings(evidence.sourceRefs),
    materialFacts: stableValue(evidence.materialFacts ?? {}),
  };
}

function mergedSourceRefs(dispatcherResult, evidence) {
  return sortStrings([...(dispatcherResult?.sourceRefs ?? []), ...evidence.sourceRefs]);
}

export function classifyEscalationDisposition(dispatcherResult = {}) {
  const recommendation = dispatcherResult?.recommendation ?? {};
  const action = recommendation.suggestedAction ?? null;

  if (!action) {
    return {
      disposition: 'HUMAN_REQUIRED',
      reason: 'DISPATCHER_RECOMMENDATION_MISSING',
    };
  }

  if (NO_ACTIONS.has(action)) return { disposition: 'NO_ACTION', reason: action };
  if (DETERMINISTIC_ACTIONS.has(action)) {
    return { disposition: 'DETERMINISTIC_ACTION', reason: action };
  }
  if (REASONING_ACTIONS.has(action)) {
    return { disposition: 'REASONING_REQUIRED', reason: action };
  }
  if (HUMAN_ACTIONS.has(action)) return { disposition: 'HUMAN_REQUIRED', reason: action };

  return {
    disposition: 'HUMAN_REQUIRED',
    reason: `UNCLASSIFIED_DISPATCHER_ACTION:${action}`,
  };
}

function materialFingerprintInput(dispatcherResult, evidence, classification) {
  const facts = dispatcherResult?.facts ?? {};
  const recommendation = dispatcherResult?.recommendation ?? {};
  return {
    schema: 'development-escalation-fingerprint.v0',
    task: facts.task?.id ?? facts.candidate?.taskId ?? null,
    pr: facts.candidate?.prNumber ?? null,
    head: facts.candidate?.headSha ?? null,
    main: facts.observation?.liveMainSha ?? facts.observation?.observedMainSha ?? null,
    disposition: classification.disposition,
    action: recommendation.suggestedAction ?? null,
    recommendationKind: recommendation.kind ?? null,
    nextActor: recommendation.nextActor ?? null,
    reasonCodes: sortStrings(recommendation.reasonCodes),
    blockedBy: sortStrings(recommendation.blockedBy),
    contradictions: sortStrings(dispatcherResult?.contradictions),
    unknowns: sortStrings(dispatcherResult?.unknowns),
    obligations: Array.from(dispatcherResult?.obligations ?? [])
      .map((item) => ({
        code: item?.code ?? null,
        role: item?.role ?? null,
        source: item?.source ?? null,
        blocking: item?.blocking !== false,
      }))
      .filter((item) => item.code)
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b), 'en')),
    escalationType: evidence.escalationType,
    question: evidence.question,
    actionsAlreadyTaken: evidence.actionsAlreadyTaken,
    forbiddenScope: evidence.forbiddenScope,
    materialFacts: evidence.materialFacts,
    sourceRefs: mergedSourceRefs(dispatcherResult, evidence),
  };
}

export function buildCaseFingerprint(dispatcherResult = {}, rawEvidence = {}) {
  const classification = classifyEscalationDisposition(dispatcherResult);
  const evidence = normalizeMaterialEvidence(rawEvidence);
  const material = materialFingerprintInput(dispatcherResult, evidence, classification);
  return createHash('sha256').update(stableJson(material)).digest('hex');
}

function sourceEnvelopePayload(envelope = {}) {
  const { sourceEnvelopeBytes: _bytes, trust: _trust, ...payload } = envelope;
  return payload;
}

export function canonicalSourceEnvelopeJson(envelope = {}) {
  return stableJson(sourceEnvelopePayload(envelope));
}

export function buildEscalationEnvelope(dispatcherResult = {}, rawEvidence = {}) {
  const classification = classifyEscalationDisposition(dispatcherResult);
  if (!DISPOSITIONS.has(classification.disposition)) {
    throw new Error('Invalid escalation disposition.');
  }
  const evidence = normalizeMaterialEvidence(rawEvidence);
  const facts = dispatcherResult?.facts ?? {};
  const candidate = facts.candidate ?? {};
  const observation = facts.observation ?? {};

  const baseEnvelope = {
    schemaVersion: 'development-escalation-envelope.v0',
    disposition: classification.disposition,
    dispositionReason: classification.reason,
    case: {
      task: facts.task?.id ?? candidate.taskId ?? null,
      pr: candidate.prNumber ?? null,
      branch: candidate.branch ?? null,
      currentHead: candidate.headSha ?? null,
      currentMain: observation.liveMainSha ?? observation.observedMainSha ?? null,
      observedAt: evidence.observedAt,
    },
    dispatcher: {
      facts: stableValue(facts),
      recommendation: stableValue(dispatcherResult?.recommendation ?? null),
      contradictions: sortStrings(dispatcherResult?.contradictions),
      unknowns: sortStrings(dispatcherResult?.unknowns),
      obligations: stableValue(dispatcherResult?.obligations ?? []),
      state: stableValue(dispatcherResult?.state ?? {}),
    },
    evidence: {
      escalationType: evidence.escalationType,
      question: evidence.question,
      actionsAlreadyTaken: evidence.actionsAlreadyTaken,
      forbiddenScope: evidence.forbiddenScope,
      sourceRefs: mergedSourceRefs(dispatcherResult, evidence),
      materialFacts: evidence.materialFacts,
    },
    caseFingerprint: buildCaseFingerprint(dispatcherResult, rawEvidence),
  };

  return {
    ...baseEnvelope,
    sourceEnvelopeBytes: Buffer.byteLength(stableJson(baseEnvelope), 'utf8'),
  };
}

export function renderHaikuCompressionRequest(envelope = {}) {
  if (envelope.disposition !== 'REASONING_REQUIRED') {
    throw new Error(`Haiku compression is only valid for REASONING_REQUIRED; received ${envelope.disposition ?? 'unknown'}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(envelope.caseFingerprint ?? '')) {
    throw new Error('Haiku compression requires a valid case fingerprint.');
  }
  if (!Number.isInteger(envelope.sourceEnvelopeBytes) || envelope.sourceEnvelopeBytes <= 0) {
    throw new Error('Haiku compression requires a valid source envelope byte count.');
  }

  const sourceEnvelopeJson = canonicalSourceEnvelopeJson(envelope);
  const actualSourceBytes = Buffer.byteLength(sourceEnvelopeJson, 'utf8');
  if (actualSourceBytes !== envelope.sourceEnvelopeBytes) {
    throw new Error('Haiku compression source envelope byte count changed.');
  }

  const attestation = envelope.trust?.githubOidcAttestation;
  if (typeof attestation !== 'string' || !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(attestation)) {
    throw new Error('Haiku compression requires a GitHub OIDC attestation.');
  }

  return [
    'EVIDENCE_COMPRESSION_REQUEST',
    '',
    'You are the Haiku Evidence Context Compressor and the sole model layer authorized to trigger the Opus Escalation Governor for this case.',
    'Compress the freshness-fenced source envelope below. Do not answer the technical question yourself.',
    'Preserve exact SHA/PR/CI/review/proof provenance, contradictions, unknowns, forbidden scope and source references.',
    'Remove duplicate or historical material that does not affect the current candidate.',
    '',
    'Write exactly one JSON object to /tmp/kepenk-opus-handoff.json with these top-level fields:',
    'DISPOSITION = "REASONING_REQUIRED"',
    'CASE_FINGERPRINT = the unchanged dispatcher case fingerprint',
    `SOURCE_ENVELOPE_BYTES = ${envelope.sourceEnvelopeBytes}`,
    `TRUSTED_ATTESTATION = ${attestation}`,
    'OPUS_ESCALATION_PACKAGE = the compact package defined by your routine instructions',
    '',
    'Do not interpolate evidence values into shell syntax.',
    'After writing the JSON file, run this fixed command exactly once:',
    'node scripts/fire-opus-escalation.mjs --package /tmp/kepenk-opus-handoff.json',
    '',
    'The adapter cryptographically verifies the GitHub-issued attestation and binds it to the original case fingerprint, source byte count, workflow and repository.',
    'Do not ask GitHub Actions, the Dispatcher, or the caller to trigger Opus for you.',
    'Do not expose CLAUDE_OPUS_ROUTINE_URL or CLAUDE_OPUS_ROUTINE_TOKEN.',
    'If the handoff command cannot run or does not return OPUS_TRIGGERED, stop with OPUS_HANDOFF_BLOCKED and the exact non-secret reason.',
    'After a successful handoff, report only OPUS_TRIGGERED, CASE_FINGERPRINT, SOURCE_ENVELOPE_BYTES, COMPRESSED_PACKAGE_BYTES, COMPRESSION_RATIO and the returned Claude session URL.',
    'Do not perform Opus-level reasoning yourself.',
    '',
    'SOURCE_ENVELOPE_JSON',
    sourceEnvelopeJson,
  ].join('\n');
}

export function buildRoutineFireBody(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Routine fire text must be a non-empty string.');
  }
  return { text };
}
