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
