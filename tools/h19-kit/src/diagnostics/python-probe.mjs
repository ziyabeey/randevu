import path from 'node:path';

import { detectH19BlindSpots } from './blind-spots.mjs';
import { buildPythonEvidenceGraph } from '../indexing/python-evidence-graph.mjs';
import { analyzeChangeImpact } from '../impact/change-impact.mjs';
import { projectGraph } from '../impact/project-graph.mjs';
import { repositoryInventory, sourceFiles } from '../repository/inventory.mjs';

const normalizePath = (value) =>
  String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');

const uniqueSorted = (values) => [...new Set(values.map(normalizePath).filter(Boolean))].sort();

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function validateRevision(value) {
  if (value == null) return null;
  const revision = String(value).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('python blind-spot probe sourceRevision must be a 40-hex Git commit');
  }
  return revision;
}

export async function runPythonBlindSpotProbe({
  repoRoot = process.cwd(),
  sourceRevision = null,
  focusFiles = null,
} = {}) {
  const root = path.resolve(repoRoot);
  const revision = validateRevision(sourceRevision);
  const discovered = (await sourceFiles(root, { extensions: new Set(['.py']) }))
    .filter((file) => file.endsWith('.py'));

  const focus = focusFiles == null
    ? discovered
    : uniqueSorted(focusFiles);

  if (focus.length === 0) throw new Error('python blind-spot probe requires at least one Python focus file');
  for (const file of focus) {
    if (!file.endsWith('.py')) throw new Error(`python blind-spot probe focus must be .py: ${file}`);
    if (!discovered.includes(file)) throw new Error(`python blind-spot probe focus not found: ${file}`);
  }

  const inventory = await repositoryInventory(root, { extensions: ['.py'] });
  const python = await buildPythonEvidenceGraph({ cwd: root });
  const graph = projectGraph({
    projects: [{ id: 'target-repository', root: '' }],
    dependencies: [],
  });

  const impacts = [];
  const mappings = [];
  for (const file of focus) {
    const units = inventory.units.filter((unit) => normalizePath(unit.path) === file);
    const impact = analyzeChangeImpact({
      projectGraph: graph,
      changedFiles: [file],
      semanticUnits: units,
      symbolGraph: python.graph,
      coverageByPath: {},
      temporalCoupling: [],
    });

    impacts.push({ scopeId: `python:${file}`, impact });
    mappings.push({
      path: file,
      semanticUnitCount: units.length,
      mappedCount: impact.symbolImpact.mapping.matches.length - impact.symbolImpact.mapping.unmatched.length,
      unmatchedCount: impact.symbolImpact.mapping.unmatched.length,
      unmatched: [...impact.symbolImpact.mapping.unmatched],
      symbols: [...impact.symbolImpact.mapping.symbols],
      impactedPaths: [...impact.symbolImpact.report.impactedPaths],
      testReferencePaths: [...impact.symbolImpact.report.testReferencePaths],
      candidateTests: impact.candidateTests.map((item) => ({ ...item })),
      unknowns: [...impact.unknowns],
      safeToNarrow: impact.safeToNarrow,
    });
  }

  const ledger = detectH19BlindSpots({
    inventory,
    focusFiles: focus,
    impacts,
    sourceRevision: revision,
  });

  return freeze({
    schemaVersion: 1,
    kind: 'h19-python-blind-spot-probe',
    sourceRevision: revision,
    repositoryRoot: root,
    focusFiles: focus,
    inventory: {
      filesScanned: inventory.filesScanned,
      semanticUnits: inventory.units.length,
      extractionErrors: inventory.errors.length,
    },
    evidenceProvider: {
      mode: python.mode,
      sourceFiles: python.project.sourceFiles,
      graphNodes: python.project.nodeCount,
      definitions: python.graph.metadata.definitionCount,
    },
    mappings,
    ledger,
    claimBoundary: {
      authority: 'diagnostic-only',
      runtimeCoverageKnown: false,
      completeKnowledgeClaimed: false,
      productDefectClaimed: false,
    },
  });
}
