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

## Accepted production-adoption evidence

PR #581 completed the production adoption on exact head:

`13fbc34baf5808ba9aef5c5b2d5314f2a8e8f6bf`

Authoritative CI run:

`36090897239`

The branch-specific `h19-project-shard-adoption` artifact reported:

| Scenario | Wall time | Index cache | Graph cache | Result |
|---|---:|---|---|---|
| Cold repository graph | 12.514 s | 0 hit / 3 miss | miss | expected |
| Exact-content warm | 112.209 ms | 3 hit / 0 miss | hit | expected |
| `src/App.tsx` changed | 8.569 s | 2 hit / 1 miss | miss | expected |
| Out-of-project script changed | 113.383 ms | 3 hit / 0 miss | hit | expected |

The out-of-project mutation preserved the same merged graph key. The project-source mutation changed the graph key and invalidated exactly its owning `tsconfig.app.json` shard.

Artifact acceptance: `pass: true`.

GRAPH-EQ on the same run also remained green:

- 77 expected documents / 77 merged documents;
- 0 missing, extra, or mismatched documents;
- 9,686 nodes in both graphs;
- identical graph digest;
- 20/20 representative blast-radius samples matched;
- 0 merge conflicts.

The same runner's whole-repository performance baseline measured 8.460 s for first SCIP index and 26.827 ms for an exact-content H19 cache hit.

These absolute wall times are not frozen performance thresholds. The production-adoption acceptance invariant is:

1. exact evidence equivalence;
2. project-scoped invalidation;
3. unchanged-shard reuse;
4. out-of-project changes do not invalidate declared TypeScript shards;
5. fallback and merge failures remain explicit/fail-closed.

With those invariants satisfied, project-sharded SCIP evidence is accepted as the default H19 TypeScript evidence-graph strategy. GRAPH-EQ remains mandatory regression evidence for future graph-construction changes.
