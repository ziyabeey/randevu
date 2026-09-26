# TypeScript project-shard adoption

Project-scoped SCIP indexing becomes the default H19 TypeScript evidence-graph strategy only after:

- PERF-003 measured incremental improvement;
- GRAPH-EQ-001 proved exact equivalence for the current H19 evidence contract.

## Runtime contract

`buildTypeScriptEvidenceGraph()`:

1. resolves the repository's TypeScript project references;
2. fingerprints and indexes each project independently;
3. reuses unchanged binary SCIP shard artifacts;
4. builds a merged H19 graph from the shard indexes;
5. caches the merged graph by the ordered shard-index digests and decoder identity;
6. returns explicit cache and provenance information.

## Fail-closed behavior

- shard merge conflicts throw;
- indexer failures throw;
- decoder identity is mandatory for graph-cache provenance;
- project-resolution failure may use the whole-index path only when `allowWholeFallback=true`;
- fallback mode is explicit as `whole-fallback` and carries the reason.

The whole-index implementation remains available as a safety fallback.

## Expected cache behavior

```text
first run:
  N shard index misses
  merged graph miss

same content:
  N shard index hits
  merged graph hit

one declared project source changed:
  1 shard miss
  N-1 shard hits
  merged graph miss

out-of-project script changed:
  N shard hits
  merged graph hit
```

The branch-specific real-repository adoption benchmark must prove these invariants before the adoption PR can be
treated as complete.
