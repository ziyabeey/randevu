# Code Intelligence Graph

M3.5 adds a normalized graph layer between semantic-unit extraction and evidence/routing.

## Sources

### SCIP

Preferred cross-reference source when a language indexer exists.

H19 Kit shells out to the official `scip` CLI:

```bash
scip print --json index.scip
```

The adapter ingests documents, occurrences, symbol roles and symbol relationships. The original SCIP index
remains authoritative; H19 only normalizes the subset required for impact analysis.

### Tree-sitter tags

Tree-sitter is a **syntax-only fallback**, not a replacement for compiler-backed SCIP/native extractors.
The adapter consumes `tree-sitter tags` output and marks all derived symbol nodes/edges with
`precision: syntax-only`.

It is appropriate for unsupported languages where a grammar + tags query exists.

### Nx

For Nx workspaces, H19 can ask the existing project graph instead of rediscovering it:

```bash
nx show projects --affected --base=<base> --head=<head> --sep=,
```

Nx remains an optional external provider.

### Turborepo

For Turborepo workspaces, H19 uses the structured affected query:

```bash
turbo query affected --base <base> --head <head>
```

The adapter consumes affected package/task JSON.

## Authority

These integrations are evidence producers. None may directly decide `observe | targeted-test | escalate`.

Preferred precision order for code relationships:

1. compiler-backed/native semantic graph;
2. SCIP index;
3. framework project graph (Nx/Turbo) for package/project impact;
4. Tree-sitter tags for syntax-only fallback;
5. text heuristics only when explicitly configured.

Missing integration data is unknown, not safe.
