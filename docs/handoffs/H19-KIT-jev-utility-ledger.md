# H19 Kit Jev Utility Ledger

Task: **H19-KIT-JEV-UTILITY-LEDGER**. Owner: Codex + coordinator. Date: 2026-09-26.

## Parent

Router implementation: PR #633, branch `h19-kit-jev-utility-router`.

This child adds fake execution observations and utility accounting only.

## Observation contract

Each fake execution observation is bound to an exact route decision and records:

- provider/model identity;
- per-attempt answered / insufficient / error state;
- input/output tokens;
- latency;
- cost, currency and rate evidence;
- optional provider confidence;
- later evaluation status;
- whether a permitted downstream recommendation changed.

Live-route fake observations must contain exactly the planned number of attempts and stay within
the route's token and monetary ceilings.

Non-live routes cannot carry provider attempts.

## Utility semantics

A provider answer alone does **not** resolve uncertainty.

`resolvedEvaluableQuestions` increments only when the later evaluation contract reaches:
- `confirmed`, or
- `rejected`.

`pending` and `unresolved` remain unresolved.

The ledger reports:

- provider request count;
- answered / insufficient / error counts;
- input/output/total provider tokens;
- total wall time;
- cost by currency and rate evidence;
- resolved evaluable questions;
- resolved evaluable questions / provider token;
- cost / resolved uncertainty;
- downstream recommendation-change count.

`informationGain` remains null because no prior/posterior probability update contract exists.

`falseConfidenceCases` remains null until a separate preregistered confidence threshold exists.

## Provenance repair

The ledger requires the exact route decision set. A self-consistent rehashed observation cannot bypass
route budgets: the observation is replay-validated against its decision before accounting.

## Smoke

`test/jev-utility-ledger.mjs` proves:

- a pending provider answer yields zero resolved questions;
- confirmed/rejected later evaluation yields resolution accounting;
- single and fan-out attempts retain exact token/cost denominators;
- provider cost cannot exceed the route ceiling;
- attempt count must equal the planned live questions;
- tampered observation bytes fail;
- duplicate observations fail;
- rehashed over-budget observations fail against the exact decision;
- observations without their exact decision fail.

Provider calls: **0**.

## Next slice

After exact-head CI, the next safe child is a fake-provider executor that consumes router decisions
and produces these observations automatically. Real Jev transport remains outside this slice.
