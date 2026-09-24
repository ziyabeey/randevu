# Static evidence layer

H19 Kit treats static analysis as a deterministic evidence producer, not as a semantic-model prompt generator.

## Current SQL facts

The bundled H19-owned Semgrep rules detect only descriptive facts:

- explicit PostgreSQL row-lock syntax;
- advisory transaction-lock calls;
- optimistic-version/stale-write vocabulary;
- idempotency/replay/request-identity vocabulary.

These rules do **not** claim that a change is safe, unsafe or D5. They only emit typed facts.

```text
Semgrep CLI
   ↓
H19-owned rules
   ↓
semgrepEvidence()
   ↓
typed evidence
   ↓
deterministic rule cards / dispatcher
```

Static facts are not silently appended to Jev or any later semantic-model prompt. Feeding a deterministic fact
to a semantic model requires an explicit, versioned experiment proving incremental value.

## Licensing boundary

- Semgrep is invoked as an optional external CLI.
- H19 Kit does not vendor Semgrep engine source.
- H19 Kit does not bundle Semgrep community rules.
- The SQL rules in `rules/semgrep/` are H19-owned rules written for this toolkit.

## Unknown

If the external analyzer is unavailable or a fact cannot be extracted, evidence is `unknown`. Unknown is not
converted to safe.
