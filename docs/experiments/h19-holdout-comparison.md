# H19 holdout comparison protocol

Base: `0b6e08bf79d0e418e3a6e54076af77aa82acbe02`

Purpose: test whether the H19-selected interaction geometry carries information beyond ordinary pairwise coverage.

## Frozen comparison set

H19 antipodal holdouts:

- D0 x D3 — tenant / authorization x staff / capacity
- D1 x D4 — atomicity / idempotency x time / buffer / boundary
- D2 x D5 — snapshot / price / policy x concurrency / version

D2 x D5 already has a historical frozen result: the existing suite distinguished M0, so it did not provide novel coverage.

## Candidate rule

For each remaining holdout, in the order D0xD3 then D1xD4:

1. Choose exactly one minimal, user-reachable semantic variation that weakens the conjunction of the two dimensions while leaving the ordinary single-dimension path unchanged where possible.
2. Do not add or change tests before the control run.
3. Run the canonical CI on the variation-only branch.
4. If canonical CI fails, record the holdout as already covered and stop for that pair. Do not search for a second variation.
5. If canonical CI passes, add exactly one pair-specific two-condition probe, run the same canonical CI, and run the identical probe on correct code.
6. Count a prospective coverage discovery only for the three-arm pattern: variation/current-suite PASS, variation/new-probe FAIL at the intended invariant, correct-code/new-probe PASS.

This one-variation-per-pair rule is frozen before inspecting candidate implementation sites to avoid selecting only favorable holdout examples.
