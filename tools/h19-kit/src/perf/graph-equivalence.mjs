import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readScipJson } from '../adapters/scip.mjs';
import { ArtifactCache } from '../core/artifact-cache.mjs';
import { stableJson } from '../core/cache.mjs';
import { buildSymbolGraph } from '../graph/symbol-graph.mjs';
import {
  compareScipDocumentEvidence,
  mergeScipIndexes,
} from '../graph/merge-scip-indexes.mjs';
import { referenceBlastRadiusForUnits } from '../impact/blast-radius.mjs';
import { indexProject, scipTypeScriptIndexer } from '../indexing/scip-launcher.mjs';
import { resolveTypeScriptProjectShards } from '../indexing/typescript-project-shards.mjs';
import { extractFileUnits, sourceFiles } from '../repository/inventory.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

async function existingConfigs(cwd, names) {
  const out = [];
  for (const name of names) {
    try {
      await stat(path.join(cwd, name));
      out.push(name);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return out;
}

function canonicalLocation(loc) {
  return {
    path: loc.path,
    range: loc.range ?? null,
    enclosingRange: loc.enclosingRange ?? null,
    roles: loc.roles,
    isTest: Boolean(loc.isTest),
    isRead: Boolean(loc.isRead),
    isWrite: Boolean(loc.isWrite),
    isImport: Boolean(loc.isImport),
  };
}

function canonicalGraph(graph) {
  return graph.nodes.map((node) => ({
    symbol: node.symbol,
    displayName: node.displayName,
    kind: node.kind,
    definitions: [...node.definitions]
      .map(canonicalLocation)
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    references: [...node.references]
      .map(canonicalLocation)
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    relationships: [...node.relationships]
      .map((rel) => ({
        symbol: rel.symbol,
        isReference: Boolean(rel.isReference),
        isImplementation: Boolean(rel.isImplementation),
        isTypeDefinition: Boolean(rel.isTypeDefinition),
        isDefinition: Boolean(rel.isDefinition),
      }))
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
  })).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function graphDigest(graph) {
  return sha256(stableJson(canonicalGraph(graph)));
}

function canonicalImpact(result) {
  return {
    mappingSymbols: [...result.mapping.symbols].sort(),
    unmatched: [...result.mapping.unmatched].sort(),
    expandedSymbols: [...result.report.expandedSymbols].sort(),
    referenceSiteCount: result.report.referenceSiteCount,
    impactedPaths: [...result.report.impactedPaths].sort(),
    testReferencePaths: [...result.report.testReferencePaths].sort(),
  };
}

async function deterministicSampleUnits(cwd, shards, {
  perShard = 10,
} = {}) {
  const out = [];

  for (const shard of shards) {
    const shardUnits = [];
    for (const file of shard.sourceFiles) {
      const units = await extractFileUnits(cwd, file);
      shardUnits.push(...units);
    }
    shardUnits.sort((a, b) => a.id.localeCompare(b.id));
    out.push(...shardUnits.slice(0, perShard));
  }

  const seen = new Set();
  return out.filter((unit) => {
    if (seen.has(unit.id)) return false;
    seen.add(unit.id);
    return true;
  });
}

export async function runGraphEquivalence({
  cwd = process.cwd(),
  scipExecutable = 'scip',
  scipTypeScriptVersion = '0.4.0',
} = {}) {
  const repoRoot = path.resolve(cwd);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-graph-equivalence-'));

  try {
    const allSources = (await sourceFiles(repoRoot))
      .filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file));

    const fullConfigs = await existingConfigs(repoRoot, [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.app.json',
      'tsconfig.worker.json',
      'tsconfig.node.json',
    ]);

    const full = await indexProject({
      cwd: repoRoot,
      projectRoot: '.',
      sourceFiles: allSources,
      configFiles: fullConfigs,
      dependencySurfaces: {},
      indexer: scipTypeScriptIndexer({
        version: scipTypeScriptVersion,
        command: 'scip-typescript',
      }),
      cache: new ArtifactCache(path.join(temp, 'full-artifacts')),
    });

    const fullRaw = await readScipJson({
      indexFile: full.indexFile,
      cwd: repoRoot,
      executable: scipExecutable,
    });

    const shards = await resolveTypeScriptProjectShards({ cwd: repoRoot });
    const shardRaws = [];

    for (const shard of shards) {
      const indexed = await indexProject({
        cwd: repoRoot,
        projectRoot: shard.projectRoot,
        sourceFiles: shard.sourceFiles,
        configFiles: shard.configFiles,
        dependencySurfaces: {},
        indexer: scipTypeScriptIndexer({
          version: scipTypeScriptVersion,
          command: 'scip-typescript',
          flags: shard.flags,
        }),
        cache: new ArtifactCache(path.join(temp, 'shard-artifacts')),
      });

      shardRaws.push(await readScipJson({
        indexFile: indexed.indexFile,
        cwd: repoRoot,
        executable: scipExecutable,
      }));
    }

    const merged = mergeScipIndexes(shardRaws);
    const documents = compareScipDocumentEvidence(fullRaw, merged.index);

    const fullGraph = buildSymbolGraph(fullRaw);
    const mergedGraph = buildSymbolGraph(merged.index);
    const fullGraphDigest = graphDigest(fullGraph);
    const mergedGraphDigest = graphDigest(mergedGraph);

    const sampleUnits = await deterministicSampleUnits(repoRoot, shards);
    const impactMismatches = [];

    for (const unit of sampleUnits) {
      const fullImpact = canonicalImpact(referenceBlastRadiusForUnits({
        graph: fullGraph,
        units: [unit],
        changedPaths: [unit.path],
      }));
      const mergedImpact = canonicalImpact(referenceBlastRadiusForUnits({
        graph: mergedGraph,
        units: [unit],
        changedPaths: [unit.path],
      }));

      if (stableJson(fullImpact) !== stableJson(mergedImpact)) {
        impactMismatches.push({
          unitId: unit.id,
          path: unit.path,
          full: fullImpact,
          merged: mergedImpact,
        });
      }
    }

    const pass = documents.exact
      && merged.conflicts.length === 0
      && fullGraphDigest === mergedGraphDigest
      && impactMismatches.length === 0;

    return {
      schemaVersion: 1,
      kind: 'h19-scip-graph-equivalence',
      generatedAt: new Date().toISOString(),
      repository: repoRoot,
      indexers: {
        scipTypescript: scipTypeScriptVersion,
        scipCli: scipExecutable,
      },
      inputs: {
        fullFingerprintSourceFiles: allSources.length,
        shardCount: shards.length,
        shardDeclaredSourceFiles: [...new Set(shards.flatMap((x) => x.sourceFiles))].length,
      },
      documents: {
        expected: documents.expectedDocuments,
        actual: documents.actualDocuments,
        missingCount: documents.missing.length,
        extraCount: documents.extra.length,
        mismatchedCount: documents.mismatched.length,
        missing: documents.missing.slice(0, 50),
        extra: documents.extra.slice(0, 50),
        mismatched: documents.mismatched.slice(0, 50),
      },
      merge: {
        duplicateDocumentCount: merged.duplicateDocuments.length,
        conflictCount: merged.conflicts.length,
        conflicts: merged.conflicts.slice(0, 50),
      },
      graph: {
        fullNodeCount: fullGraph.nodeCount,
        mergedNodeCount: mergedGraph.nodeCount,
        fullDigest: fullGraphDigest,
        mergedDigest: mergedGraphDigest,
        exact: fullGraphDigest === mergedGraphDigest,
      },
      blastRadiusSample: {
        unitCount: sampleUnits.length,
        mismatchCount: impactMismatches.length,
        mismatches: impactMismatches.slice(0, 25),
      },
      pass,
      boundaries: [
        'This gate compares the document/symbol/reference evidence currently consumed by H19.',
        'SCIP external_symbols are not currently consumed by the H19 symbol graph and are outside this gate.',
        'A PASS is required before project-sharded SCIP indexes can replace whole-repository indexing in production evidence.',
      ],
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
