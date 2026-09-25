# SCIP graph-equivalence gate

PERF-003 showed that TypeScript project-scoped invalidation reduces a real app-source reindex from 5.66 s to
3.87 s on the measured runner while preserving warm hits for unchanged shards.

That performance result is not enough to adopt sharding.

## Required correctness question

Does the union of project-scoped SCIP indexes preserve the evidence H19 currently obtains from one whole-repository
SCIP index?

The gate compares:

- normalized repository documents;
- occurrences and occurrence roles/ranges;
- document symbol definitions;
- symbol relationships used by H19;
- the resulting H19 symbol graph digest;
- deterministic representative semantic-unit → blast-radius outputs.

## Fail-closed rules

Production sharding remains HOLD if any of these are non-zero:

- documents present in the whole index but missing from shard union;
- unexpected extra shard documents;
- mismatched document evidence;
- conflicting duplicate documents between shards;
- graph digest difference;
- representative blast-radius mismatch.

This is intentionally stricter than a performance benchmark.

## Scope

The current H19 graph does not consume SCIP `external_symbols`; therefore this gate covers the exact document,
symbol, relationship and occurrence evidence that H19 currently consumes.

If H19 later starts consuming additional SCIP fields, this gate must expand before that evidence is trusted under
sharding.

## Decoder provenance

Both whole and shard indexes are decoded using the same pinned SCIP CLI build. The decoder version/commit is
part of the CI experiment provenance.

## GRAPH-EQ-001 result

Reference run: GitHub Actions #2915 on head `96f983073b42c42f18822fa426fb722d879dc39c`.

Observed:

- H19 whole-root fingerprint inputs: **337 files**;
- actual whole SCIP documents: **77**;
- declared project-shard source files: **77**;
- merged shard documents: **77**;
- missing / extra / mismatched documents: **0 / 0 / 0**;
- duplicate conflicts: **0**;
- whole symbol graph nodes: **9,686**;
- merged symbol graph nodes: **9,686**;
- graph digest: **identical**;
- representative blast-radius units: **20**;
- blast-radius mismatches: **0**.

Result: **PASS for the current H19 document/symbol/reference evidence contract.**

The measurement also confirms that the previous whole-repository H19 fingerprint was materially broader than the
actual scip-typescript project input set. Project-scoped fingerprints can therefore remove false invalidations
without changing the evidence currently consumed by H19.

Production adoption may proceed only with the same fail-closed project-boundary rules and an integration test that
keeps this equivalence invariant alive.
