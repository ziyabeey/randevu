# H19 Kit performance baseline

H19 Kit had correctness/CI evidence before it had a reproducible performance baseline. This gate closes that gap
before the next bundle feature is promoted.

## What is measured

### Real repository

- source discovery wall time;
- source bytes and line count;
- semantic-unit inventory first-run and repeat time;
- inventory throughput;
- Git history/coupling cold-cache time;
- Git history warm-cache hit time and speedup.

### SCIP TypeScript

When `scip-typescript` is installed:

- exact runtime version;
- first project-index wall time;
- fresh H19 cache-miss repeat wall time;
- single-source-file-change reindex wall time;
- exact-content H19 project-shard cache-hit wall time;
- index artifact bytes;
- TypeScript/JavaScript source lines;
- observed source lines indexed per second.

If the command is absent, the result is **not-measured**. Missing external-indexer evidence is never represented as
zero cost.

The CI baseline branch explicitly installs a pinned `@sourcegraph/scip-typescript` so the first repository
baseline includes real indexing.

### Synthetic scale probe

A deterministic scale fixture measures the H19-owned in-process layers independently from external indexer cost:

- 200-project reverse-dependency graph;
- 5,000 SCIP-like reference sites;
- M4 change-impact orchestration;
- M5 coverage-discovery hypothesis generation.

This is a regression probe, not a substitute for real-repository indexing measurements.

## Why there is no threshold yet

The first run establishes evidence. It does not invent a pass/fail threshold before seeing a baseline.

After the first CI artifact is captured, freeze:

- the reference environment;
- the baseline report SHA;
- acceptable relative regression bands;
- any absolute user-facing latency budget that is justified by product requirements.

Only then should performance become a gating check.

## Important interpretation

First-index, repeat cache-miss, single-file-change, and exact-content warm-hit times answer different questions.

```text
first index
  = initial type analysis + SCIP generation + H19 fingerprint/cache write

repeat H19 cache miss
  = indexer runs again with a fresh H19 artifact cache; indexer-internal caches may still exist

single-file change
  = real source-content invalidation followed by reindex

exact-content warm hit
  = H19 fingerprint validation + artifact lookup
```

A large warm speedup does not prove that cold indexing is cheap. Both values must be reported.


## PERF-001 — first real repository result

Reference environment: GitHub hosted Linux runner, 4 vCPU, Node 24, pinned `scip-typescript 0.4.0`.

Observed repository scale:

- 530 source files;
- 131,019 source lines;
- 6,415 semantic units;
- 329 TS/JS files, 66,711 TS/JS lines.

Observed latency:

| Layer | PERF-001 |
| --- | ---: |
| semantic inventory first run | 1,067 ms |
| semantic inventory repeat median | 698 ms |
| Git history cold | 307 ms |
| Git history warm cache hit | 9 ms |
| M4 impact p95 @ 200 projects / 5,000 refs | 13.3 ms |
| M5 discovery p95 | 6.8 ms |
| SCIP first index | 9,303 ms |
| SCIP exact-content H19 cache hit | 28 ms |
| single-file-triggered full re-index | 8,950 ms |

The dominant latency is external TypeScript/SCIP indexing, not M4/M5 orchestration.

PERF-001 also exposed an invalidation bug in the benchmark/cache input contract: the selected mutation target was
`scripts/browser-booking-recovery.mjs`, while the root TypeScript project graph references only
`tsconfig.app.json`, `tsconfig.worker.json`, and `tsconfig.node.json`. The cache fingerprint had been
including repository-wide TS/JS files instead of only the files actually indexed by the TypeScript project graph.

## PERF-002 hypothesis

The next measurement must test two separate improvements without changing the external indexer version:

1. **Exact input fingerprinting**
   - derive indexed files from the TypeScript config graph;
   - a TS/JS file outside that graph must not invalidate the SCIP cache.

2. **Project sharding**
   - cache `tsconfig.app.json`, `tsconfig.worker.json`, and `tsconfig.node.json` separately;
   - an indexed-file change should re-index only the owning shard while unchanged shards remain hits.

PERF-002 must continue reporting monolithic cold/warm values so the sharded result can be compared against the
same runner and same pinned indexer. No performance pass/fail threshold is introduced until PERF-002 exists.


## PERF-002 — exact inputs + tsconfig shards

PERF-002 ran on the same runner class and pinned `scip-typescript 0.4.0`.

Key observations:

| Metric | PERF-001 | PERF-002 |
| --- | ---: | ---: |
| exact-content cache hit | 28.1 ms | 5.9 ms |
| unrelated TS/JS file change | ~8,950 ms re-index | 6.7 ms cache hit |
| indexed app file, monolithic re-index | n/a cleanly measured | 8,459 ms |
| indexed app file, sharded re-index | n/a | 5,580 ms |
| sharded vs monolithic changed-file speedup | n/a | 1.52x |
| monolithic cold index | 9,303 ms | 8,997 ms |
| sharded cold total | n/a | 9,701 ms |
| shard cold overhead vs monolithic | n/a | +7.8% |
| app shard cold | n/a | 5,577 ms |
| worker shard cold | n/a | 2,916 ms |
| node shard cold | n/a | 1,208 ms |

The TypeScript project graph contains 77 indexed files / 21,124 lines out of 331 repository TS/JS files /
67,086 lines. 254 TS/JS files are outside the SCIP TypeScript project graph.

### Conclusions

1. **False invalidation was real and is fixed.**
   A change to `scripts/browser-booking-recovery.mjs` now remains an H19 cache hit instead of paying a full
   SCIP re-index.

2. **Project sharding helps real indexed changes.**
   The measured app-file mutation fell from 8.46s monolithic re-indexing to 5.58s with app/worker/node shard
   reuse, while the other two shards remained cache hits.

3. **Sharding is not free on cold start.**
   Three separate SCIP processes cost about 7.8% more total cold time than one monolithic root-index invocation.

4. **The remaining bottleneck is the changed shard itself.**
   M4/M5 stay in low-millisecond territory; the app shard still needs roughly 5.6s to rebuild after an app
   source change.

### Next measurement rule

Do not split the app shard heuristically just to improve one number.

Before another granularity change:

- repeat PERF-002 on the same head to estimate runner noise;
- freeze relative regression bands only after repeat evidence;
- prefer compiler/indexer-provided incremental state or durable local/cloud state over manually patching SCIP
  symbol graphs.
