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
      const artifactCache = new ArtifactCache(path.join(temp, 'scip-artifacts'));
      const configs = ['package.json','tsconfig.json','tsconfig.app.json','tsconfig.worker.json','tsconfig.node.json'];
      const availableConfigs = [];
      for (const config of configs) {
        try {
          await stat(path.join(repoRoot, config));
          availableConfigs.push(config);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }

      const indexer = scipTypeScriptIndexer({
        version: scipVersion,
        command: 'scip-typescript',
      });

      const params = {
        cwd: repoRoot,
        projectRoot: '.',
        sourceFiles: statsTimed.value.tsJs,
        configFiles: availableConfigs,
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

      let singleFileChange = {
        status: 'not-measured',
        reason: 'no mutable TypeScript/JavaScript source file found',
      };
      const mutationTarget = statsTimed.value.tsJs.find((file) =>
        /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file) && !/\.d\.ts$/i.test(file));

      if (mutationTarget) {
        const mutationRoot = path.join(temp, 'mutation-repo');
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
          path.join(mutationRoot, mutationTarget),
          '\n// h19-performance-single-file-change\n',
        );

        const mutationRun = await timed(() => indexProject({
          cwd: mutationRoot,
          projectRoot: '.',
          sourceFiles: statsTimed.value.tsJs,
          configFiles: availableConfigs,
          dependencySurfaces: {},
          indexer,
          cache: new ArtifactCache(path.join(temp, 'scip-mutation-artifacts')),
        }));
        if (mutationRun.value.cache !== 'miss') {
          throw new Error('single-file-change benchmark unexpectedly hit cache');
        }

        singleFileChange = {
          status: 'measured',
          path: mutationTarget,
          reindexMs: mutationRun.wallMs,
          vsExactWarmRatio: warm.wallMs > 0 ? round(mutationRun.wallMs / warm.wallMs, 2) : null,
          vsFirstIndexRatio: cold.wallMs > 0 ? round(mutationRun.wallMs / cold.wallMs, 3) : null,
        };
      }

      scip = {
        status: 'measured',
        version: scipVersion,
        sourceFiles: statsTimed.value.tsJsFiles,
        sourceLines: statsTimed.value.tsJsLines,
        firstIndexMs: cold.wallMs,
        repeatH19CacheMissMs: repeatMiss.wallMs,
        exactContentWarmHitMs: warm.wallMs,
        exactContentWarmSpeedup: warm.wallMs > 0 ? round(cold.wallMs / warm.wallMs, 2) : null,
        indexBytes: indexStat.size,
        firstIndexLinesPerSecond: cold.wallMs > 0
          ? round(statsTimed.value.tsJsLines / (cold.wallMs / 1000), 1)
          : null,
        singleFileChange,
      };
    } else if (requireScip) {
      throw new Error('scip-typescript is required for this baseline but is not installed');
    }

    const inventoryUnits = inventoryFirst.value.units.length;
    const inventoryMs = inventoryFirst.wallMs;

    return {
      schemaVersion: 2,
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
      },
      measurements: {
        discovery: {
          sourceWalkMs: filesTimed.wallMs,
          sourceStatsMs: statsTimed.wallMs,
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
