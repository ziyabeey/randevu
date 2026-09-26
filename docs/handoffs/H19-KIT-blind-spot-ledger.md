# H19 Kit blind-spot ledger

Task: **H19-KIT-BLIND-SPOT-LEDGER**. Owner: Codex + coordinator. Date: 2026-09-26.

## Purpose

Turn already-explicit H19 unknown/unmatched states into deterministic diagnostic candidates and compare the same candidate identities before/after a capability change.

This does not infer hidden defects, invent missing evidence or claim population-level correctness.

## Current sources

The detector reads only explicit outputs already produced by H19:

- repository extraction errors;
- focused files that produced zero semantic units;
- semantic units whose symbol mapping is explicitly `unmatched`;
- explicit M4 `unknowns`.

Candidate categories are:

- `extraction-error`;
- `semantic-unit-absence`;
- `semantic-unit-symbol-unmatched`;
- `impact-unknown`.

Every record is `diagnostic-only` and remains a candidate, not a product defect.

## Identity and comparison

Candidate identity is a SHA-256 over category + deterministic subject. The ledger is content-addressed.

Before/after comparison reports:

- resolved candidates;
- persistent candidates;
- introduced candidates;
- counts;
- `blindSpotReductionRate = resolved / before` only when source revision, focus files and impact scope identities match exactly.

If the cohorts are not comparable, the reduction rate is `null`.

Disappearance of candidates measures disappearance of the same diagnostic limitations. It does not prove complete knowledge or model correctness.

## Python portability context

This branch also contains the preceding Python portability slices:

- Python AST evidence graph;
- module fallback units for procedural functionless files;
- batched repository Python semantic extraction.

The frozen RECAP target previously produced nine unmatched function units across:

- `execution/negative_controls.py`: 4/4 unmatched;
- `preflight/contract_check.py`: 5/5 unmatched.

An exact replay runner was prepared in the private RECAP repository, pinned to target revision
`683f4597241c59576c7bb8f55e652ac6e0367449` and H19 revision
`3b1f8ada879f914b5ed4fb656889a37e85a62184`.

GitHub Actions on that private experiment branch returned `startup_failure` before any job was created, so no new RECAP measurement is claimed. This infrastructure failure is not an H19 result.

## Validation

`test/blind-spots.mjs` proves:

- deterministic candidate generation and replay;
- extraction-error precedence over unit absence;
- unmatched symbol units become candidates;
- explicit M4 unknowns become candidates;
- resolved/persistent/introduced identities are stable;
- same-cohort reduction rate calculation;
- changed source revision makes the comparison non-comparable;
- tampered ledger bytes fail validation.

The smoke is wired into required CI as `test:blind-spots`.

## Next measurement

Once a runnable environment is available for the private RECAP target, collect the exact before/after ledgers and report the observed reduction from the frozen nine-unmatched baseline. Do not substitute fixture results for that empirical replay.
