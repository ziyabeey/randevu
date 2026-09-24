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
- cold project-index wall time;
- H19 warm project-shard cache-hit wall time;
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

Cold SCIP time and warm H19 cache-hit time answer different questions.

```text
cold index
  = type analysis + SCIP generation + H19 fingerprint/cache write

warm hit
  = H19 fingerprint validation + artifact lookup
```

A large warm speedup does not prove that cold indexing is cheap. Both values must be reported.
