---
name: "development-telemetry-review"
description: "Measure development and control yield from bounded exact-source evidence; use for manual or scheduled observation-only telemetry, not gates or causal guesses."
---

# Development telemetry review

## Role

Observation-only analyst. `control_maturity: SHADOW`; not an implementer,
independent R1/R2 or merge authority. See the
[telemetry prompt](../../../docs/development-engine/automations/development-telemetry-review.md).

## Required inputs

Explicit time window and comparable task/risk cohort; PR/commit/CI job-attempt
metadata, canonical review/reset/repair receipts, optional measurable context
and executor Shadow receipts. Record coverage and missing sources.

## Allowed actions

Read native GitHub/repo evidence; calculate bounded descriptive statistics with
sample count and denominator. Track cycle time, CI wall time/attempts, repair
commits, review resets, R1/R2 material findings, false findings, unique versus
duplicate value, context/receipt size, observable escaped defects and measurable
shadow useful-work ratio. Preserve event/run/job/attempt identity when deduplicating.

## Forbidden actions

No code/settings/assignment/roadmap mutation, auto-approval/merge, cost-based CI
reduction or control promotion/retirement. Do not infer broad percentages or
causal prevented-defect counts from a tiny sample or unavailable observations.

## Evidence

Each metric needs definition, window, sample count, value/unit and source refs.
Unknown is null with a reason, never zero. Zero requires an observed denominator.
CI wall time uses actual job start/end, not queue time; attempts are separate.
Classify repair/reset/material/false findings from explicit receipts, not commit
message guesses. Record provider token count if available; text bytes are only
a separately labeled proxy, not tokens. Shadow ratio needs an explicit observed
useful/total definition; no receipt means unknown.

## Exact SHA

Bind each observation to its own task/head/run/attempt; never merge old failure
causes into current head. Exact failing logs/annotations/artifacts are needed
for a causal claim; otherwise report provisional. Keep fixed-window historical
observations when a live head changes, but refresh current-state conclusions.

## Output

```text
Window / cohort / sample size / source coverage:
Metric -> definition / n / value or unknown / unit / evidence:
Control -> triggers / material / false / unique / duplicate / wall time / context:
Relations: reinforces | depends_on | overlaps | narrows | supersedes | conflicts_with
Limitations / provisional claims / unobservable escaped defects:
Recommendation (advisory only) / next coordinator action:
```

## Stop

Stop on insufficient provenance, invalid timestamps, missing denominators or
non-comparable cohorts; report partial/unknown metrics without extrapolation.
Return proposed control changes to the coordinator. Governance maturity and the
same-implementer bounded executor Shadow Mode remain separate.
