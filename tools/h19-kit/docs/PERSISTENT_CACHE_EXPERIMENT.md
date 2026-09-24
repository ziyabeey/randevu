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

Run B must be a new commit that changes no declared TypeScript project inputs. It may update performance evidence or CI plumbing, but must leave every shard source/config fingerprint input unchanged. On Run B:

- all three shards must report `cache: hit`;
- H19 must invoke no SCIP indexer for those shards;
- total shard probe latency should be reported;
- exact fingerprints must match Run A.

Only after this succeeds should cross-run caching be considered real rather than theoretical.

## Pass/fail rule

The experiment is successful only if the second workflow run, triggered by a commit that leaves every declared
TypeScript project input unchanged, reports:

- shard count = 3;
- hits = 3;
- misses = 0;
- every row has `cache: hit`;
- no shard fingerprint differs from Run A.

A successful Actions cache restore without H19 shard hits is a failure.
A partial hit (1/3 or 2/3) is also a failure for this docs-only continuation.

No performance regression threshold is frozen yet; this gate establishes whether cross-run reuse is operationally
real.

## Result — PASS

Observed evidence:

| Phase | Hits | Misses | Total |
| --- | ---: | ---: | ---: |
| PERF-004-A seed | 0 | 3 | 8005.429 ms |
| PERF-004-B next workflow | 3 | 0 | 9.18 ms |

All three shard fingerprints were byte-identical between Run A and Run B.

Observed cross-run reuse speedup:

```text
8005.429 / 9.18 ≈ 872×
```

This number describes the measured seed-vs-reuse probe on the reference runner. It is not a universal product
speed claim.

Actions cache transported the old artifacts; H19's content fingerprints independently accepted all three as
valid. The cross-run reuse mechanism is therefore operationally real.
