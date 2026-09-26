import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectionInput } from './m9-selection-inputs.mjs';

import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import {
  composeRelationalCaseBatch,
  freezeComposerRelationship,
  validateRelationalCaseBatch,
} from '../src/relations/relational-case-composer.mjs';

function hypothesis({
  id,
  path,
  unitId = null,
  reason = 'surviving-mutant',
  priority = 'high',
} = {}) {
  return {
    id,
    target: {
      kind: unitId ? 'semantic-unit' : 'path',
      path,
      ...(unitId ? { unitId } : {}),
    },
    reason,
    priority,
    evidenceIds: ['evidence'],
    validation: { preferred: 'targeted-test-or-mutation', requiresRuntimeEvidence: true },
  };
}

function packet(hypotheses, sourceRevision = 'rev-1') {
  return freezeCoverageDiscoveryPacket({
    changeId: 'change-1',
    sourceRevision,
    impact: {
      changedFiles: [...new Set(hypotheses.map((item) => item.target.path))],
      unknowns: [],
      safeToNarrow: true,
    },
    discovery: { hypotheses },
  });
}

function fact({
  factId,
  family,
  metricId = `metric:${family}`,
  value = 1,
  lineageIds = [`lineage:${factId}`],
  sourceRevision = 'rev-1',
} = {}) {
  return {
    factId,
    family,
    state: 'present',
    metricId,
    value,
    unit: 'count',
    denominator: null,
    sampleSize: 10,
    baseline: {
      value: 0.5,
      sampleSize: 100,
      sourceId: `baseline:${metricId}`,
    },
    lineageIds,
    provenance: {
      producer: `producer:${family}`,
      producerVersion: '1',
      inputDigest: `input:${factId}`,
      sourceRevision,
      evidenceIds: [`evidence:${factId}`],
    },
  };
}

function scoped(f, scope) {
  return { fact: f, scope };
}

const baseHypothesis = hypothesis({
  id: 'coverage:surviving-mutant:m1:src/a.ts',
  path: 'src/a.ts',
  unitId: 'src/a.ts::run@1',
});

const basePacket = packet([baseHypothesis]);

function compose(factPool, relationships = [], p = basePacket) {
  const result = composeRelationalCaseBatch({ packet: p, factPool, relationships });
  validateRelationalCaseBatch(result.batch, {
    packet: p,
    relationalCases: result.relationalCases,
    factPool,
    relationships,
  });
  return result;
}

// RC1 — unrelated paths never enter without a validated explicit relationship.
{
  const result = compose([
    scoped(fact({ factId: 'mutation:a', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'history:b', family: 'history' }), { kind: 'path', path: 'src/unrelated.ts' }),
  ]);
  assert.equal(result.batch.cases.length, 0);
  assert.equal(result.batch.skipped[0].reason, 'insufficient-eligible-facts');

  const relation = freezeComposerRelationship({
    kind: 'temporal-coupling',
    fromPath: 'src/a.ts',
    toPath: 'src/b.ts',
    sourceId: 'history:1',
  });
  const related = compose([
    scoped(fact({ factId: 'mutation:a', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'history:b', family: 'history' }), {
      kind: 'related-path',
      path: 'src/b.ts',
      relationDigest: relation.relationDigest,
    }),
  ], [relation]);
  assert.equal(related.batch.cases.length, 1);
  assert.deepEqual(related.batch.cases[0].selectedFactIds, ['history:b', 'mutation:a']);
  const relatedScope = related.batch.cases[0].selectedScopes
    .find((scope) => scope.factId === 'history:b');
  assert.equal(relatedScope.kind, 'related-path');
  assert.equal(relatedScope.relationDigest, relation.relationDigest);

  assert.throws(() => freezeComposerRelationship({
    ...relation,
    relationDigest: '0'.repeat(64),
  }), /relationship digest mismatch/);
}

// RC2 — reason-specific direct anchor is mandatory and selected.
{
  const result = compose([
    scoped(fact({ factId: 'coverage:a', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'history:a', family: 'history' }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.equal(result.batch.cases.length, 0);
  assert.equal(result.batch.skipped[0].reason, 'missing-required-anchor');

  const accepted = compose([
    scoped(fact({ factId: 'mutation:anchor', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'history:a', family: 'history' }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.ok(accepted.batch.cases[0].selectedFactIds.includes('mutation:anchor'));
}

// RC3 — two names for one lineage do not satisfy the independence floor.
{
  const shared = ['shared-observation'];
  const result = compose([
    scoped(fact({ factId: 'mutation:shared', family: 'mutation', lineageIds: shared }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:shared', family: 'coverage', lineageIds: shared }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.equal(result.batch.cases.length, 0);
  assert.equal(result.batch.skipped[0].reason, 'insufficient-independent-families');
}

// RC4 — one case per hypothesis, with 2–4 facts only.
{
  const result = compose([
    scoped(fact({ factId: 'mutation:1', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:1', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'history:1', family: 'history' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'dependency:1', family: 'dependency' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'test:1', family: 'test' }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.equal(result.batch.cases.length, 1);
  assert.equal(result.relationalCases.length, 1);
  assert.ok(result.relationalCases[0].facts.length >= 2 && result.relationalCases[0].facts.length <= 4);
}

// RC5 — input order does not change selected facts, case hash or batch hash.
{
  const pool = [
    scoped(fact({ factId: 'mutation:stable', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:stable', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'history:stable', family: 'history' }), { kind: 'path', path: 'src/a.ts' }),
  ];
  const a = compose(pool);
  const b = compose([...pool].reverse());
  assert.deepEqual(a.batch.cases[0].selectedFactIds, b.batch.cases[0].selectedFactIds);
  assert.equal(a.batch.cases[0].caseSha256, b.batch.cases[0].caseSha256);
  assert.equal(a.batch.batchSha256, b.batch.batchSha256);
}

// RC6 — after independence/family tie, lower lineage overlap wins.
{
  const result = compose([
    scoped(fact({ factId: 'mutation:root', family: 'mutation', lineageIds: ['L0'] }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:one-overlap', family: 'coverage', lineageIds: ['L0'] }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:two-overlaps', family: 'coverage', lineageIds: ['L0', 'L1'] }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'history:root', family: 'history', lineageIds: ['L1'] }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.deepEqual(
    result.batch.cases[0].selectedFactIds,
    ['coverage:one-overlap', 'history:root', 'mutation:root'],
  );
}

// RC8 — exact scope beats related scope after independence/family + minimality objectives tie.
{
  const relation = freezeComposerRelationship({
    kind: 'dependency',
    fromPath: 'src/a.ts',
    toPath: 'src/related.ts',
    sourceId: 'graph:1',
  });
  const result = compose([
    scoped(fact({ factId: 'mutation:anchor', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:exact', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:related', family: 'coverage' }), {
      kind: 'related-path',
      path: 'src/related.ts',
      relationDigest: relation.relationDigest,
    }),
  ], [relation]);
  assert.ok(result.batch.cases[0].selectedFactIds.includes('coverage:exact'));
  assert.ok(!result.batch.cases[0].selectedFactIds.includes('coverage:related'));
}

// RC7 — smaller case wins before redundant context can gain scope points.
{
  const result = compose([
    scoped(fact({ factId: 'mutation:strong', family: 'mutation' }), {
      kind: 'hypothesis',
      hypothesisId: baseHypothesis.id,
    }),
    scoped(fact({ factId: 'mutation:weak', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:a', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:b', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.equal(result.batch.cases[0].selectedFactIds.length, 2);
  assert.ok(result.batch.cases[0].selectedFactIds.includes('mutation:strong'));
}

// RC9 — final tie-break is lexical fact ID order.
{
  const result = compose([
    scoped(fact({ factId: 'mutation:anchor', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:a', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:b', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.deepEqual(result.batch.cases[0].selectedFactIds, ['coverage:a', 'mutation:anchor']);
}

// RC10 — batch cap is 20 and overflow is explicit.
{
  const hypotheses = Array.from({ length: 21 }, (_, index) => hypothesis({
    id: `coverage:surviving-mutant:m${String(index).padStart(2, '0')}:src/f${index}.ts`,
    path: `src/f${index}.ts`,
  }));
  const p = packet(hypotheses);
  const pool = hypotheses.flatMap((h, index) => [
    scoped(fact({ factId: `mutation:${index}`, family: 'mutation' }), { kind: 'path', path: h.target.path }),
    scoped(fact({ factId: `coverage:${index}`, family: 'coverage' }), { kind: 'path', path: h.target.path }),
  ]);
  const result = compose(pool, [], p);
  assert.equal(result.batch.cases.length, 20);
  assert.equal(result.relationalCases.length, 20);
  assert.equal(result.batch.truncated, true);
  assert.equal(result.batch.skipped.filter((item) => item.reason === 'batch-cap').length, 1);
}

// RC11 — conflicting duplicates fail closed; exact duplicates deduplicate.
{
  const duplicate = scoped(
    fact({ factId: 'mutation:dup', family: 'mutation' }),
    { kind: 'path', path: 'src/a.ts' },
  );
  const exact = compose([
    duplicate,
    structuredClone(duplicate),
    scoped(fact({ factId: 'coverage:dup', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
  ]);
  assert.equal(exact.batch.cases.length, 1);

  const conflicting = structuredClone(duplicate);
  conflicting.fact.value = 9;
  assert.throws(() => compose([
    duplicate,
    conflicting,
    scoped(fact({ factId: 'coverage:dup', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
  ]), /conflicting duplicate factId/);
}

// RC12 / RC14 — source facts remain unchanged and output authority remains advisory.
{
  const pool = [
    scoped(fact({ factId: 'mutation:immutable', family: 'mutation' }), { kind: 'path', path: 'src/a.ts' }),
    scoped(fact({ factId: 'coverage:immutable', family: 'coverage' }), { kind: 'path', path: 'src/a.ts' }),
  ];
  const before = JSON.stringify(pool);
  const result = compose(pool);
  assert.equal(JSON.stringify(pool), before);
  assert.equal(result.relationalCases[0].authority, 'advisory');
}

// RC13 / RC15 — composer has no model/network/H19s dependency.
{
  const source = await readFile(new URL('../src/relations/relational-case-composer.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /typesafe\.ai|askJev|fetch\s*\(/);
  assert.doesNotMatch(source, /h19s|shadow-01/i);
}

// RC16 — canonical composition inputs and selected scope provenance are bound.
{
  const relation = freezeComposerRelationship({
    kind: 'dependency',
    fromPath: 'src/a.ts',
    toPath: 'src/b.ts',
    sourceId: 'graph:rc16',
  });
  const anchor = scoped(
    fact({ factId: 'mutation:rc16', family: 'mutation' }),
    { kind: 'path', path: 'src/a.ts' },
  );
  const related = scoped(
    fact({ factId: 'history:rc16', family: 'history' }),
    { kind: 'related-path', path: 'src/b.ts', relationDigest: relation.relationDigest },
  );

  const base = compose([anchor, related], [relation]);
  const reordered = compose(
    [structuredClone(related), structuredClone(anchor), structuredClone(anchor)],
    [relation],
  );

  assert.equal(base.batch.compositionInputSha256, reordered.batch.compositionInputSha256);
  assert.equal(base.batch.batchSha256, reordered.batch.batchSha256);

  const selected = base.batch.cases[0].selectedScopes;
  assert.deepEqual(selected.map((item) => item.factId), ['history:rc16', 'mutation:rc16']);
  assert.equal(selected[0].kind, 'related-path');
  assert.equal(selected[0].relationDigest, relation.relationDigest);
  assert.equal(selected[1].kind, 'path');
  assert.equal(selected[1].relationDigest, null);

  const changedRelation = freezeComposerRelationship({
    kind: 'dependency',
    fromPath: 'src/a.ts',
    toPath: 'src/b.ts',
    sourceId: 'graph:rc16-remeasured',
  });
  const changedRelated = scoped(
    related.fact,
    { kind: 'related-path', path: 'src/b.ts', relationDigest: changedRelation.relationDigest },
  );
  const changed = compose([anchor, changedRelated], [changedRelation]);

  assert.notEqual(base.batch.compositionInputSha256, changed.batch.compositionInputSha256);
  assert.equal(base.batch.cases[0].caseSha256, changed.batch.cases[0].caseSha256);

  assert.throws(() => validateRelationalCaseBatch(base.batch, {
    packet: basePacket,
    relationalCases: base.relationalCases,
    factPool: [anchor, changedRelated],
    relationships: [changedRelation],
  }), /composition input replay mismatch/);
}

// Full artifact identity must remain byte-equivalent to the original exhaustive
// v0.1 selector, not just to a second copy of the optimized implementation.
{
  const golden = JSON.parse(await readFile(new URL('./m9-selection-v01-golden.json', import.meta.url), 'utf8'));
  for (const expected of golden.cases) {
    const input = selectionInput(expected.seed);
    const result = composeRelationalCaseBatch(input);
    assert.equal(result.batch.batchSha256, expected.batchSha256, `frozen batch seed ${expected.seed}`);
    assert.equal(result.relationalCases[0]?.caseSha256 ?? null, expected.caseSha256);
    const reversed = composeRelationalCaseBatch({ ...input, factPool: [...input.factPool].reverse() });
    assert.equal(reversed.batch.batchSha256, expected.batchSha256);
  }
}

// A wide two-family pool has a two-fact optimum. Extra same-family context must
// not produce a combinatorial allocation or change minimality/tie-breaking.
{
  const pool = Array.from({ length: 100 }, (_, index) => scoped(fact({
    factId: `wide:${String(index).padStart(3, '0')}`,
    family: index === 0 ? 'mutation' : 'coverage',
  }), { kind: 'path', path: 'src/a.ts' }));
  const result = compose(pool);
  assert.deepEqual(result.batch.cases[0].selectedFactIds, ['wide:000', 'wide:001']);
}

// After 20 accepted cases, invalid hypotheses keep their original reasons;
// only an actually valid overflow hypothesis may become batch-cap.
{
  const hs = Array.from({ length: 24 }, (_, index) => hypothesis({
    id: `overflow:${String(index).padStart(2, '0')}`, path: `src/o${index}.ts`,
  }));
  const pool = hs.flatMap((h, index) => {
    const items = [
      fact({ factId: `overflow-m:${index}`, family: index === 20 ? 'history' : 'mutation' }),
      fact({ factId: `overflow-c:${index}`, family: 'coverage' }),
    ];
    if (index === 21) for (const item of items) item.lineageIds = ['same'];
    if (index === 22) items.pop();
    return items.map((item) => scoped(item, { kind: 'path', path: h.target.path }));
  });
  const result = compose(pool, [], packet(hs));
  assert.equal(result.batch.cases.length, 20);
  assert.equal(result.batch.truncated, true);
  assert.deepEqual(result.batch.skipped.map((row) => row.reason), [
    'missing-required-anchor', 'insufficient-independent-families',
    'insufficient-eligible-facts', 'batch-cap',
  ]);
}

console.log('H19 Kit M9 relational case composer smoke passed (RC1-RC16 + 96 frozen selection cases).');
