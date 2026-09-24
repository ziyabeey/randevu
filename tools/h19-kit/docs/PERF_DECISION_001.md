# PERF-DECISION-001

## Status

Frozen after PERF-001 and PERF-002 on the H19 Kit M0→M5 line.

## Evidence

On GitHub-hosted Ubuntu, Node 24, 4 vCPU AMD EPYC:

- semantic inventory first run: 1067 ms;
- semantic inventory repeat median: 698 ms;
- Git history: 307 ms cold, 8.96 ms warm;
- M4 synthetic 5,000-reference impact: 8.83 ms median;
- M5 discovery: 4.82 ms median;
- SCIP TypeScript first index: 9303 ms;
- fresh H19 cache miss on unchanged source: 8990 ms;
- exact-content H19 cache hit: 28.1 ms;
- one source-file change reindex: 8950 ms.

The changed file in the single-file test was `scripts/browser-booking-recovery.mjs`.

## Decision

The current root-level SCIP cache invalidation strategy is not acceptable as the basis for the next feature milestone.

A source-changing push can pay almost the full first-index cost. The current project fingerprint includes 329 TS/JS files, while the repository's explicit product TypeScript projects are naturally separated by:

- `tsconfig.app.json` → `src/`;
- `tsconfig.worker.json` → `worker/`;
- `tsconfig.node.json` → `vite.config.ts`.

Repository tree inspection at PERF-002 time showed:

- app: 41 TS/JS files, 527,383 bytes;
- worker: 35 TS/JS files, 411,339 bytes;
- node: 1 file, 453 bytes;
- other scripts/tests/tools: 252 TS/JS files, 1,964,391 bytes.

The root fingerprint therefore tracks a large amount of source that is outside those explicit product TypeScript projects.

## Next required remediation

Before Minimal Test Specification work:

1. derive the actual file set owned by each TypeScript project;
2. fingerprint indexer inputs per project rather than every TS/JS file in the repository;
3. preserve project-reference/dependency invalidation explicitly;
4. ensure an unrelated `scripts/` change does not invalidate app/worker SCIP shards;
5. benchmark:
   - app-only source change;
   - worker-only source change;
   - unrelated scripts/tool change;
   - exact-content hit;
6. freeze regression thresholds only after the repaired measurements exist.

## Non-claim

PERF-002 is one repository on one CI machine class. It establishes a real local bottleneck, not a general performance claim for all repositories.
