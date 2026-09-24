# Affected project resolution

H19 resolves project/workspace impact before deciding which SCIP shards need indexing.

## Authority order

1. Existing repository-native project graph / affected engine, when supported.
   - Nx adapter is the first implementation.
2. H19 generic project graph + changed-file ownership + reverse dependency closure.
3. Whole-repository fallback when project boundaries are unknown.

## Nx

Nx already maps Git changes to projects and follows the project graph to include dependants. H19 consumes this
result instead of duplicating Nx's analysis.

The adapter exposes:
- project graph import from `nx graph --file=...`;
- affected project list from `nx show projects --affected`.

No Nx dependency is bundled into H19. The adapter is active only when the target repository already provides Nx.

## Generic fallback

For repositories without a supported native graph engine:

```text
changed files
   ↓
longest matching project root
   ↓
directly touched projects
   ↓
reverse dependency closure
   ↓
affected projects
```

Unowned files remain explicit. H19 must not silently map an unknown/global file to "no project affected".

## Cache interaction

The affected-project set determines which content-addressed SCIP project fingerprints need evaluation.
An affected project can still be a cache hit if its content/config/dependency-surface fingerprint is unchanged.
