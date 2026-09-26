import { createHash } from 'node:crypto';

import { stableJson } from '../core/cache.mjs';
import { verifyCoveragePacket } from '../specification/test-spec.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const hashBody = (value) => sha256(`${stableJson(value)}\n`);

const FAMILIES = new Set([
  'mutation',
  'coverage',
  'history',
  'dependency',
  'test',
  'test-candidate',
  'validation',
  'performance',
  'repository',
]);

const FEATURE_KINDS = new Set([
  'rate',
  'ratio',
  'lift',
  'baseline-delta',
  'agreement-count',
  'contradiction-count',
  'independent-family-count',
  'lineage-overlap',
]);

const RELATION_CHOICES = new Set([
  'strengthens',
  'weakens',
  'unrelated',
  'insufficient',
]);

const OUTCOME_VALUES = Object.freeze({
  'm5-validation': new Set(['confirmed', 'rejected', 'inconclusive']),
  'mutation-run': new Set(['mutant-killed', 'mutant-survived']),
  'test-run': new Set(['test-pass', 'test-fail', 'regression-found', 'no-regression']),
  'manual-review': new Set(['confirmed', 'rejected', 'inconclusive', 'regression-found', 'no-regression']),
});

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function shaLike(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function nullableString(value, name) {
  if (value == null) return null;
  if (!nonEmpty(value)) throw new TypeError(`${name} must be a non-empty string or null`);
  return String(value);
}

function uniqueSorted(values = []) {
  return [...new Set(values.map(String).filter((value) => value.trim().length > 0))].sort();
}

function uniquePreserve(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.map(String)) {
    if (!value.trim() || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function normalizeSampleSize(value, name = 'sampleSize') {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer or null`);
  return value;
}

function normalizeBaseline(baseline, factValue) {
  if (baseline == null) return null;
  if (!finiteNumber(factValue)) {
    throw new TypeError('numeric baseline requires a numeric fact value');
  }
  if (!finiteNumber(baseline.value)) throw new TypeError('baseline value must be finite');
  if (!nonEmpty(baseline.sourceId)) throw new TypeError('baseline sourceId required');
  return deepFreeze({
    value: baseline.value,
    sampleSize: normalizeSampleSize(baseline.sampleSize, 'baseline.sampleSize'),
    sourceId: String(baseline.sourceId),
  });
}

function normalizeProvenance(provenance = {}) {
  if (!nonEmpty(provenance.producer) || !nonEmpty(provenance.producerVersion)) {
    throw new TypeError('provenance requires producer and producerVersion');
  }
  const body = {
    producer: String(provenance.producer),
    producerVersion: String(provenance.producerVersion),
    inputDigest: nullableString(provenance.inputDigest, 'provenance.inputDigest'),
    sourceRevision: nullableString(provenance.sourceRevision, 'provenance.sourceRevision'),
    evidenceIds: uniqueSorted(provenance.evidenceIds ?? []),
  };
  const provenanceDigest = hashBody(body);
  if (provenance.provenanceDigest != null && provenance.provenanceDigest !== provenanceDigest) {
    throw new Error('provenance digest mismatch');
  }
  return deepFreeze({ ...body, provenanceDigest });
}

export function normalizeRelationalFact(fact = {}) {
  if (!nonEmpty(fact.factId)) throw new TypeError('factId required');
  if (!FAMILIES.has(fact.family)) throw new TypeError(`invalid evidence family: ${fact.family}`);
  if (!['present', 'absent', 'unknown'].includes(fact.state)) {
    throw new TypeError(`invalid fact state: ${fact.state}`);
  }
  if (!nonEmpty(fact.metricId)) throw new TypeError('metricId required');

  const value = fact.value ?? null;
  const validScalar = value == null
    || typeof value === 'boolean'
    || finiteNumber(value)
    || nonEmpty(value);
  if (!validScalar) throw new TypeError('fact value must be a finite scalar or null');
  if (fact.state === 'unknown' && value !== null) {
    throw new Error('unknown fact must carry null value');
  }

  const unit = nullableString(fact.unit, 'unit');
  let denominator = null;
  if (fact.denominator != null) {
    if (!finiteNumber(fact.denominator) || fact.denominator < 0) {
      throw new TypeError('denominator must be a non-negative finite number or null');
    }
    denominator = fact.denominator;
  }

  const lineageIds = uniqueSorted(fact.lineageIds ?? []);
  if (!lineageIds.length) throw new TypeError('fact requires at least one lineageId');

  return deepFreeze({
    factId: String(fact.factId),
    family: fact.family,
    state: fact.state,
    metricId: String(fact.metricId),
    value,
    unit,
    denominator,
    sampleSize: normalizeSampleSize(fact.sampleSize),
    baseline: normalizeBaseline(fact.baseline, value),
    lineageIds,
    provenance: normalizeProvenance(fact.provenance),
  });
}

export function freezeDeterministicFeature(feature = {}) {
  if (!nonEmpty(feature.featureId)) throw new TypeError('featureId required');
  if (!FEATURE_KINDS.has(feature.kind)) throw new TypeError(`invalid feature kind: ${feature.kind}`);
  if (!['known', 'unknown'].includes(feature.state)) throw new TypeError('feature state must be known or unknown');

  const value = feature.value ?? null;
  if (feature.state === 'unknown' && value !== null) {
    throw new Error('unknown feature must carry null value');
  }
  if (feature.state === 'known' && !(finiteNumber(value) || typeof value === 'boolean')) {
    throw new Error('known feature requires a finite numeric or boolean value');
  }

  const factIds = uniquePreserve(feature.factIds ?? []);
  if (!factIds.length) throw new TypeError('feature requires factIds');

  return deepFreeze({
    featureId: String(feature.featureId),
    kind: feature.kind,
    state: feature.state,
    value,
    sampleSize: normalizeSampleSize(feature.sampleSize),
    factIds,
  });
}

function pairedSampleSize(fact) {
  if (fact.sampleSize == null || fact.baseline?.sampleSize == null) return null;
  return Math.min(fact.sampleSize, fact.baseline.sampleSize);
}

export function baselineFeaturesForFact(input) {
  const fact = normalizeRelationalFact(input);
  const canCompare = finiteNumber(fact.value) && fact.baseline != null;
  const sampleSize = canCompare ? pairedSampleSize(fact) : null;

  const delta = freezeDeterministicFeature({
    featureId: `baseline-delta:${fact.factId}`,
    kind: 'baseline-delta',
    state: canCompare ? 'known' : 'unknown',
    value: canCompare ? fact.value - fact.baseline.value : null,
    sampleSize,
    factIds: [fact.factId],
  });

  const canLift = canCompare && fact.baseline.value !== 0;
  const lift = freezeDeterministicFeature({
    featureId: `lift:${fact.factId}`,
    kind: 'lift',
    state: canLift ? 'known' : 'unknown',
    value: canLift ? fact.value / fact.baseline.value : null,
    sampleSize,
    factIds: [fact.factId],
  });

  return deepFreeze([delta, lift]);
}

function sharesLineage(a, b) {
  const right = new Set(b.lineageIds);
  return a.lineageIds.some((id) => right.has(id));
}

function hasLineageOverlap(facts) {
  for (let i = 0; i < facts.length; i += 1) {
    for (let j = i + 1; j < facts.length; j += 1) {
      if (sharesLineage(facts[i], facts[j])) return true;
    }
  }
  return false;
}

function subsetIsIndependent(subset) {
  const families = new Set();
  for (let i = 0; i < subset.length; i += 1) {
    if (families.has(subset[i].family)) return false;
    families.add(subset[i].family);
    for (let j = i + 1; j < subset.length; j += 1) {
      if (sharesLineage(subset[i], subset[j])) return false;
    }
  }
  return true;
}

function maximumIndependentFamilyCount(facts) {
  let max = 0;
  const total = 1 << facts.length;
  for (let mask = 1; mask < total; mask += 1) {
    const subset = [];
    for (let index = 0; index < facts.length; index += 1) {
      if (mask & (1 << index)) subset.push(facts[index]);
    }
    if (subset.length > max && subsetIsIndependent(subset)) max = subset.length;
  }
  return max;
}

export function lineageFeatures(inputs = []) {
  const facts = inputs.map(normalizeRelationalFact);
  if (facts.length < 2) throw new TypeError('lineage features require at least two facts');
  const ids = facts.map((fact) => fact.factId).sort();

  return deepFreeze([
    freezeDeterministicFeature({
      featureId: `lineage-overlap:${ids.join('+')}`,
      kind: 'lineage-overlap',
      state: 'known',
      value: hasLineageOverlap(facts),
      sampleSize: null,
      factIds: ids,
    }),
    freezeDeterministicFeature({
      featureId: `independent-family-count:${ids.join('+')}`,
      kind: 'independent-family-count',
      state: 'known',
      value: maximumIndependentFamilyCount(facts),
      sampleSize: null,
      factIds: ids,
    }),
  ]);
}

export function sameMetricRatioFeature(numeratorInput, denominatorInput) {
  const numerator = normalizeRelationalFact(numeratorInput);
  const denominator = normalizeRelationalFact(denominatorInput);
  if (numerator.metricId !== denominator.metricId) {
    throw new Error('ratio requires identical metricId values in v0.1');
  }

  const canCompute = finiteNumber(numerator.value)
    && finiteNumber(denominator.value)
    && denominator.value !== 0;

  let sampleSize = null;
  if (numerator.sampleSize != null && denominator.sampleSize != null) {
    sampleSize = Math.min(numerator.sampleSize, denominator.sampleSize);
  }

  return freezeDeterministicFeature({
    featureId: `ratio:${numerator.factId}:${denominator.factId}`,
    kind: 'ratio',
    state: canCompute ? 'known' : 'unknown',
    value: canCompute ? numerator.value / denominator.value : null,
    sampleSize,
    factIds: [numerator.factId, denominator.factId],
  });
}

export function deriveRelationalFeatures(inputs = []) {
  const facts = inputs.map(normalizeRelationalFact);
  const features = [
    ...facts.flatMap((fact) => baselineFeaturesForFact(fact)),
    ...lineageFeatures(facts),
  ];
  return deepFreeze(features.sort((a, b) => a.featureId.localeCompare(b.featureId)));
}

function verifyFeatureBindings(features, factIds) {
  const seen = new Set();
  for (const feature of features) {
    if (seen.has(feature.featureId)) throw new Error(`duplicate featureId: ${feature.featureId}`);
    seen.add(feature.featureId);
    for (const factId of feature.factIds) {
      if (!factIds.has(factId)) throw new Error(`feature references unknown fact: ${factId}`);
    }
  }
}

export function buildRelationalEvidenceCase({
  packet,
  hypothesisId,
  facts = [],
  extraFeatures = [],
} = {}) {
  verifyCoveragePacket(packet);
  if (!nonEmpty(hypothesisId)) throw new TypeError('hypothesisId required');

  const hypothesis = packet.hypotheses?.find((item) => item.id === hypothesisId);
  if (!hypothesis) throw new Error(`unknown hypothesis: ${hypothesisId}`);
  if (facts.length < 2 || facts.length > 4) throw new Error('relational case requires 2 to 4 facts');

  const normalizedFacts = facts.map(normalizeRelationalFact).sort((a, b) => a.factId.localeCompare(b.factId));
  const factIds = new Set(normalizedFacts.map((fact) => fact.factId));
  if (factIds.size !== normalizedFacts.length) throw new Error('duplicate factId');

  const features = [
    ...deriveRelationalFeatures(normalizedFacts),
    ...(extraFeatures ?? []).map(freezeDeterministicFeature),
  ].sort((a, b) => a.featureId.localeCompare(b.featureId));

  verifyFeatureBindings(features, factIds);

  const body = {
    schemaVersion: 1,
    sourceRevision: packet.sourceRevision ?? null,
    hypothesis: {
      packetSha256: packet.packetSha256,
      hypothesisId: hypothesis.id,
      reason: hypothesis.reason,
      priority: hypothesis.priority,
    },
    facts: normalizedFacts,
    deterministicFeatures: features,
    authority: 'advisory',
  };

  return deepFreeze({
    ...body,
    caseSha256: hashBody(body),
  });
}

export function validateRelationalEvidenceCase(relationalCase, { packet = null } = {}) {
  if (!relationalCase?.caseSha256) throw new TypeError('relational evidence case required');
  const { caseSha256, ...body } = structuredClone(relationalCase);
  if (hashBody(body) !== caseSha256) throw new Error('relational case hash mismatch');
  if (relationalCase.authority !== 'advisory') throw new Error('relational case authority must remain advisory');
  if (!Array.isArray(relationalCase.facts) || relationalCase.facts.length < 2 || relationalCase.facts.length > 4) {
    throw new Error('relational case requires 2 to 4 facts');
  }

  const facts = relationalCase.facts.map(normalizeRelationalFact);
  const ids = facts.map((fact) => fact.factId);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate factId');
  if (stableJson(ids) !== stableJson([...ids].sort())) throw new Error('facts are not canonically ordered');

  const features = (relationalCase.deterministicFeatures ?? []).map(freezeDeterministicFeature);
  const featureIds = features.map((feature) => feature.featureId);
  if (stableJson(featureIds) !== stableJson([...featureIds].sort())) throw new Error('features are not canonically ordered');
  verifyFeatureBindings(features, new Set(ids));

  if (packet) {
    verifyCoveragePacket(packet);
    if (packet.packetSha256 !== relationalCase.hypothesis?.packetSha256) {
      throw new Error('relational case packet mismatch');
    }
    if ((packet.sourceRevision ?? null) !== relationalCase.sourceRevision) {
      throw new Error('relational case source revision mismatch');
    }
    const hypothesis = packet.hypotheses?.find((item) => item.id === relationalCase.hypothesis?.hypothesisId);
    if (!hypothesis
      || hypothesis.reason !== relationalCase.hypothesis.reason
      || hypothesis.priority !== relationalCase.hypothesis.priority) {
      throw new Error('relational case hypothesis mismatch');
    }
  }

  return relationalCase;
}

export const RELATION_DIRECTION_QUESTION = deepFreeze({
  id: 'RELATION_DIRECTION',
  version: '0.1',
  type: 'choice',
  instructions: 'Given one frozen hypothesis, 2–4 normalized facts and deterministic features, decide how considering the facts together changes support for the frozen hypothesis compared with considering the supplied facts independently. Do not infer missing facts. Do not calculate new metrics. Do not treat shared-lineage facts as independent confirmation.',
  criteria: {
    strengthens: 'The supplied combination adds mutually reinforcing support beyond the facts considered independently.',
    weakens: 'The combination introduces a contradiction or materially undercuts support.',
    unrelated: 'The relationship does not materially change support for the hypothesis.',
    insufficient: 'Unknowns, incompatible metrics, lineage ambiguity or missing evidence prevent a justified relation judgment.',
  },
});

export function relationalJevState(relationalCase) {
  validateRelationalEvidenceCase(relationalCase);
  return deepFreeze({
    sourceRevision: relationalCase.sourceRevision,
    hypothesis: structuredClone(relationalCase.hypothesis),
    facts: structuredClone(relationalCase.facts),
    deterministicFeatures: structuredClone(relationalCase.deterministicFeatures),
  });
}

export function relationalInputDigest(relationalCase) {
  return hashBody({
    question: RELATION_DIRECTION_QUESTION,
    state: relationalJevState(relationalCase),
  });
}

export function freezeJevRelationalJudgment({
  relationalCase,
  provider,
  model,
  answer = null,
  errorCode = null,
  inputSha256 = null,
} = {}) {
  validateRelationalEvidenceCase(relationalCase);
  if (!nonEmpty(provider) || !nonEmpty(model)) throw new TypeError('provider and model required');

  const expectedInput = relationalInputDigest(relationalCase);
  if (inputSha256 != null && inputSha256 !== expectedInput) {
    throw new Error('Jev input digest mismatch');
  }

  const hasError = errorCode != null;
  if (hasError && !nonEmpty(errorCode)) throw new TypeError('errorCode must be non-empty');
  if (hasError && answer != null) throw new Error('error judgment cannot carry an answer');
  if (!hasError && !answer) throw new TypeError('answered judgment requires answer');

  let choice = null;
  let providerConfidence = null;
  if (!hasError) {
    if (!RELATION_CHOICES.has(answer.choice)) throw new Error(`invalid relation choice: ${answer.choice}`);
    if (!finiteNumber(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
      throw new Error('provider confidence must be between 0 and 1');
    }
    choice = answer.choice;
    providerConfidence = answer.confidence;
  }

  const body = {
    schemaVersion: 1,
    caseSha256: relationalCase.caseSha256,
    provider: String(provider),
    model: String(model),
    questionId: RELATION_DIRECTION_QUESTION.id,
    questionVersion: RELATION_DIRECTION_QUESTION.version,
    inputSha256: expectedInput,
    status: hasError ? 'error' : 'answered',
    choice,
    providerConfidence,
    errorCode: hasError ? String(errorCode) : null,
  };

  return deepFreeze({
    ...body,
    judgmentSha256: hashBody(body),
  });
}

export function validateJevRelationalJudgment(judgment, { relationalCase = null } = {}) {
  if (!judgment?.judgmentSha256) throw new TypeError('Jev relational judgment required');
  const { judgmentSha256, ...body } = structuredClone(judgment);
  if (hashBody(body) !== judgmentSha256) throw new Error('Jev judgment hash mismatch');
  if (judgment.questionId !== RELATION_DIRECTION_QUESTION.id
    || judgment.questionVersion !== RELATION_DIRECTION_QUESTION.version) {
    throw new Error('unsupported Jev relation question');
  }
  if (!nonEmpty(judgment.provider) || !nonEmpty(judgment.model)) throw new Error('judgment provider/model required');
  if (!shaLike(judgment.caseSha256) || !shaLike(judgment.inputSha256)) throw new Error('invalid judgment digest binding');

  if (judgment.status === 'answered') {
    if (!RELATION_CHOICES.has(judgment.choice)) throw new Error('invalid answered judgment choice');
    if (!finiteNumber(judgment.providerConfidence)
      || judgment.providerConfidence < 0
      || judgment.providerConfidence > 1
      || judgment.errorCode !== null) {
      throw new Error('invalid answered judgment payload');
    }
  } else if (judgment.status === 'error') {
    if (judgment.choice !== null || judgment.providerConfidence !== null || !nonEmpty(judgment.errorCode)) {
      throw new Error('invalid error judgment payload');
    }
  } else {
    throw new Error('invalid judgment status');
  }

  if (relationalCase) {
    validateRelationalEvidenceCase(relationalCase);
    if (judgment.caseSha256 !== relationalCase.caseSha256) throw new Error('judgment case mismatch');
    if (judgment.inputSha256 !== relationalInputDigest(relationalCase)) throw new Error('judgment input mismatch');
  }

  return judgment;
}

export function freezeRelationalOutcome({
  relationalCase,
  judgment = null,
  observedRevision = null,
  kind,
  value,
  sourceDigest,
} = {}) {
  validateRelationalEvidenceCase(relationalCase);
  if (!OUTCOME_VALUES[kind]) throw new Error(`invalid outcome kind: ${kind}`);
  if (!OUTCOME_VALUES[kind].has(value)) throw new Error(`invalid outcome value for ${kind}: ${value}`);
  if (!shaLike(sourceDigest)) throw new Error('outcome sourceDigest must be sha256');

  if (judgment) {
    validateJevRelationalJudgment(judgment, { relationalCase });
  }

  const body = {
    schemaVersion: 1,
    caseSha256: relationalCase.caseSha256,
    judgmentSha256: judgment?.judgmentSha256 ?? null,
    observedRevision: nullableString(observedRevision, 'observedRevision'),
    kind,
    value,
    sourceDigest,
  };

  return deepFreeze({
    ...body,
    outcomeSha256: hashBody(body),
  });
}

export function validateRelationalOutcome(outcome, {
  relationalCase = null,
  judgment = null,
} = {}) {
  if (!outcome?.outcomeSha256) throw new TypeError('relational outcome required');
  const { outcomeSha256, ...body } = structuredClone(outcome);
  if (hashBody(body) !== outcomeSha256) throw new Error('relational outcome hash mismatch');
  if (!OUTCOME_VALUES[outcome.kind]?.has(outcome.value)) throw new Error('invalid relational outcome');
  if (!shaLike(outcome.caseSha256) || !shaLike(outcome.sourceDigest)) throw new Error('invalid outcome digest binding');
  if (outcome.judgmentSha256 != null && !shaLike(outcome.judgmentSha256)) throw new Error('invalid outcome judgment binding');

  if (relationalCase) {
    validateRelationalEvidenceCase(relationalCase);
    if (outcome.caseSha256 !== relationalCase.caseSha256) throw new Error('outcome case mismatch');
  }
  if (judgment) {
    validateJevRelationalJudgment(judgment, relationalCase ? { relationalCase } : {});
    if (outcome.judgmentSha256 !== judgment.judgmentSha256) throw new Error('outcome judgment mismatch');
  }

  return outcome;
}

export function relationalCalibrationRecord({
  relationalCase,
  judgment,
  outcome,
} = {}) {
  validateRelationalEvidenceCase(relationalCase);
  validateJevRelationalJudgment(judgment, { relationalCase });
  validateRelationalOutcome(outcome, { relationalCase, judgment });
  if (judgment.status !== 'answered') throw new Error('error judgment is not calibration-eligible');

  return deepFreeze({
    caseSha256: relationalCase.caseSha256,
    judgmentSha256: judgment.judgmentSha256,
    outcomeSha256: outcome.outcomeSha256,
    model: judgment.model,
    questionVersion: judgment.questionVersion,
    choice: judgment.choice,
    providerConfidence: judgment.providerConfidence,
    outcomeKind: outcome.kind,
    outcomeValue: outcome.value,
    evidenceFamilies: [...new Set(relationalCase.facts.map((fact) => fact.family))].sort(),
    sampleCount: 1,
  });
}
