import { evidence } from '../core/contracts.mjs';
import { affectedProjects } from './project-graph.mjs';
import { referenceBlastRadiusForUnits } from './blast-radius.mjs';
import { blastRadiusEvidence } from './evidence.mjs';
import { unitSymbolMappingEvidence } from './unit-symbol-map.mjs';

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function candidateTests(report) {
  const direct = unique(report.testReferencePaths);
  const uncovered = new Set(report.uncoveredPaths);
  const unknown = new Set(report.unknownCoveragePaths);

  return direct.map((path) => Object.freeze({
    path,
    reason: uncovered.has(path)
      ? 'test-reference-and-explicitly-uncovered'
      : unknown.has(path)
        ? 'test-reference-with-unknown-runtime-coverage'
        : 'test-reference',
  }));
}

export function analyzeChangeImpact({
  projectGraph = null,
  changedFiles = [],
  semanticUnits = [],
  symbolGraph = null,
  coverageByPath = {},
  temporalCoupling = [],
  companionThreshold = 0.75,
  includeRelatedSymbols = true,
} = {}) {
  const normalizedChangedFiles = unique(changedFiles);

  const projectImpact = projectGraph
    ? affectedProjects(projectGraph, normalizedChangedFiles)
    : Object.freeze({
        touched: [],
        affected: [],
        unownedFiles: [...normalizedChangedFiles],
      });

  const symbolImpact = referenceBlastRadiusForUnits({
    graph: symbolGraph,
    units: semanticUnits,
    changedPaths: normalizedChangedFiles,
    coverageByPath,
    temporalCoupling,
    companionThreshold,
    includeRelatedSymbols,
  });

  const evidences = [
    evidence(
      'impact.projects.affected',
      projectGraph == null
        ? 'unknown'
        : projectImpact.affected.length > 0 ? 'present' : 'absent',
      {
        touched: projectImpact.touched,
        affected: projectImpact.affected,
        unownedFiles: projectImpact.unownedFiles,
      },
    ),
    evidence(
      'impact.project_ownership_gap.present',
      projectImpact.unownedFiles.length > 0 ? 'present' : 'absent',
      { unownedFiles: projectImpact.unownedFiles },
    ),
    unitSymbolMappingEvidence(symbolImpact.mapping),
    ...blastRadiusEvidence(symbolImpact.report),
  ];

  const tests = candidateTests(symbolImpact.report);

  const unknowns = unique([
    ...(projectGraph == null ? ['project-graph'] : []),
    ...(symbolGraph == null ? ['symbol-graph'] : []),
    ...(symbolImpact.mapping.unmatched.length > 0 ? ['semantic-unit-symbol-mapping'] : []),
    ...(symbolImpact.report.unknownCoveragePaths.length > 0 ? ['runtime-coverage'] : []),
    ...(projectImpact.unownedFiles.length > 0 ? ['project-ownership'] : []),
  ]);

  return Object.freeze({
    changedFiles: normalizedChangedFiles,
    projectImpact,
    symbolImpact,
    candidateTests: Object.freeze(tests),
    evidences: Object.freeze(evidences),
    unknowns: Object.freeze(unknowns),
    safeToNarrow: unknowns.length === 0,
    caveats: Object.freeze([
      'Affected projects and SCIP references are evidence inputs, not execution authority.',
      'A test-file reference is not runtime coverage.',
      'Unknown project ownership, symbol mapping, or coverage prevents fail-open narrowing.',
    ]),
  });
}
