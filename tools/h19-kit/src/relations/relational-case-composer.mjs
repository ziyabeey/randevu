import { createHash } from 'node:crypto';

import { stableJson } from '../core/cache.mjs';
import {
  buildRelationalEvidenceCase,
  lineageFeatures,
  normalizeRelationalFact,
  validateRelationalEvidenceCase,
} from './relational-evidence.mjs';
import { verifyCoveragePacket } from '../specification/test-spec.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const hashBody = (value) => sha256(`${stableJson(value)}\n`);

export const RELATIONAL_CASE_BATCH_MAX = 20;

const SCOPE_STRENGTH = Object.freeze({
  hypothesis: 4,
  'semantic-unit': 3,
  path: 2,
  'related-path': 1,
});

const ANCHOR_FAMILY = Object.freeze({
  'surviving-mutant': 'mutation',
  'explicit-runtime-coverage-gap': 'coverage',
  'unknown-runtime-coverage-on-impacted-reference': 'coverage',
  'historical-companion-not-changed': 'history',
});

const PRIORITY_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function shaLike(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function clone(value) {
  return structuredClone(value);
}

function relationBody(record = {}) {
  const body = clone(record);
  delete body.relationDigest;
  if (!nonEmpty(body.kind)) throw new TypeError('relationship kind required');
  if (!nonEmpty(body.fromPath) || !nonEmpty(body.toPath)) {
    throw new TypeError('relationship requires fromPath and toPath');
  }
  if (!nonEmpty(body.sourceId)) throw new TypeError('relationship sourceId required');
  body.kind = String(body.kind);
  body.fromPath = String(body.fromPath);
  body.toPath = String(body.toPath);
  body.sourceId = String(body.sourceId);
  return body;
}

export function freezeComposerRelationship(record = {}) {
  const body = relationBody(record);
  const relationDigest = hashBody(body);
  if (record.relationDigest != null && record.relationDigest !== relationDigest) {
    throw new Error('relationship digest mismatch');
  }
  return deepFreeze({ ...body, relationDigest });
}

function normalizeScope(scope = {}) {
  if (!Object.hasOwn(SCOPE_STRENGTH, scope.kind)) {
    throw new TypeError(`invalid relational fact scope: ${scope.kind}`);
  }

  const normalized = {
    kind: scope.kind,
    hypothesisId: scope.hypothesisId == null ? null : String(scope.hypothesisId),
    path: scope.path == null ? null : String(scope.path),
    unitId: scope.unitId == null ? null : String(scope.unitId),
    relationDigest: scope.relationDigest == null ? null : String(scope.relationDigest),
  };

  if (scope.kind === 'hypothesis' && !nonEmpty(normalized.hypothesisId)) {
    throw new TypeError('hypothesis scope requires hypothesisId');
  }
  if (scope.kind === 'semantic-unit'
    && (!nonEmpty(normalized.path) || !nonEmpty(normalized.unitId))) {
    throw new TypeError('semantic-unit scope requires path and unitId');
  }
  if (scope.kind === 'path' && !nonEmpty(normalized.path)) {
    throw new TypeError('path scope requires path');
  }
  if (scope.kind === 'related-path'
    && (!nonEmpty(normalized.path) || !shaLike(normalized.relationDigest))) {
    throw new TypeError('related-path scope requires path and relationDigest');
  }

  return deepFreeze(normalized);
}

export function freezeScopedRelationalFact({ fact, scope } = {}) {
  return deepFreeze({
    fact: normalizeRelationalFact(fact),
    scope: normalizeScope(scope),
  });
}

function relationshipIndex(records = []) {
  const index = new Map();
  for (const record of records) {
    const frozen = freezeComposerRelationship(record);
    if (index.has(frozen.relationDigest)
      && stableJson(index.get(frozen.relationDigest)) !== stableJson(frozen)) {
      throw new Error(`conflicting relationship digest: ${frozen.relationDigest}`);
    }
    index.set(frozen.relationDigest, frozen);
  }
  return index;
}

function dedupeFactPool(entries = []) {
  const byId = new Map();

  for (const input of entries) {
    const entry = freezeScopedRelationalFact(input);
    const id = entry.fact.factId;
    const factJson = stableJson(entry.fact);
    const current = byId.get(id);

    if (!current) {
      byId.set(id, {
        fact: entry.fact,
        factJson,
        scopes: new Map([[stableJson(entry.scope), entry.scope]]),
      });
      continue;
    }

    if (current.factJson !== factJson) {
      throw new Error(`conflicting duplicate factId: ${id}`);
    }
    current.scopes.set(stableJson(entry.scope), entry.scope);
  }

  return [...byId.values()]
    .map((entry) => deepFreeze({
      fact: entry.fact,
      scopes: [...entry.scopes.values()]
        .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    }))
    .sort((a, b) => a.fact.factId.localeCompare(b.fact.factId));
}

function compositionInputSha256(packet, facts, relations) {
  const canonical = {
    packetSha256: packet.packetSha256,
    factPool: facts.map((entry) => ({
      fact: clone(entry.fact),
      scopes: clone(entry.scopes),
    })),
    relationships: [...relations.values()]
      .sort((a, b) => a.relationDigest.localeCompare(b.relationDigest))
      .map(clone),
  };
  return hashBody(canonical);
}

function relationConnects(record, hypothesisPath, relatedPath) {
  return (record.fromPath === hypothesisPath && record.toPath === relatedPath)
    || (record.toPath === hypothesisPath && record.fromPath === relatedPath);
}

function matchScope(hypothesis, scope, relations) {
  const target = hypothesis.target ?? {};
  if (scope.kind === 'hypothesis') {
    if (scope.hypothesisId !== hypothesis.id) return null;
    return { kind: scope.kind, strength: SCOPE_STRENGTH[scope.kind] };
  }

  if (scope.kind === 'semantic-unit') {
    if (!target.unitId
      || scope.path !== target.path
      || scope.unitId !== target.unitId) return null;
    return { kind: scope.kind, strength: SCOPE_STRENGTH[scope.kind] };
  }

  if (scope.kind === 'path') {
    if (scope.path !== target.path) return null;
    return { kind: scope.kind, strength: SCOPE_STRENGTH[scope.kind] };
  }

  const relation = relations.get(scope.relationDigest);
  if (!relation || !relationConnects(relation, target.path, scope.path)) return null;
  return {
    kind: scope.kind,
    strength: SCOPE_STRENGTH[scope.kind],
    relationDigest: scope.relationDigest,
  };
}

function bestScopeMatch(hypothesis, scopes, relations) {
  const matches = scopes
    .map((scope) => ({ scope, match: matchScope(hypothesis, scope, relations) }))
    .filter((item) => item.match)
    .sort((a, b) => b.match.strength - a.match.strength
      || stableJson(a.scope).localeCompare(stableJson(b.scope)));
  return matches[0] ?? null;
}

function lineageOverlapCount(facts) {
  let count = 0;
  for (let i = 0; i < facts.length; i += 1) {
    const left = new Set(facts[i].lineageIds);
    for (let j = i + 1; j < facts.length; j += 1) {
      if (facts[j].lineageIds.some((id) => left.has(id))) count += 1;
    }
  }
  return count;
}

function independentFamilyCount(facts) {
  const feature = lineageFeatures(facts)
    .find((item) => item.kind === 'independent-family-count');
  return feature?.value ?? 0;
}

function directAnchor(candidate, hypothesis) {
  const requiredFamily = ANCHOR_FAMILY[hypothesis.reason];
  if (!requiredFamily) throw new Error(`unsupported hypothesis reason: ${hypothesis.reason}`);
  return candidate.fact.family === requiredFamily && candidate.scopeStrength >= SCOPE_STRENGTH.path;
}

function combinations(items, minSize = 2, maxSize = 4) {
  const result = [];
  const visit = (start, picked) => {
    if (picked.length >= minSize) result.push([...picked]);
    if (picked.length === maxSize) return;
    for (let i = start; i < items.length; i += 1) {
      picked.push(items[i]);
      visit(i + 1, picked);
      picked.pop();
    }
  };
  visit(0, []);
  return result;
}

function subsetScore(subset) {
  const facts = subset.map((item) => item.fact);
  const familyCount = new Set(facts.map((fact) => fact.family)).size;
  const factIds = facts.map((fact) => fact.factId).sort();
  return {
    independentFamilyCount: independentFamilyCount(facts),
    familyCount,
    scopeStrengthSum: subset.reduce((sum, item) => sum + item.scopeStrength, 0),
    lineageOverlapCount: lineageOverlapCount(facts),
    caseSize: subset.length,
    factIds,
  };
}

function compareSubset(a, b) {
  return b.score.independentFamilyCount - a.score.independentFamilyCount
    || b.score.familyCount - a.score.familyCount
    || a.score.lineageOverlapCount - b.score.lineageOverlapCount
    || a.score.caseSize - b.score.caseSize
    || b.score.scopeStrengthSum - a.score.scopeStrengthSum
    || stableJson(a.score.factIds).localeCompare(stableJson(b.score.factIds));
}

function selectForHypothesis({ packet, hypothesis, facts, relations }) {
  const eligible = [];

  for (const entry of facts) {
    const scoped = bestScopeMatch(hypothesis, entry.scopes, relations);
    if (!scoped) continue;
    eligible.push({
      fact: entry.fact,
      scope: scoped.scope,
      scopeStrength: scoped.match.strength,
      relationDigest: scoped.match.relationDigest ?? null,
    });
  }

  eligible.sort((a, b) => a.fact.factId.localeCompare(b.fact.factId));
  const eligibleFactIds = eligible.map((item) => item.fact.factId);
  const anchors = eligible.filter((candidate) => directAnchor(candidate, hypothesis));

  if (!anchors.length) {
    return {
      skipped: {
        hypothesisId: hypothesis.id,
        reason: 'missing-required-anchor',
        eligibleFactIds,
      },
    };
  }

  if (eligible.length < 2) {
    return {
      skipped: {
        hypothesisId: hypothesis.id,
        reason: 'insufficient-eligible-facts',
        eligibleFactIds,
      },
    };
  }

  const valid = combinations(eligible)
    .filter((subset) => subset.some((candidate) => directAnchor(candidate, hypothesis)))
    .map((subset) => ({ subset, score: subsetScore(subset) }))
    .filter((candidate) => candidate.score.independentFamilyCount >= 2)
    .sort(compareSubset);

  if (!valid.length) {
    return {
      skipped: {
        hypothesisId: hypothesis.id,
        reason: 'insufficient-independent-families',
        eligibleFactIds,
      },
    };
  }

  const winner = valid[0];
  const relationalCase = buildRelationalEvidenceCase({
    packet,
    hypothesisId: hypothesis.id,
    facts: winner.subset.map((item) => item.fact),
  });
  validateRelationalEvidenceCase(relationalCase, { packet });

  const selectedScopes = winner.subset
    .map((item) => ({
      factId: item.fact.factId,
      kind: item.scope.kind,
      strength: item.scopeStrength,
      relationDigest: item.relationDigest,
    }))
    .sort((a, b) => a.factId.localeCompare(b.factId));

  return {
    relationalCase,
    eligibleFactIds,
    summary: {
      hypothesisId: hypothesis.id,
      caseSha256: relationalCase.caseSha256,
      selectedFactIds: winner.score.factIds,
      selectedScopes,
      independentFamilyCount: winner.score.independentFamilyCount,
      selectionReason: 'max-independent-evidence',
    },
  };
}

function orderedHypotheses(packet) {
  return [...packet.hypotheses].sort((a, b) =>
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    || a.id.localeCompare(b.id));
}

function freezeBatch(body) {
  return deepFreeze({
    ...body,
    batchSha256: hashBody(body),
  });
}

export function composeRelationalCaseBatch({
  packet,
  factPool = [],
  relationships = [],
} = {}) {
  verifyCoveragePacket(packet);
  const facts = dedupeFactPool(factPool);
  const relations = relationshipIndex(relationships);
  const inputSha256 = compositionInputSha256(packet, facts, relations);
  const accepted = [];
  const skipped = [];

  for (const hypothesis of orderedHypotheses(packet)) {
    const result = selectForHypothesis({ packet, hypothesis, facts, relations });
    if (result.skipped) {
      skipped.push(result.skipped);
      continue;
    }
    accepted.push(result);
  }

  const emitted = accepted.slice(0, RELATIONAL_CASE_BATCH_MAX);
  const overflow = accepted.slice(RELATIONAL_CASE_BATCH_MAX);
  for (const result of overflow) {
    skipped.push({
      hypothesisId: result.summary.hypothesisId,
      reason: 'batch-cap',
      eligibleFactIds: result.eligibleFactIds,
    });
  }

  const emittedIds = new Set(emitted.map((item) => item.summary.hypothesisId));
  const hypothesisOrder = new Map(orderedHypotheses(packet).map((item, index) => [item.id, index]));
  skipped.sort((a, b) =>
    (hypothesisOrder.get(a.hypothesisId) ?? Number.MAX_SAFE_INTEGER)
      - (hypothesisOrder.get(b.hypothesisId) ?? Number.MAX_SAFE_INTEGER)
    || a.hypothesisId.localeCompare(b.hypothesisId));

  const batch = freezeBatch({
    schemaVersion: 1,
    packetSha256: packet.packetSha256,
    sourceRevision: packet.sourceRevision ?? null,
    compositionInputSha256: inputSha256,
    maxCases: RELATIONAL_CASE_BATCH_MAX,
    cases: emitted.map((item) => item.summary),
    skipped,
    truncated: overflow.length > 0,
  });

  return deepFreeze({
    batch,
    relationalCases: emitted
      .filter((item) => emittedIds.has(item.summary.hypothesisId))
      .map((item) => item.relationalCase),
  });
}

export function validateRelationalCaseBatch(batch, {
  packet = null,
  relationalCases = null,
  factPool = null,
  relationships = [],
} = {}) {
  if (!batch?.batchSha256) throw new TypeError('relational case batch required');
  const { batchSha256, ...body } = clone(batch);
  if (hashBody(body) !== batchSha256) throw new Error('relational case batch hash mismatch');
  if (batch.schemaVersion !== 1 || batch.maxCases !== RELATIONAL_CASE_BATCH_MAX) {
    throw new Error('unsupported relational case batch version');
  }
  if (!shaLike(batch.packetSha256)) throw new Error('invalid batch packet digest');
  if (!shaLike(batch.compositionInputSha256)) throw new Error('invalid composition input digest');
  if (!Array.isArray(batch.cases) || batch.cases.length > RELATIONAL_CASE_BATCH_MAX) {
    throw new Error('invalid relational case batch size');
  }
  if (!Array.isArray(batch.skipped)) throw new Error('batch skipped ledger required');
  if (batch.truncated !== batch.skipped.some((item) => item.reason === 'batch-cap')) {
    throw new Error('batch truncation flag mismatch');
  }

  const ids = batch.cases.map((item) => item.hypothesisId);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate hypothesis case');
  for (const item of batch.cases) {
    if (!shaLike(item.caseSha256)) throw new Error('invalid case digest');
    if (item.selectionReason !== 'max-independent-evidence') throw new Error('invalid selection reason');
    if (!Array.isArray(item.selectedFactIds)
      || item.selectedFactIds.length < 2
      || item.selectedFactIds.length > 4
      || new Set(item.selectedFactIds).size !== item.selectedFactIds.length) {
      throw new Error('invalid selected fact IDs');
    }
    if (!Array.isArray(item.selectedScopes)
      || item.selectedScopes.length !== item.selectedFactIds.length) {
      throw new Error('invalid selected scope bindings');
    }
    const scopeFactIds = item.selectedScopes.map((scope) => scope.factId);
    if (new Set(scopeFactIds).size !== scopeFactIds.length
      || stableJson([...scopeFactIds].sort()) !== stableJson([...item.selectedFactIds].sort())) {
      throw new Error('selected scope bindings do not match selected facts');
    }
    for (const scope of item.selectedScopes) {
      if (!Object.hasOwn(SCOPE_STRENGTH, scope.kind)
        || scope.strength !== SCOPE_STRENGTH[scope.kind]) {
        throw new Error('invalid selected scope strength');
      }
      if (scope.kind === 'related-path') {
        if (!shaLike(scope.relationDigest)) throw new Error('related selected scope requires relation digest');
      } else if (scope.relationDigest !== null) {
        throw new Error('direct selected scope cannot carry relation digest');
      }
    }
    if (!Number.isInteger(item.independentFamilyCount)
      || item.independentFamilyCount < 2
      || item.independentFamilyCount > 4) {
      throw new Error('invalid independent family count');
    }
  }

  if (packet) {
    verifyCoveragePacket(packet);
    if (packet.packetSha256 !== batch.packetSha256
      || (packet.sourceRevision ?? null) !== batch.sourceRevision) {
      throw new Error('batch packet binding mismatch');
    }
    const expectedOrder = orderedHypotheses(packet).map((item) => item.id);
    const observedOrder = [
      ...batch.cases.map((item) => item.hypothesisId),
      ...batch.skipped.filter((item) => item.reason === 'batch-cap').map((item) => item.hypothesisId),
    ];
    for (let i = 1; i < observedOrder.length; i += 1) {
      if (expectedOrder.indexOf(observedOrder[i - 1]) > expectedOrder.indexOf(observedOrder[i])) {
        throw new Error('batch hypothesis order mismatch');
      }
    }
  }

  if (factPool != null) {
    if (!packet) throw new Error('packet required to verify composition inputs');
    const replay = composeRelationalCaseBatch({ packet, factPool, relationships });
    if (replay.batch.compositionInputSha256 !== batch.compositionInputSha256
      || replay.batch.batchSha256 !== batch.batchSha256) {
      throw new Error('composition input replay mismatch');
    }
  }

  if (relationalCases) {
    if (relationalCases.length !== batch.cases.length) throw new Error('batch case artifact count mismatch');
    const bySha = new Map(relationalCases.map((item) => [item.caseSha256, item]));
    for (const summary of batch.cases) {
      const relationalCase = bySha.get(summary.caseSha256);
      if (!relationalCase) throw new Error(`missing relational case artifact: ${summary.caseSha256}`);
      validateRelationalEvidenceCase(relationalCase, packet ? { packet } : {});
      if (relationalCase.hypothesis.hypothesisId !== summary.hypothesisId) {
        throw new Error('relational case hypothesis summary mismatch');
      }
      const factIds = relationalCase.facts.map((fact) => fact.factId).sort();
      if (stableJson(factIds) !== stableJson([...summary.selectedFactIds].sort())) {
        throw new Error('relational case fact summary mismatch');
      }
      if (relationalCase.authority !== 'advisory') throw new Error('composer changed case authority');
    }
  }

  return batch;
}
