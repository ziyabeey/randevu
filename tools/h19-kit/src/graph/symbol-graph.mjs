import { SCIP_ROLES, hasScipRole, normalizeScipIndex } from '../adapters/scip.mjs';

function location(path, occurrence) {
  return Object.freeze({
    path,
    range: occurrence.range ?? null,
    roles: occurrence.symbolRoles,
    isTest: hasScipRole(occurrence.symbolRoles, SCIP_ROLES.TEST),
    isRead: hasScipRole(occurrence.symbolRoles, SCIP_ROLES.READ),
    isWrite: hasScipRole(occurrence.symbolRoles, SCIP_ROLES.WRITE),
    isImport: hasScipRole(occurrence.symbolRoles, SCIP_ROLES.IMPORT),
  });
}

export function buildSymbolGraph(input) {
  const index = normalizeScipIndex(input);
  const nodes = new Map();

  const ensure = (symbol) => {
    if (!nodes.has(symbol)) {
      nodes.set(symbol, {
        symbol,
        displayName: '',
        kind: null,
        definitions: [],
        references: [],
        relationships: [],
      });
    }
    return nodes.get(symbol);
  };

  for (const doc of index.documents) {
    for (const info of doc.symbols) {
      if (!info.symbol) continue;
      const node = ensure(info.symbol);
      if (info.displayName) node.displayName = info.displayName;
      if (info.kind != null) node.kind = info.kind;
      node.relationships.push(...info.relationships);
      for (const rel of info.relationships) {
        if (rel.symbol) ensure(rel.symbol);
      }
    }

    for (const occ of doc.occurrences) {
      if (!occ.symbol) continue;
      const node = ensure(occ.symbol);
      const loc = location(doc.path, occ);
      if (hasScipRole(occ.symbolRoles, SCIP_ROLES.DEFINITION)) node.definitions.push(loc);
      else node.references.push(loc);
    }
  }

  const frozenNodes = [...nodes.values()]
    .map((node) => Object.freeze({
      ...node,
      definitions: Object.freeze([...node.definitions]),
      references: Object.freeze([...node.references]),
      relationships: Object.freeze([...node.relationships]),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return Object.freeze({
    metadata: index.metadata,
    nodeCount: frozenNodes.length,
    nodes: frozenNodes,
  });
}

export function symbolNode(graph, symbol) {
  return graph.nodes.find((node) => node.symbol === symbol) ?? null;
}

export function relatedSymbols(graph, symbol, {
  implementations = true,
  references = true,
  definitions = true,
} = {}) {
  const start = symbolNode(graph, symbol);
  if (!start) return [];

  const out = new Set();
  for (const rel of start.relationships) {
    if ((implementations && rel.isImplementation)
      || (references && rel.isReference)
      || (definitions && rel.isDefinition)) {
      if (rel.symbol) out.add(rel.symbol);
    }
  }

  for (const node of graph.nodes) {
    for (const rel of node.relationships) {
      if (rel.symbol !== symbol) continue;
      if ((implementations && rel.isImplementation)
        || (references && rel.isReference)
        || (definitions && rel.isDefinition)) {
        out.add(node.symbol);
      }
    }
  }

  return [...out].sort();
}
