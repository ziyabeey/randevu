import { relatedSymbols, symbolNode } from '../graph/symbol-graph.mjs';

function unique(values) {
  return [...new Set(values)].sort();
}

function companionMisses(rows, changedPaths, threshold) {
  const changed = new Set(changedPaths);
  const misses = [];

  for (const row of rows ?? []) {
    const a = row.a;
    const b = row.b;
    if (!a || !b) continue;

    if (changed.has(a) && !changed.has(b) && Number(row.confidenceAtoB) >= threshold) {
      misses.push({ changed: a, missing: b, confidence: Number(row.confidenceAtoB), shared: row.shared ?? null });
    }
    if (changed.has(b) && !changed.has(a) && Number(row.confidenceBtoA) >= threshold) {
      misses.push({ changed: b, missing: a, confidence: Number(row.confidenceBtoA), shared: row.shared ?? null });
    }
  }

  return misses.sort((x, y) => y.confidence - x.confidence || x.missing.localeCompare(y.missing));
}

export function referenceBlastRadius({
  graph,
  changedSymbols = [],
  changedPaths = [],
  coverageByPath = {},
  temporalCoupling = [],
  companionThreshold = 0.75,
  includeRelatedSymbols = true,
} = {}) {
  const seedSymbols = unique(changedSymbols);
  const expandedSymbols = new Set(seedSymbols);

  if (includeRelatedSymbols) {
    for (const symbol of seedSymbols) {
      for (const related of relatedSymbols(graph, symbol)) expandedSymbols.add(related);
    }
  }

  const sites = [];
  for (const symbol of [...expandedSymbols]) {
    const node = symbolNode(graph, symbol);
    if (!node) continue;
    for (const ref of node.references) {
      sites.push({
        symbol,
        path: ref.path,
        range: ref.range,
        isTestReference: ref.isTest,
        coverage: Object.prototype.hasOwnProperty.call(coverageByPath, ref.path)
          ? Boolean(coverageByPath[ref.path])
          : null,
      });
    }
  }

  const impactedPaths = unique(sites.map((x) => x.path));
  const coveredPaths = unique(sites.filter((x) => x.coverage === true).map((x) => x.path));
  const uncoveredPaths = unique(sites.filter((x) => x.coverage === false).map((x) => x.path));
  const unknownCoveragePaths = unique(sites.filter((x) => x.coverage == null).map((x) => x.path));
  const testReferencePaths = unique(sites.filter((x) => x.isTestReference).map((x) => x.path));

  return Object.freeze({
    changedSymbols: seedSymbols,
    expandedSymbols: [...expandedSymbols].sort(),
    referenceSiteCount: sites.length,
    impactedPaths,
    impactedPathCount: impactedPaths.length,
    testReferencePaths,
    testReferencePathCount: testReferencePaths.length,
    coveredPaths,
    uncoveredPaths,
    unknownCoveragePaths,
    coverageComplete: unknownCoveragePaths.length === 0,
    historicalCompanionsMissing: companionMisses(temporalCoupling, changedPaths, companionThreshold),
    sites,
    caveats: Object.freeze([
      'SCIP references are not assumed to be call edges.',
      'A test-code reference is not equivalent to runtime coverage.',
      'Coverage gaps are reported only when coverageByPath explicitly marks a path uncovered.',
    ]),
  });
}
