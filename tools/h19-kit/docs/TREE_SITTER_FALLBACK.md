# Tree-sitter fallback extraction

Tree-sitter is an optional syntax-layer fallback for languages where H19 does not have a richer native
compiler/parser adapter.

## Precedence

```text
native compiler/parser adapter
        ↓ if unavailable
Tree-sitter grammar profile
        ↓ if unavailable
unknown / unsupported
```

H19 currently keeps the existing native paths for TypeScript/JavaScript, Python and SQL.

## Contract

A Tree-sitter profile declares:

- language ID;
- syntax-node types that represent semantic units;
- optional container node types;
- name/body fields;
- whether anonymous units are allowed.

The extractor normalizes those nodes into the same semantic-unit shape used by native extractors.

## Important boundaries

Tree-sitter produces syntax trees. H19 does not treat a Tree-sitter unit as type-checker truth, a call graph or a
resolved symbol graph.

SCIP/compiler-backed evidence remains preferred when available.

Parse failures are fail-closed by default: the file becomes an extractor error/unknown rather than "safe".

## Runtime

The Node runtime adapter uses the target repository's optional `tree-sitter` parser and grammar packages.
H19 core does not need to bundle every language grammar.

Grammar licenses must be reviewed per grammar before H19 distributes or vendors them.

## Initial profiles

The first built-in profiles cover common executable unit shapes for:

- Go;
- Rust;
- C++.

Profiles are intentionally small. Language-specific edge cases should be added through tests rather than making
the generic walker guess.
