# H19 Kit Python evidence graph — cross-repository portability slice

Task: **H19-KIT-PORTABILITY-PY-GRAPH**. Owner: Codex + coordinator. Date: 2026-09-25.

## Why this slice exists

Cross-repository portability produced two complementary observations.

On `ziyabeey/yzt-digital`, frozen H19 reached M10 planning on a foreign TypeScript
repository after the cross-cwd ArtifactCache repair in PR #617. The latest hosted
probe passed all 15 declared stages, while retaining zero live provider calls.

On the Python-heavy `ziyabeey1-ai/RECAP-T2-Execution` cold replay, H19 parsed
4/4 Python files and emitted 15 function units, but function-bearing changed files
could not contribute symbol/reference evidence because H19 had no Python evidence
graph. M4 therefore retained `symbol-graph` and semantic-unit mapping unknowns and
could use mainly history evidence.

This slice addresses only that observed portability ceiling.

## Parent and scope

Parent portability repair: PR #617, exact head
`d1f900da997670a3c76816031bc15555be26f119`.

Branch: `h19-kit-python-evidence-graph`.

Added provider:
`tools/h19-kit/src/indexing/python-evidence-graph.mjs`.

The provider batches all discovered Python source bytes into one Python AST process
and emits the existing H19 symbol-graph shape. It records:

- module nodes;
- `def` and `async def` definitions, including class-qualified functions;
- same-module direct-name references;
- repository-local `import` and `from ... import ...` references;
- relative imports;
- direct imported-module attribute references;
- test-path identity on reference locations.

It deliberately does not infer dynamic dispatch, monkey-patching, reflective
lookups, runtime import behavior or unresolved external symbols.

No M4/M5 semantics are changed. Python is a new evidence provider speaking the
existing graph contract.

## Acceptance

The dedicated smoke creates a small Python repository with:

- a function calling another function in the same module;
- a second module importing and calling that function;
- a test module importing and asserting the same function.

Acceptance requires:

1. repository Python units parse with zero errors;
2. the Python graph contains the expected function definition and references;
3. test references are marked as test locations;
4. M4 maps all changed Python semantic units with zero unmatched units;
5. blast radius includes the cross-file source and test path;
6. the test path becomes an ordinary candidate test with runtime coverage unknown;
7. no unsupported evidence is fabricated and `safeToNarrow` remains false;
8. rebuilding the graph from identical bytes is deterministic.

CI runs `test:python-evidence-graph` in the existing required code gate.

## Deliberate exclusions

This PR does **not** add:

- module-level Python pseudo-units;
- a replacement/batched semantic-unit extractor;
- Python call-edge certainty beyond direct static references;
- automatic foreign-project ownership;
- runtime coverage inference;
- Python-specific M4/M5 rules;
- generated tests, provider calls or M12 authority.

Those remain separate portability slices and should be justified by the next
frozen RECAP replay rather than bundled speculatively.

## Next measurement

After exact-head CI passes, rerun the same frozen RECAP target and compare the
previous observed mappings:

- `execution/negative_controls.py`: 4 units, previously 4 unmatched;
- `preflight/contract_check.py`: 5 units, previously 5 unmatched.

The next result should report mapped/unmatched counts and reference/test paths,
not merely whether the new provider itself passes a fixture.
