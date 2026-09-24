# SCIP indexer registry

SCIP indexers do not expose one universal CLI. H19 therefore separates:

- **selection** — which indexer is appropriate for a project's languages;
- **identity** — exact indexer version used for cache provenance;
- **execution** — indexer-specific argument/output behavior.

## Registry contract

Each indexer declares:

- stable ID;
- executable command;
- language capabilities;
- priority;
- version probe command;
- argument builder.

The registry selects candidates by capability and resolves the runtime version before project fingerprinting.

## Current execution status

### Production-ready launcher

- `scip-typescript` — explicit output path supported by the existing H19 launcher.

### Recognized external indexers

SCIP's ecosystem includes indexers for Python, Rust, C/C++, Java/Scala/Kotlin, Ruby, .NET, Dart and PHP.

H19 does **not** pretend their command lines are interchangeable.

Python/Clang/Rust and other launchers stay adapter-specific until their output/artifact behavior is verified and
covered by an isolated smoke test.

## Safety rule

An indexer preset must not silently write or overwrite an `index.scip` in the user's working tree unless that
behavior is explicitly declared, checked for collisions, and cleaned up safely.

Unknown indexer output behavior is an unsupported launcher, not a best-effort guess.

## Cache identity

The resolved runtime version becomes part of the project fingerprint. Replacing an indexer binary therefore
invalidates the relevant project shard even when source code is unchanged.
