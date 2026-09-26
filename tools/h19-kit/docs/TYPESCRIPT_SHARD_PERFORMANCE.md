# TypeScript project-shard performance experiment

PERF-002 established that H19's exact-content cache is cheap, but its cache invalidation input set is too broad.

Observed on the reference GitHub runner:

- first whole-repository SCIP index: ~9.30 s;
- exact-content warm H19 cache hit: ~28 ms;
- one changed `scripts/*.mjs` file: ~8.95 s reindex.

The mutated script is not declared by the repository's referenced TypeScript projects. That means H19 currently
invalidates SCIP for content the TypeScript project graph does not claim as an input.

## Experiment

Resolve the repository's root TypeScript project references:

- `tsconfig.app.json`;
- `tsconfig.worker.json`;
- `tsconfig.node.json`.

Each referenced project becomes an independent content-addressed SCIP shard.

A shard fingerprint includes:

- only source files declared by that TypeScript project;
- root and leaf tsconfig files;
- package metadata / lockfile;
- exact SCIP indexer identity and flags.

The benchmark verifies:

1. cold index of every shard;
2. exact-content warm hit of every shard;
3. the same real source-file mutation is measured once through full-root indexing and once through owning-shard indexing;
4. that mutation invalidates only its owning shard;
5. all unaffected shards remain cache hits;
6. a `scripts/*.mjs` change outside every declared TypeScript project invalidates zero shards.

## Boundary

This experiment optimizes cache invalidation and index generation. It does not yet switch the production blast-radius
pipeline to a multi-index graph. Graph composition must be proven separately before sharded indexes become
production evidence.

## PERF-003 result

Reference run: GitHub Actions #2897 on head `d5a580c476c145dd089c47e40a3c5666afdffb2b`.

Observed on the same runner:

| Measurement | Whole-root | Project shards |
| --- | ---: | ---: |
| Cold index | 5.79 s | 6.60 s sequential |
| Exact-content warm lookup | 18.6 ms | 6.7 ms total |
| One app-source change | 5.66 s | 3.87 s |
| App-source change reduction | — | 31.5% |
| Out-of-project `scripts/*.mjs` change | full invalidation | 0 shards |

The result supports project-scoped invalidation as an incremental optimization, not as an automatic cold-start optimization.

The next required gate is **semantic graph-composition equivalence**. Production blast-radius analysis must not
consume sharded indexes until their merged symbol/reference evidence is shown to preserve the relevant whole-index
semantics or any differences are explicitly bounded and fail-closed.
