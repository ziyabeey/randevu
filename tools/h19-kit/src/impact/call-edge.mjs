import { evidence } from '../core/contracts.mjs';

const STATES = new Set(['confirmed', 'not-call', 'unknown']);

export function callEdge({
  fromSymbol = null,
  toSymbol,
  path,
  range = null,
  state = 'unknown',
  source,
  details = {},
} = {}) {
  if (!toSymbol || !path || !source) throw new TypeError('callEdge requires toSymbol, path and source');
  if (!STATES.has(state)) throw new TypeError(`invalid call-edge state: ${state}`);
  return Object.freeze({
    fromSymbol,
    toSymbol,
    path,
    range,
    state,
    source,
    details: structuredClone(details),
  });
}

export function classifyReferenceCalls(references = [], classifier = null) {
  return references.map((ref) => {
    if (!classifier) {
      return callEdge({
        toSymbol: ref.symbol,
        path: ref.path,
        range: ref.range ?? null,
        state: 'unknown',
        source: 'generic-scip-reference',
        details: { reason: 'SCIP reference alone is not a call edge.' },
      });
    }
    const result = classifier(ref);
    if (!result) {
      return callEdge({
        toSymbol: ref.symbol,
        path: ref.path,
        range: ref.range ?? null,
        state: 'unknown',
        source: 'classifier',
      });
    }
    return callEdge({
      toSymbol: ref.symbol,
      path: ref.path,
      range: ref.range ?? null,
      ...result,
    });
  });
}

export function callEdgeEvidence(edges = []) {
  const confirmed = edges.filter((x) => x.state === 'confirmed');
  const unknown = edges.filter((x) => x.state === 'unknown');

  return [
    evidence(
      'impact.call_edges.confirmed',
      confirmed.length > 0 ? 'present' : 'absent',
      {
        count: confirmed.length,
        edges: confirmed,
      },
    ),
    evidence(
      'impact.call_edges.unknown',
      unknown.length > 0 ? 'present' : 'absent',
      {
        count: unknown.length,
        edges: unknown,
      },
    ),
  ];
}
