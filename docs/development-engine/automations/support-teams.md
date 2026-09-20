# Support team automation contract

These roles keep a live multi-agent repository coherent without creating a second
project authority. They are GitHub-native assistants around the existing
TASKS/coordinator/implementation/review flow.

`main:TASKS.md` remains the only durable live task/status authority. None of the
roles below may turn an observation into committed product scope or bypass normal
task ownership, CI, review, readiness or merge gates.

## Roles

| Role | Discovery label / output | Contribution | Never does |
| --- | --- | --- | --- |
| P1: Product Integrity Scout | `product-gap:triage` issue | Finds one concrete mismatch between approved PRODUCT_SPEC/ROADMAP behavior and the implemented/planned three-surface product, after duplicate search. | Coding, TASKS edits, product decisions, prioritization, writer assignment, acceptance. |
| D1: Documentation Steward | `docs-drift` issue or one docs-only draft PR | Repairs factual drift in non-authoritative documentation after merged code/contract changes when the correction is unambiguous. | Editing TASKS/AGENTS/PRODUCT_SPEC/ROADMAP/DECISIONS without explicit coordinator assignment, changing behavior, inventing policy. |
| B1: Ready Queue Scout | `## READY QUEUE SUGGESTION` on Issue #65 | Detects a TASKS item whose explicit dependencies are durably satisfied and which has no active owner/PR/hold, then surfaces that fact once. | Choosing business priority, assigning a writer, opening implementation, changing TASKS, interpreting ambiguous dependencies as ready. |

These are support roles, not sequential gates. A useful run produces one bounded
artifact at most. No useful change means no GitHub write or user notification.

## P1 Product Integrity Scout

P1 reads current `PRODUCT_SPEC.md`, `ROADMAP.md`, `TASKS.md`, open/merged PR
evidence and only the relevant implementation surfaces. It looks for concrete
approved-scope gaps such as:

- one of the three MVP surfaces missing an already-approved behavior;
- two surfaces exposing contradictory approved business behavior;
- a PRODUCT_SPEC requirement with neither implementation nor a planned TASKS item;
- an implementation path that demonstrably exceeds or contradicts approved scope.

Before creating anything, search open and closed `[PRODUCT-GAP]` issues, TASKS and
relevant PRs. Do not turn reviewer nits, visual taste, future ideas or R&D proposals
into product gaps.

When a materially new gap is established, create one issue titled
`[PRODUCT-GAP] <short factual gap>` with only `product-gap:triage` and include:

```text
## PRODUCT GAP
Observed against: <current main SHA>
Approved source: <exact PRODUCT_SPEC/ROADMAP section>
Observed implementation/planning evidence: <links/paths>
Gap: <one factual mismatch>
Affected surface(s): Customer | Booking | SalonApp | Shared
Why this is not an R&D idea: <approved requirement already exists>
Duplicate search: <issues/TASKS/PRs checked>
Evidence confidence: HIGH | MEDIUM | INCOMPLETE
Next coordinator action: <one bounded decision>
No task/priority decision: true
```

P1 does not alter the issue after handoff unless materially new evidence invalidates
its own factual claim. The coordinator decides whether any TASKS change is needed.

## D1 Documentation Steward

D1 watches merged changes for factual drift in non-authoritative docs such as
runbooks, README-style operational guidance, handoffs and Development Engine
explanations. It must first determine that the source of truth is already settled
in merged code/contracts and that the textual correction is mechanical rather
than a new policy decision.

D1 may either:

1. open a `[DOCS-DRIFT]` issue with `docs-drift` when correction requires a
   coordinator/product decision; or
2. create one short-lived docs branch and one draft docs-only PR when the correction
   is unambiguous and limited to non-authoritative text.

Automatic docs PRs must not modify `TASKS.md`, `AGENTS.md`, `PRODUCT_SPEC.md`,
`ROADMAP.md`, `DECISIONS.md`, application code, tests, migrations, workflow/CI,
settings or secrets. They must preserve existing terminology and link to the merged
source evidence. A docs-only PR still follows repository CI policy and cannot be
self-approved, marked ready or merged by D1.

Before opening a new issue/PR, search for an existing docs-drift issue or docs-only
PR covering the same source change. One factual drift per run maximum.

## B1 Ready Queue Scout

B1 is a factual dependency observer for `TASKS.md`; it is not a planner. It may
surface an item only when all of the following are directly provable:

- the task is not complete/accepted;
- every explicit TASKS dependency is durably complete/accepted;
- no blocking hold is recorded;
- no active PR or current Issue #65 writer claim owns the task;
- no contradictory task binding or ambiguous dependency exists.

B1 then searches recent Issue #65 comments for the same task readiness state. If no
current suggestion exists, add one comment:

```text
## READY QUEUE SUGGESTION
Task: <TASKS ID>
Observed main: <full SHA>
Dependencies satisfied: <exact durable evidence>
Active owner/PR/hold: NONE observed
Why eligible now: <one factual sentence>
Priority: NOT ASSESSED
Assignment: NONE
Next coordinator action: decide priority/owner or leave queued.
```

A main change alone does not justify repeating the suggestion. Repeat only after a
previous suggestion became invalid and a materially new readiness transition later
occurs. B1 never chooses between multiple ready tasks; at most surface the oldest
TASKS-order eligible item per run.

## Shared safety and noise controls

- Use direct GitHub tools for repository facts. Never use TinyFish.
- No secrets, private customer data, production actions, provider/deployment writes
  or external contact.
- Re-read native GitHub state immediately before every write.
- Unknown pagination/access/evidence is UNKNOWN, never NONE or PASS.
- Existing active writers/reviewers/coordinator holds outrank support automation.
- No role above may dispatch R0/R1/R2/R3/R4, Y1/Y2/Qwen or paid models.
- No unchanged-state heartbeats. Repository activity must represent useful evidence,
  not synthetic motion.
