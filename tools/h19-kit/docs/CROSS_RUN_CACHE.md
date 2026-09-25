# Cross-run H19 cache persistence

PERF-003 proved that TypeScript project sharding narrows invalidation, but its warm-cache measurements were taken
inside one CI runner.

A new GitHub Actions runner starts with no local `.h19` directory. Without an explicit restore/save layer, H19's
content-addressed cache cannot provide cross-run reuse.

## CI cache contract

GitHub Actions restores and saves:

```text
.h19/cache
.h19/artifacts
```

using a primary key scoped by:

- runner OS;
- H19 cache schema generation;
- pinned SCIP TypeScript version;
- TypeScript/package configuration hash;
- exact candidate head SHA.

A stable restore-key prefix omits the head SHA. This lets a new commit restore the most recent compatible H19 cache,
while the content-addressed artifact keys still determine whether each individual project shard is actually reusable.

## Safety

Restoring an older cache never makes a changed shard look valid. Project fingerprints include source/config content,
indexer identity/version and dependency surfaces. A stale restored entry simply does not match the new fingerprint.

## Measurement goal

The next two exact-head CI runs should distinguish:

1. **cold cross-run cache**: no compatible prior cache;
2. **restored cross-run cache**: compatible cache restored from the previous run.

The report must show restore status explicitly. Warm performance is not considered operationally proven until a
separate runner restores and reuses a cache created by an earlier run.


## Exact-head cross-run result

The seed run saved three TypeScript project-shard artifacts. A later rerun on a separate GitHub-hosted runner
restored the exact H19 cache key and reported:

- `restoredArtifactsBefore = 3`;
- `shardHits = 3`;
- `shardMisses = 0`.

This proves runner-to-runner persistence for an unchanged candidate head.

The next proof changes only this documentation, producing a new head SHA while leaving TypeScript project inputs
unchanged. The new run must restore via the compatible prefix and still report three shard hits.


## New-head prefix-restore result

A documentation-only head change produced a different candidate SHA while leaving all TypeScript project inputs and
cache compatibility inputs unchanged.

The next GitHub-hosted runner restored the previous head's H19 cache through the compatible restore prefix and
reported:

- `restoredArtifactsBefore = 3`;
- `shardHits = 3`;
- `shardMisses = 0`.

It then saved a new exact-head cache key. Cross-run reuse is therefore proven both for an exact-head rerun and for a
compatible new commit.

## Growth bound

Operational cache persistence must remain bounded. Before GitHub Actions saves the cache, H19 prunes SCIP project
artifacts using both:

- a per-logical-shard generation limit;
- a global byte budget.

Global pressure may remove older generations but never the last retained generation of a logical shard. If the newest
generation of every shard alone exceeds the byte budget, the report marks the excess as unavoidable instead of
silently deleting current evidence.
