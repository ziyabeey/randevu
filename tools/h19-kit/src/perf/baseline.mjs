import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { historySnapshot } from '../adapters/history-cache.mjs';
import { FileCache } from '../core/cache.mjs';
import { ArtifactCache } from '../core/artifact-cache.mjs';
import { repositoryInventory, sourceFiles } from '../repository/inventory.mjs';
import { scipTypeScriptIndexer, indexProject } from '../indexing/scip-launcher.mjs';
import { discoverTypeScriptProjectShards } from '../indexing/typescript-projects.mjs';
import { projectGraph } from '../impact/project-graph.mjs';
import { analyzeChangeImpact } from '../impact/change-impact.mjs';
import { discoverCoverageHypotheses } from '../discovery/coverage-discovery.mjs';

function round(value, digits = 3) {
  const n = 10 ** digits;
  return Math.round(value * n) / n;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function timed(fn) {
  const before = process.memoryUsage().rss;
  const started = performance.now();
  const value = await fn();
  const ended = performance.now();
  const after = process.memoryUsage().rss;
  return {
    value,
    wallMs: round(ended - started),
    rssDeltaBytes: after - before,
  };
}

async function repeat(fn, { warmup = 1, iterations = 5 } = {}) {
  for (let i = 0; i < warmup; i++) await fn();
  const rows = [];
  for (let i = 0; i < iterations; i++) rows.push(await timed(fn));
  const wall = rows.map((x) => x.wallMs);
  return {
    iterations,
    medianMs: round(percentile(wall, 50)),
    p95Ms: round(percentile(wall, 95)),
    minMs: round(Math.min(...wall)),
    maxMs: round(Math.max(...wall)),
    lastValue: rows.at(-1)?.value,
  };
}

function commandVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return null;
  if (result.status !== 0) {
    throw new Error(`${command} --version failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout || result.stderr).trim().split(/\r?\n/).find(Boolean) ?? 'unknown';
}

async function sourceStats(cwd, files) {
  let bytes = 0;
  let lines = 0;
  let tsJsFiles = 0;
  let tsJsLines = 0;
  const tsJs = [];

  for (const file of files) {
    const text = await readFile(path.join(cwd, file), 'utf8');
    const count = text.length === 0 ? 0 : text.split(/\r?\n/).length;
    bytes += Buffer.byteLength(text);
    lines += count;
    if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) {
      tsJsFiles += 1;
      tsJsLines += count;
      tsJs.push(file);
    }
  }

  return { files: files.length, bytes, lines, tsJsFiles, tsJsLines, tsJs };
}

function syntheticFixture({
  projects = 200,
  references = 5000,
} = {}) {
  const projectRows = [];
  const deps = [];
  for (let i = 0; i < projects; i++) {
    projectRows.push({ id: `p${i}`, root: `packages/p${i}` });
    if (i > 0) deps.push({ source: `p${i}`, target: `p${i - 1}` });
  }

  const target = 'typescript npm perf 1.0.0 packages/p0/src/target.ts/target().';
  const refs = [];
  const coverageByPath = {};
  for (let i = 0; i < references; i++) {
    const isTest = i % 2 === 0;
    const p = isTest
      ? `packages/p${i % projects}/tests/ref-${i}.test.ts`
      : `packages/p${i % projects}/src/ref-${i}.ts`;
    refs.push({
      path: p,
      range: { startLine: i % 200, endLine: i % 200 },
      enclosingRange: null,
      roles: 0,
      isTest,
      isRead: true,
      isWrite: false,
      isImport: false,
    });
    coverageByPath[p] = i % 3 !== 0;
  }

  return {
    projectGraph: projectGraph({ projects: projectRows, dependencies: deps }),
    changedFiles: ['packages/p0/src/target.ts'],
    semanticUnits: [{
      id: 'packages/p0/src/target.ts::target@1',
      path: 'packages/p0/src/target.ts',
      startLine: 1,
      endLine: 10,
    }],
    symbolGraph: {
      metadata: {},
      nodeCount: 1,
      nodes: [{
        symbol: target,
        displayName: 'target',
        kind: 17,
        definitions: [{
          path: 'packages/p0/src/target.ts',
          range: { startLine: 0, endLine: 0 },
          enclosingRange: { startLine: 0, endLine: 20 },
          roles: 1,
          isTest: false,
          isRead: false,
          isWrite: false,
          isImport: false,
        }],
        references: refs,
        relationships: [],
      }],
    },
    coverageByPath,
  };
}

export async function runPerformanceBaseline({
  cwd = process.cwd(),
  requireScip = false,
  historySince = '90 days ago',
  historyMaxCommits = 2000,
  syntheticProjects = 200,
  syntheticReferences = 5000,
} = {}) {
  const repoRoot = path.resolve(cwd);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-perf-'));

  try {
    const filesTimed = await timed(() => sourceFiles(repoRoot));
    const statsTimed = await timed(() => sourceStats(repoRoot, filesTimed.value));
    const tsProjectsTimed = await timed(() => discoverTypeScriptProjectShards({ cwd: repoRoot }));
    const scipIndexedStatsTimed = await timed(() => sourceStats(
      repoRoot,
      tsProjectsTimed.value.indexedFiles,
    ));
    const scipIndexedSet = new Set(tsProjectsTimed.value.indexedFiles);
    const scipUnindexedTsJs = statsTimed.value.tsJs.filter((file) => !scipIndexedSet.has(file));

    const inventoryFirst = await timed(() => repositoryInventory(repoRoot));
    const inventoryRepeat = await repeat(() => repositoryInventory(repoRoot), {
      warmup: 0,
      iterations: 3,
    });

    const historyCache = new FileCache(path.join(temp, 'history-cache'));
    const historyCold = await timed(() => historySnapshot({
      cwd: repoRoot,
      since: historySince,
      maxCommits: historyMaxCommits,
      cache: historyCache,
    }));
    const historyWarm = await timed(() => historySnapshot({
      cwd: repoRoot,
      since: historySince,
      maxCommits: historyMaxCommits,
      cache: historyCache,
    }));

    const fixture = syntheticFixture({
      projects: syntheticProjects,
      references: syntheticReferences,
    });

    const impactBench = await repeat(() => analyzeChangeImpact(fixture), {
      warmup: 1,
      iterations: 7,
    });
    const impact = analyzeChangeImpact(fixture);

    const mutants = Array.from({ length: 100 }, (_, i) => ({
      id: `mut-${i}`,
      path: `packages/p${i % syntheticProjects}/src/ref-${i}.ts`,
      unitId: `unit-${i}`,
      mutatorId: 'perf.synthetic',
    }));
    const discoveryBench = await repeat(() => discoverCoverageHypotheses({
      impact,
      survivingMutants: mutants,
      existingTests: impact.candidateTests,
    }), {
      warmup: 1,
      iterations: 7,
    });

    const scipVersion = commandVersion('scip-typescript');
    let scip = {
      status: 'not-measured',
      reason: 'scip-typescript command not available',
    };

    if (scipVersion) {
      const baseConfigCandidates = ['package.json', 'package-lock.json', 'tsconfig.json'];
      const baseConfigFiles = [];
      for (const config of baseConfigCandidates) {
        try {
          await stat(path.join(repoRoot, config));
          baseConfigFiles.push(config);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }

      const actualIndexedFiles = tsProjectsTimed.value.indexedFiles.length
        ? [...tsProjectsTimed.value.indexedFiles]
        : [...statsTimed.value.tsJs];
      const actualIndexedStats = await sourceStats(repoRoot, actualIndexedFiles);
      const allProjectConfigs = [...new Set([
        ...baseConfigFiles,
        ...tsProjectsTimed.value.shards.flatMap((shard) => shard.configFiles),
      ])].sort();

      const indexer = scipTypeScriptIndexer({
        version: scipVersion,
        command: 'scip-typescript',
      });
      const artifactCache = new ArtifactCache(path.join(temp, 'scip-artifacts'));
      const params = {
        cwd: repoRoot,
        projectRoot: '.',
        sourceFiles: actualIndexedFiles,
        configFiles: allProjectConfigs,
        dependencySurfaces: {},
        indexer,
        cache: artifactCache,
      };

      const cold = await timed(() => indexProject(params));
      if (cold.value.cache !== 'miss') throw new Error('SCIP first benchmark unexpectedly hit cache');
      const indexStat = await stat(cold.value.indexFile);
      const warm = await timed(() => indexProject(params));
      if (warm.value.cache !== 'hit') throw new Error('SCIP warm benchmark unexpectedly missed cache');

      const repeatMiss = await timed(() => indexProject({
        ...params,
        cache: new ArtifactCache(path.join(temp, 'scip-repeat-artifacts')),
      }));
      if (repeatMiss.value.cache !== 'miss') {
        throw new Error('SCIP repeat cache-miss benchmark unexpectedly hit cache');
      }

      const prepareMutationClone = async (name, target) => {
        const mutationRoot = path.join(temp, name);
        const clone = spawnSync('git', ['clone', '--shared', '--quiet', repoRoot, mutationRoot], {
          cwd: temp,
          encoding: 'utf8',
        });
        if (clone.status !== 0) {
          throw new Error(`local mutation clone failed: ${String(clone.stderr || clone.stdout).trim()}`);
        }
        try {
          await stat(path.join(repoRoot, 'node_modules'));
          await symlink(path.join(repoRoot, 'node_modules'), path.join(mutationRoot, 'node_modules'), 'dir');
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        await appendFile(
          path.join(mutationRoot, target),
          '\n// h19-performance-single-file-change\n',
        );
        return mutationRoot;
      };

      let singleFileChange = {
        status: 'not-measured',
        reason: 'no mutable indexed TypeScript/JavaScript source file found',
      };
      const mutationTarget = actualIndexedFiles.find((file) =>
        /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file) && !/\.d\.ts$/i.test(file));

      if (mutationTarget) {
        const mutationRoot = await prepareMutationClone('mutation-indexed-repo', mutationTarget);
        const mutationRun = await timed(() => indexProject({
          ...params,
          cwd: mutationRoot,
          cache: artifactCache,
        }));
        if (mutationRun.value.cache !== 'miss') {
          throw new Error('indexed single-file-change benchmark unexpectedly hit cache');
        }

        singleFileChange = {
          status: 'measured',
          path: mutationTarget,
          reindexMs: mutationRun.wallMs,
          vsExactWarmRatio: warm.wallMs > 0 ? round(mutationRun.wallMs / warm.wallMs, 2) : null,
          vsFirstIndexRatio: cold.wallMs > 0 ? round(mutationRun.wallMs / cold.wallMs, 3) : null,
        };
      }

      let unindexedFileChange = {
        status: 'not-measured',
        reason: 'no TypeScript/JavaScript file outside the SCIP project graph',
      };
      const unindexedTarget = scipUnindexedTsJs.find((file) =>
        /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file) && !/\.d\.ts$/i.test(file));
      if (unindexedTarget) {
        const mutationRoot = await prepareMutationClone('mutation-unindexed-repo', unindexedTarget);
        const run = await timed(() => indexProject({
          ...params,
          cwd: mutationRoot,
          cache: artifactCache,
        }));
        if (run.value.cache !== 'hit') {
          throw new Error('SCIP-unindexed file unexpectedly invalidated project cache');
        }
        unindexedFileChange = {
          status: 'measured',
          path: unindexedTarget,
          cache: run.value.cache,
          wallMs: run.wallMs,
        };
      }

      const shardCache = new ArtifactCache(path.join(temp, 'scip-shard-artifacts'));
      const shardRows = [];
      const shardParams = new Map();

      for (const shard of tsProjectsTimed.value.shards) {
        const stats = await sourceStats(repoRoot, shard.sourceFiles);
        const shardIndexer = scipTypeScriptIndexer({
          version: scipVersion,
          command: 'scip-typescript',
          projects: [shard.configPath],
        });
        const shardConfigFiles = [...new Set([
          ...baseConfigFiles,
          ...shard.configFiles,
        ])].sort();
        const shardParam = {
          cwd: repoRoot,
          projectRoot: '.',
          sourceFiles: [...shard.sourceFiles],
          configFiles: shardConfigFiles,
          dependencySurfaces: {},
          indexer: shardIndexer,
          cache: shardCache,
        };
        shardParams.set(shard.id, shardParam);

        const shardCold = await timed(() => indexProject(shardParam));
        if (shardCold.value.cache !== 'miss') {
          throw new Error(`SCIP shard cold benchmark unexpectedly hit cache: ${shard.id}`);
        }
        const shardStat = await stat(shardCold.value.indexFile);
        const shardWarm = await timed(() => indexProject(shardParam));
        if (shardWarm.value.cache !== 'hit') {
          throw new Error(`SCIP shard warm benchmark unexpectedly missed cache: ${shard.id}`);
        }

        shardRows.push({
          id: shard.id,
          configPath: shard.configPath,
          sourceFiles: stats.files,
          sourceLines: stats.lines,
          coldMs: shardCold.wallMs,
          warmHitMs: shardWarm.wallMs,
          indexBytes: shardStat.size,
          files: [...shard.sourceFiles],
        });
      }

      const shardColdTotalMs = round(shardRows.reduce((sum, row) => sum + row.coldMs, 0));
      const shardWarmTotalMs = round(shardRows.reduce((sum, row) => sum + row.warmHitMs, 0));
      const largestShard = [...shardRows].sort(
        (a, b) => b.sourceLines - a.sourceLines || a.id.localeCompare(b.id),
      )[0] ?? null;

      let shardedSingleFileChange = {
        status: 'not-measured',
        reason: 'no TypeScript project shard available',
      };
      if (largestShard) {
        const target = largestShard.files.find((file) =>
          /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file) && !/\.d\.ts$/i.test(file));
        if (target) {
          const mutationRoot = await prepareMutationClone('mutation-sharded-repo', target);
          const perShard = [];
          const started = performance.now();
          for (const shard of tsProjectsTimed.value.shards) {
            const original = shardParams.get(shard.id);
            const run = await timed(() => indexProject({
              ...original,
              cwd: mutationRoot,
            }));
            perShard.push({
              id: shard.id,
              cache: run.value.cache,
              wallMs: run.wallMs,
            });
          }
          const totalMs = round(performance.now() - started);
          const misses = perShard.filter((row) => row.cache === 'miss').length;
          const hits = perShard.filter((row) => row.cache === 'hit').length;
          shardedSingleFileChange = {
            status: 'measured',
            path: target,
            owningShard: largestShard.id,
            totalMs,
            misses,
            hits,
            perShard,
            vsMonolithicChangedFileSpeedup: singleFileChange.status === 'measured' && totalMs > 0
              ? round(singleFileChange.reindexMs / totalMs, 2)
              : null,
          };
        }
      }

      scip = {
        status: 'measured',
        version: scipVersion,
        repositoryTsJsFiles: statsTimed.value.tsJsFiles,
        repositoryTsJsLines: statsTimed.value.tsJsLines,
        sourceFiles: actualIndexedStats.files,
        sourceLines: actualIndexedStats.lines,
        unindexedTsJsFiles: scipUnindexedTsJs.length,
        firstIndexMs: cold.wallMs,
        repeatH19CacheMissMs: repeatMiss.wallMs,
        exactContentWarmHitMs: warm.wallMs,
        exactContentWarmSpeedup: warm.wallMs > 0 ? round(cold.wallMs / warm.wallMs, 2) : null,
        indexBytes: indexStat.size,
        firstIndexLinesPerSecond: cold.wallMs > 0
          ? round(actualIndexedStats.lines / (cold.wallMs / 1000), 1)
          : null,
        singleFileChange,
        unindexedFileChange,
        projectShards: {
          count: shardRows.length,
          coldTotalMs: shardColdTotalMs,
          warmHitTotalMs: shardWarmTotalMs,
          coldVsMonolithicRatio: cold.wallMs > 0 ? round(shardColdTotalMs / cold.wallMs, 3) : null,
          rows: shardRows.map(({ files, ...row }) => row),
          singleFileChange: shardedSingleFileChange,
        },
      };
    } else if (requireScip) {
      throw new Error('scip-typescript is required for this baseline but is not installed');
    }

    const inventoryUnits = inventoryFirst.value.units.length;
    const inventoryMs = inventoryFirst.wallMs;

    return {
      schemaVersion: 3,
      kind: 'h19-performance-baseline',
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? null,
        totalMemoryBytes: os.totalmem(),
      },
      repository: {
        root: repoRoot,
        sourceFiles: statsTimed.value.files,
        sourceBytes: statsTimed.value.bytes,
        sourceLines: statsTimed.value.lines,
        tsJsFiles: statsTimed.value.tsJsFiles,
        tsJsLines: statsTimed.value.tsJsLines,
        scipProjectShards: tsProjectsTimed.value.shards.length,
        scipIndexedFiles: scipIndexedStatsTimed.value.files,
        scipIndexedLines: scipIndexedStatsTimed.value.lines,
        scipUnindexedTsJsFiles: scipUnindexedTsJs.length,
      },
      measurements: {
        discovery: {
          sourceWalkMs: filesTimed.wallMs,
          sourceStatsMs: statsTimed.wallMs,
          typescriptProjectDiscoveryMs: tsProjectsTimed.wallMs,
          scipIndexedStatsMs: scipIndexedStatsTimed.wallMs,
        },
        inventory: {
          filesScanned: inventoryFirst.value.filesScanned,
          units: inventoryUnits,
          errors: inventoryFirst.value.errors.length,
          firstMs: inventoryMs,
          repeatMedianMs: inventoryRepeat.medianMs,
          repeatP95Ms: inventoryRepeat.p95Ms,
          filesPerSecond: inventoryMs > 0
            ? round(inventoryFirst.value.filesScanned / (inventoryMs / 1000), 1)
            : null,
          unitsPerSecond: inventoryMs > 0
            ? round(inventoryUnits / (inventoryMs / 1000), 1)
            : null,
        },
        history: {
          coldMs: historyCold.wallMs,
          warmHitMs: historyWarm.wallMs,
          coldCache: historyCold.value.cache,
          warmCache: historyWarm.value.cache,
          warmSpeedup: historyWarm.wallMs > 0
            ? round(historyCold.wallMs / historyWarm.wallMs, 2)
            : null,
          couplings: historyCold.value.couplings.length,
          hotspots: historyCold.value.hotspots.length,
        },
        syntheticScale: {
          projects: syntheticProjects,
          references: syntheticReferences,
          impactMedianMs: impactBench.medianMs,
          impactP95Ms: impactBench.p95Ms,
          impactedPaths: impact.symbolImpact.report.impactedPathCount,
          candidateTests: impact.candidateTests.length,
          discoveryMedianMs: discoveryBench.medianMs,
          discoveryP95Ms: discoveryBench.p95Ms,
          hypotheses: discoveryBench.lastValue?.hypotheses?.length ?? null,
        },
        scipTypescript: scip,
      },
      interpretation: {
        thresholdsFrozen: false,
        note: 'This is a measurement baseline, not a pass/fail performance gate. Freeze regression thresholds only after baseline evidence exists.',
      },
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
