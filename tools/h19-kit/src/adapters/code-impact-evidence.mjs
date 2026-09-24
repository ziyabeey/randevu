import { evidence } from '../core/contracts.mjs';

export function scipImpactEvidence(impact, { source = 'scip' } = {}) {
  if (!impact) {
    return [
      evidence('impact.symbols.changed', 'unknown', { source }),
      evidence('impact.cross_file', 'unknown', { source }),
    ];
  }
  const changedDocs = impact.changedDocuments ?? [];
  const affectedDocs = impact.affectedDocuments ?? [];
  const changedSymbols = impact.changedSymbols ?? [];
  const crossFile = affectedDocs.some((doc) => !changedDocs.includes(doc));
  return [
    evidence('impact.symbols.changed', changedSymbols.length ? 'present' : 'absent', {
      source,
      count: changedSymbols.length,
      symbols: changedSymbols,
    }),
    evidence('impact.cross_file', crossFile ? 'present' : 'absent', {
      source,
      changedDocuments: changedDocs,
      affectedDocuments: affectedDocs,
      extraDocuments: affectedDocs.filter((doc) => !changedDocs.includes(doc)),
    }),
  ];
}

export function workspaceAffectedEvidence(result, { source = result?.provider ?? 'workspace' } = {}) {
  if (!result) return [evidence('workspace.affected', 'unknown', { source })];
  const projects = result.projects ?? [];
  const packages = result.packages ?? [];
  const tasks = result.tasks ?? [];
  const count = projects.length || packages.length || tasks.length;
  return [evidence('workspace.affected', count ? 'present' : 'absent', {
    source,
    projects,
    packages,
    tasks,
  })];
}

export function syntaxGraphEvidence(graph, { source = 'tree-sitter-tags' } = {}) {
  if (!graph) return [evidence('syntax.graph.available', 'unknown', { source })];
  const json = typeof graph.toJSON === 'function' ? graph.toJSON() : graph;
  return [evidence('syntax.graph.available', 'present', {
    source,
    precision: 'syntax-only',
    nodes: json?.nodes?.length ?? 0,
    edges: json?.edges?.length ?? 0,
  })];
}
