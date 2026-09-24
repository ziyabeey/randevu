# Call-edge classification contract

SCIP reference occurrences are not automatically call edges.

H19 therefore keeps call-edge classification as a separate, language-aware evidence layer.

## States

Every candidate reference is classified as exactly one of:

- `confirmed` — the language/native adapter has positive evidence that the site is a call;
- `not-call` — positive evidence says the reference is not a call;
- `unknown` — insufficient evidence.

Generic SCIP references default to `unknown`.

## Sources of future confirmed edges

Examples include:

- TypeScript compiler/native AST call-expression context;
- rust-analyzer/native semantic information;
- Clang/native call-expression information;
- a Tree-sitter language profile explicitly tested to identify call-expression nodes.

A generic text heuristic is not sufficient to promote an edge to `confirmed`.

## Routing boundary

Confirmed call-edge count is still evidence, not severity.

```text
reference graph
   ↓
language-aware call classifier
   ↓
confirmed / not-call / unknown
   ↓
typed evidence
   ↓
rule cards / dispatcher
```

Unknown call-edge evidence must not be coerced into "no callers".
