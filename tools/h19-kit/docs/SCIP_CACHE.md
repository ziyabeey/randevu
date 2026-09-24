# SCIP indexing and cache strategy

The cache is intentionally not keyed only by Git commit SHA.

## L0 — exact head manifest

A head manifest records provenance:

- repository;
- base/head SHA;
- project shard fingerprints;
- indexer identities/versions;
- optional public-surface digests.

Changing HEAD changes the manifest identity, but HEAD is not part of a reusable project-shard key.

## L1 — content-addressed project shards

Each project/workspace shard is keyed by:

- project-relative source content digests;
- project config digests;
- indexer ID/version/flags;
- H19 adapter version;
- public-surface digests of dependencies.

This means a docs-only commit can reuse an existing SCIP project index.

A changed dependency only invalidates a downstream project when the dependency surface digest supplied to that
project changes.

## L2 — normalized graph/document cache

M3.5 currently caches the binary project index. Normalized document/symbol shards are the next optimization
layer and should be keyed independently from repository HEAD.

## Why not patch individual SCIP symbols?

H19 does not mutate a previous SCIP index by hand in v1. SCIP indexes contain cross-file references and
relationships. Updating only a changed definition can leave reverse relationships stale.

The safe incremental boundary for v1 is therefore the **project/workspace shard**.

File/symbol-level incremental indexing may be added only when an indexer or persistent compiler service can
provide correctness guarantees for deltas.

## Invalidation sketch

```text
new HEAD
  ↓
affected project discovery
  ↓
project fingerprint
  ├─ hit  → reuse index.scip
  └─ miss → run indexer
               ↓
        public surface changed?
          ├─ no  → stop
          └─ yes → invalidate downstream project fingerprints
```

No fixed performance percentage is part of this contract. Cache hit rate and indexing wall time must be
measured per repository class.
