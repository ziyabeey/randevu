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
