export class CodeGraph {
  #nodes = new Map();
  #edges = [];

  addNode(id, type, data = {}) {
    if (!id || !type) throw new TypeError('graph node requires id and type');
    const current = this.#nodes.get(id);
    const next = Object.freeze({
      id,
      type,
      ...(current?.data ? current.data : {}),
      ...structuredClone(data),
    });
    this.#nodes.set(id, { id, type, data: next });
    return next;
  }

  addEdge(from, to, kind, data = {}) {
    if (!from || !to || !kind) throw new TypeError('graph edge requires from, to and kind');
    this.#edges.push(Object.freeze({ from, to, kind, ...structuredClone(data) }));
  }

  node(id) {
    return this.#nodes.get(id)?.data ?? null;
  }

  nodes(type = null) {
    return [...this.#nodes.values()]
      .map((x) => x.data)
      .filter((x) => !type || x.type === type);
  }

  edges(kind = null) {
    return this.#edges.filter((x) => !kind || x.kind === kind);
  }

  outgoing(id, kinds = null) {
    const allow = kinds ? new Set(Array.isArray(kinds) ? kinds : [kinds]) : null;
    return this.#edges.filter((x) => x.from === id && (!allow || allow.has(x.kind)));
  }

  incoming(id, kinds = null) {
    const allow = kinds ? new Set(Array.isArray(kinds) ? kinds : [kinds]) : null;
    return this.#edges.filter((x) => x.to === id && (!allow || allow.has(x.kind)));
  }

  impactClosure(startIds, {
    kinds = null,
    maxDepth = 4,
    direction = 'both',
  } = {}) {
    const allow = kinds ? new Set(Array.isArray(kinds) ? kinds : [kinds]) : null;
    const seen = new Set(startIds);
    let frontier = [...startIds];

    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next = [];
      for (const id of frontier) {
        const edges = this.#edges.filter((edge) => {
          if (allow && !allow.has(edge.kind)) return false;
          if (direction === 'out') return edge.from === id;
          if (direction === 'in') return edge.to === id;
          return edge.from === id || edge.to === id;
        });
        for (const edge of edges) {
          const other = edge.from === id ? edge.to : edge.from;
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    return [...seen];
  }

  toJSON() {
    return {
      schemaVersion: 1,
      nodes: this.nodes().sort((a, b) => a.id.localeCompare(b.id)),
      edges: this.edges().sort((a, b) => {
        const ka = `${a.from}\0${a.to}\0${a.kind}`;
        const kb = `${b.from}\0${b.to}\0${b.kind}`;
        return ka.localeCompare(kb);
      }),
    };
  }
}

export function mergeGraphs(...graphs) {
  const out = new CodeGraph();
  for (const graph of graphs) {
    const json = typeof graph?.toJSON === 'function' ? graph.toJSON() : graph;
    for (const node of json?.nodes ?? []) out.addNode(node.id, node.type, node);
    for (const edge of json?.edges ?? []) out.addEdge(edge.from, edge.to, edge.kind, edge);
  }
  return out;
}
