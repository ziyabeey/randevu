# Normalized SCIP graph cache

The binary SCIP shard cache prevents unnecessary indexer runs, but parsing a large `index.scip` into JSON and
normalizing its symbol graph can also be expensive.

H19 therefore adds a second content-addressed cache:

```text
index.scip bytes
      ↓ sha256
(index digest + converter version + H19 graph schema)
      ↓
normalized symbol graph
```

## Invalidation

The normalized graph is invalidated when any of these change:

- the binary SCIP index bytes;
- the SCIP converter/reader version;
- H19's normalized graph schema version.

Git HEAD is not part of this cache key.

## Why this layer exists

A project shard can be reused across multiple commits. Once the binary shard is a hit, H19 should not pay the
SCIP decode/JSON/normalization cost again.

## Future sharding

The v1 normalized cache stores one graph snapshot per project shard. If real repositories show graph JSON size
or memory pressure becoming material, the same key hierarchy can be split into per-document and symbol buckets
without changing the project index cache contract.
