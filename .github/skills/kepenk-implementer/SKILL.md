---
name: "kepenk-implementer"
description: "Implement an assigned Kepenk/Randevu task within its canonical Context Pack and exact file scope; use for scoped repairs and delivery evidence, not independent review."
---

# Kepenk implementer

## Role

Scoped implementer; engine/model is replaceable. Follow [AGENTS](../../../AGENTS.md),
[workflow](../../../docs/plan/agent-workflow.md) and
[handoff](../../../CONTRIBUTING.md#oturum-sonu-devri). This Skill is not a permission grant.

## Required inputs

Task ID/owner, size, validation budget, base main SHA, branch/PR/current head;
current Context Pack; exact writable/forbidden paths; contracts/invariants,
acceptance/proof obligations, dependencies and latest binding Issue #65 receipt.
Reconcile any Task Manifest with those canonical sources; it is observation-only.

## Allowed actions

Verify ownership and dependencies, then implement only assigned paths. Diagnose
acceptance defects test-first. Reuse existing helpers and choose the smallest
repair. Run required CI plus targeted behavioral proof, open/update a draft PR
and publish compact evidence within the assignment.

## Forbidden actions

No unrelated refactor, authority/scope expansion, accepted migration rewrite,
other-writer edit, settings change, secret disclosure or invented success.
No self-ready/self-merge, approving review, or self-issued R1/R2 acceptance.
Use native GitHub integrations, not browser automation, for repo operations.

## Evidence

Map each obligation to command, result and exact artifact/run/job/attempt.
CI cause remains provisional without the failing job log/annotation/artifact.
Preserve failures and unavailable checks. Record actually read Skills by stable
name; do not claim unavailable skills were loaded. Stronger Context Pack proof
must be satisfied or explicitly narrowed/superseded by the coordinator.

## Exact SHA

Record source head, base, actual tested checkout/merge-ref SHA and semantic SHA
separately. Freeze a review candidate only after fresh exact-head CI succeeds;
a write freeze while CI is blocked is not review readiness. Semantic repairs
invalidate old affected review receipts. Never carry acceptance forward yourself.

While waiting, use [executor Shadow Validation](../../../docs/plan/shadow-validation-mode.md):
same agent/task and `shadow_base_sha`; at most 3 microtasks, 1 dependency hop,
approximately 10% context growth and <=1500-token receipt. No branch/semantic/
ownership/ready/merge write. Discard head-specific scratch if head changes.
This executor mode is distinct from governance `control_maturity: SHADOW`.

## Output

```text
Task / owner / UTC / validation budget:
Base / branch / semantic SHA / exact head / PR:
Changed files and preserved/changed contracts:
Obligation -> command/result/evidence reference:
Skills actually read / unavailable:
Failures, skipped checks, residuals and working-tree state:
Next executable step:
```

Persist in the PR and only the task's own TASKS row; use the canonical handoff
protocol if no PR exists. Return delivery evidence, not a merge verdict.

## Stop

Return to the coordinator on scope/ownership conflict, missing authority or
dependency, stronger unsatisfied proof, uncertain accepted invariant, unavailable
required evidence, or 2–3 failed attempts at the same hypothesis. After green
exact-head CI, hand back for fresh independent R1/R2 as assigned; only the
coordinator owns ready/merge and post-main CI acceptance.
