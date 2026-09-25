# Cache-first SCIP shard execution

PERF-004 proved that TypeScript SCIP shard artifacts survive across workflow runs:

- cold seed: 0/3 hits, 8005.429 ms;
- next workflow: 3/3 hits, 9.18 ms local H19 lookup;
- Actions cache transport on the measured run was roughly 0.57 s.

The warm workflow still installed `scip-typescript@0.4.0` before discovering that no indexing work was needed.
That install took roughly 0.94 s on the reference runner.

## Goal

Move cache planning before indexer installation.

```text
restore transported artifacts
          ↓
resolve tsconfig shards
          ↓
compute exact fingerprints
          ↓
cache plan
  ├─ 0 misses → skip binary install and indexing
  └─ N misses → install pinned indexer and materialize only N shards
          ↓
re-plan
          ↓
require 0 remaining misses
```

## Authority

The planner must not execute or probe the SCIP binary.

A plan is derived from:

- exact configured SCIP version;
- shard indexer flags;
- TypeScript project source files;
- config/package/lock inputs;
- dependency-surface inputs;
- H19 content-addressed artifact presence.

The configured indexer version is part of the fingerprint. `auto` or unknown versions fail closed.

## Acceptance

### Cold seed

With an empty transported artifact cache:

- planner reports all required shards as misses;
- pinned SCIP install runs;
- only planned misses are indexed;
- post-plan reports zero misses.

### Warm rerun

On the exact same source/config inputs with a restored cache:

- initial planner reports 3/3 hits;
- pinned SCIP installation is skipped;
- materialization step is skipped;
- post-plan remains 3/3 hits;
- exact fingerprints remain unchanged.

## Non-claims

This optimization reduces unnecessary indexer setup/execution on warm CI paths.

It does not:

- make cold indexing faster;
- prove multi-index graph composition;
- change H19 routing semantics;
- establish a universal latency percentage.

Production blast-radius use of multiple SCIP indexes still requires a separate graph-composition correctness gate.


## Warm acceptance continuation

The commit that adds this section intentionally changes documentation only. It does not change any TypeScript
project source, tsconfig, package metadata, lockfile, indexer version or shard flags.

The following CI run is therefore the cache-first warm acceptance run. It must begin from restored artifacts,
plan all declared TypeScript shards as hits, and skip both pinned SCIP installation and shard materialization.
