# Performance production synthesis gate

This gate combines three independently validated performance/correctness lines into one operational TypeScript evidence path.

## Prerequisites

### Project-scoped invalidation

PERF-003 showed that TypeScript project boundaries remove false invalidations and reduce a real app-source reindex relative to the whole-root control.

### Cross-run persistence

PERF-004 proved that content-addressed project shards survive across GitHub-hosted workflow runs. A measured warm run restored all three shards and reduced H19 shard lookup from an 8.0 s cold seed to 9.18 ms local lookup.

### Graph equivalence

GRAPH-EQ-001 proved that the union of the three project indexes preserves the current H19 evidence contract:

- 77 whole-index documents = 77 merged-shard documents;
- missing / extra / mismatched documents = 0 / 0 / 0;
- 9,686 graph nodes on both sides;
- identical normalized graph digest;
- 20 representative blast-radius units with 0 mismatches.

### Production adoption

The project-shard evidence graph then passed the real-repository adoption benchmark:

- project-shard mode;
- exact-content warm graph reuse;
- one declared project source change invalidates one index shard;
- an out-of-project script change reuses all index shards and the merged graph.

## Synthesized operational path

restore .h19 cache
→ resolve TypeScript project shards
→ compute exact fingerprints
→ index plan
   - misses > 0: install pinned scip-typescript and materialize misses
   - all hit: skip scip-typescript
→ merged graph plan
   - miss: build pinned SCIP decoder and decode/merge/cache graph
   - hit: skip decoder entirely
→ final plan requires index misses = 0, graph = hit, ready = true
→ prune old shard generations

GitHub Actions cache is transport only. H19 content fingerprints remain the reuse authority.

## Acceptance

Cold synthesis run:

- full M0→M5 and performance regression smokes pass;
- cache planning is deterministic;
- required external tools are installed only when the plan says they are needed;
- final index plan has zero misses;
- final merged graph is cached;
- cache prune preserves at least the newest generation per logical shard.

Warm continuation run, triggered by a docs-only change:

- restored cache is accepted only through exact H19 fingerprints;
- initial index misses = 0;
- initial graph state = hit;
- scip-typescript installation is skipped;
- Go/SCIP decoder setup and build are skipped;
- evidence materialization still returns the same cached graph;
- final state remains ready.

The warm continuation is mandatory before this synthesis gate is complete.

## Remaining cost boundary

This synthesis does not make a real changed-project cold index free. A declared app-source edit still requires that project's SCIP index to be regenerated and the merged graph to be refreshed.

Warm unchanged/out-of-project paths and changed-project paths therefore remain separate performance classes.

## Feature sequencing

M6/M7 code may exist on earlier green branches, but it is not the active product line until this performance synthesis gate passes and those feature branches are rebased/retargeted onto the resulting green head.
