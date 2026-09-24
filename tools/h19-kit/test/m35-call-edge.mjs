import assert from 'node:assert/strict';

import {
  callEdgeEvidence,
  classifyReferenceCalls,
} from '../src/impact/call-edge.mjs';

const refs = [
  {
    symbol: 'demo/foo',
    path: 'src/a.ts',
    range: { startLine: 3, startCharacter: 1, endLine: 3, endCharacter: 4 },
  },
  {
    symbol: 'demo/foo',
    path: 'src/b.ts',
    range: { startLine: 8, startCharacter: 2, endLine: 8, endCharacter: 5 },
  },
];

const generic = classifyReferenceCalls(refs);
assert.equal(generic.length, 2);
assert.ok(generic.every((x) => x.state === 'unknown'));
assert.ok(generic.every((x) => x.source === 'generic-scip-reference'));

const classified = classifyReferenceCalls(refs, (ref) => {
  if (ref.path === 'src/a.ts') {
    return {
      state: 'confirmed',
      source: 'typescript-native',
      fromSymbol: 'demo/caller',
      details: { syntax: 'CallExpression' },
    };
  }
  return {
    state: 'not-call',
    source: 'typescript-native',
    details: { syntax: 'TypeReference' },
  };
});

assert.equal(classified[0].state, 'confirmed');
assert.equal(classified[1].state, 'not-call');

const evidence = callEdgeEvidence(generic);
assert.equal(evidence.find((x) => x.id === 'impact.call_edges.confirmed').state, 'absent');
assert.equal(evidence.find((x) => x.id === 'impact.call_edges.unknown').state, 'present');

const evidence2 = callEdgeEvidence(classified);
assert.equal(evidence2.find((x) => x.id === 'impact.call_edges.confirmed').state, 'present');
assert.equal(evidence2.find((x) => x.id === 'impact.call_edges.unknown').state, 'absent');

console.log('h19-kit M3.5 call-edge contract smoke: ok');
