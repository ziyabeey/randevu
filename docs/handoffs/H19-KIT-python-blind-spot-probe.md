# H19 Kit one-shot Python blind-spot probe

Task: **H19-KIT-PY-BLIND-SPOT-PROBE**. Owner: Codex + coordinator. Date: 2026-09-26.

## Purpose

Remove the remaining operator-preparation step from the Python blind-spot workflow.

Before this slice, the blind-spot CLI required a prebuilt JSON containing inventory
and M4 impact objects. That meant H19 could classify explicit blind spots, but the
operator still had to assemble part of H19's own evidence chain.

This slice adds a one-shot Python probe:

`h19-kit python-blind-spots-probe <repo> <source-revision> [focus.py ...]`

The command executes the existing production chain itself:

`repositoryInventory → buildPythonEvidenceGraph → analyzeChangeImpact → detectH19BlindSpots`.

## Scope

The probe is intentionally Python-only.

Inputs:
- local repository root;
- exact 40-hex source revision;
- optional Python focus files. When omitted, all discovered Python files are used.

For each focus file it records:
- semantic-unit count;
- matched and unmatched symbol mappings;
- mapped symbols;
- impacted paths;
- test-reference paths;
- candidate tests;
- explicit M4 unknowns;
- `safeToNarrow`.

It also returns the sealed blind-spot ledger and a diagnostic-only claim boundary.

## Safety / claim boundaries

- No source file is modified.
- No generated test or provider call.
- Runtime coverage remains unknown unless supplied by another evidence source.
- A clean ledger is not a complete-knowledge claim.
- No product defect is inferred from a blind-spot candidate.
- Missing/non-Python focus paths fail closed.

## Motivation from RECAP portability

The frozen RECAP Python target exposed nine unmatched function units before the
Python evidence provider. A bounded local reproduction against exact frozen blobs
now maps all nine units, while the target private repository's hosted Actions
layer remains blocked before job creation.

This command makes that style of portability probe a first-class H19 operation
instead of an ad-hoc orchestration step.

## Validation

The smoke builds a temporary Python repository containing:
- ordinary functions;
- cross-file imports;
- a test reference;
- a procedural module requiring the module fallback unit.

Acceptance requires:
- deterministic inventory / graph / M4 / ledger output;
- function units map;
- module fallback maps to the module graph node;
- test reference becomes a candidate test;
- runtime coverage remains explicit unknown;
- `safeToNarrow=false`;
- invalid revision, missing focus and non-Python focus fail closed.

No M12 authority is introduced.
