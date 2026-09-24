# Cross-run persistent SCIP shard cache experiment

PERF-003 showed that tsconfig-scoped invalidation is correct and useful, but the benchmark cache lived only inside
one workflow run.

A ~6.7 ms exact warm-hit is operationally irrelevant if the next CI job starts with an empty H19 artifact cache.

## Question

Can GitHub Actions restore the content-addressed H19 SCIP shard cache from a prior workflow run so unchanged
TypeScript projects remain cache hits across commits?

## Experiment

The performance branch restores/saves:

```text
.h19/perf-shard-artifacts
```

with an Actions cache family keyed by:

- runner OS;
- pinned SCIP version;
- unique head SHA.

A broad restore prefix allows the next head to recover the latest compatible cache family. H19's own content
fingerprints still decide whether each individual shard artifact is valid.

This distinction matters:

```text
Actions cache
  = transports old content-addressed artifacts into the new runner

H19 fingerprint
  = decides which transported artifacts are actually reusable
```

Actions cache restoration never overrides H19 fingerprint correctness.

## Two-run acceptance

Run A seeds the cache.

Run B must be a commit that changes no TypeScript project inputs. On Run B:

- all three shards must report `cache: hit`;
- H19 must invoke no SCIP indexer for those shards;
- total shard probe latency should be reported;
- exact fingerprints must match Run A.

Only after this succeeds should cross-run caching be considered real rather than theoretical.
