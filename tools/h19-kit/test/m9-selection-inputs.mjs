import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import { freezeComposerRelationship } from '../src/relations/relational-case-composer.mjs';

// Seeded small pools exercise the frozen optimum, including shared lineage,
// duplicate scopes, related paths, different anchors and lexical ties.
export function selectionInput(seed, count = 5 + (seed % 6)) {
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const reasons = ['surviving-mutant', 'explicit-runtime-coverage-gap',
    'unknown-runtime-coverage-on-impacted-reference', 'historical-companion-not-changed'];
  const families = ['mutation', 'coverage', 'history', 'dependency', 'test'];
  const reason = reasons[seed % reasons.length];
  const anchor = reason === 'surviving-mutant' ? 'mutation'
    : reason === 'historical-companion-not-changed' ? 'history' : 'coverage';
  const hypothesis = {
    id: `hypothesis:${seed}`, target: { kind: 'semantic-unit', path: 'src/a.ts', unitId: 'a:1' },
    reason, priority: 'high', evidenceIds: ['origin'], validation: {},
  };
  const packet = freezeCoverageDiscoveryPacket({
    changeId: `selection:${seed}`, sourceRevision: 'selection-rev',
    impact: { changedFiles: ['src/a.ts'], unknowns: [], safeToNarrow: true },
    discovery: { hypotheses: [hypothesis] },
  });
  const relation = freezeComposerRelationship({
    kind: 'reference', fromPath: 'src/a.ts', toPath: 'src/b.ts', sourceId: 'graph:1',
  });
  const scopes = [
    { kind: 'hypothesis', hypothesisId: hypothesis.id },
    { kind: 'semantic-unit', path: 'src/a.ts', unitId: 'a:1' },
    { kind: 'path', path: 'src/a.ts' },
    { kind: 'related-path', path: 'src/b.ts', relationDigest: relation.relationDigest },
  ];
  const factPool = [];
  for (let i = 0; i < count; i += 1) {
    const factId = `fact:${String(i).padStart(3, '0')}`;
    const family = i === 0 ? anchor : families[random() % families.length];
    const fact = {
      factId, family, state: 'present', metricId: `metric:${family}`, value: random() % 17,
      unit: 'count', denominator: null, sampleSize: 10, baseline: null,
      lineageIds: [`observation:${random() % 7}`, ...(random() % 3 === 0 ? ['shared'] : [])],
      provenance: { producer: 'fixture', producerVersion: '1', inputDigest: factId,
        sourceRevision: 'selection-rev', evidenceIds: [factId] },
    };
    factPool.push({ fact, scope: scopes[i === 0 ? seed % 3 : random() % scopes.length] });
    if (i % 3 === 0) factPool.push({ fact, scope: scopes[(i + seed) % scopes.length] });
  }
  return { packet, factPool, relationships: [relation] };
}
