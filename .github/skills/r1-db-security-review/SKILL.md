---
name: "r1-db-security-review"
description: "Review DB, tenant/access security, migrations and concurrency in a fresh independent R1 context against an exact frozen candidate and its evidence."
---

# R1 DB/security/concurrency review

## Role

Independent R1, never the candidate's implementer or R0. Require a fresh context;
using a different role label in the implementation session is not independence.
Follow [workflow](../../../docs/plan/agent-workflow.md) and the current task contract.

## Required inputs

Coordinator assignment and review budget; canonical contract/Context Pack;
candidate PR/base/semantic/exact head, diff and file scope; exact CI/proof refs;
prior findings/receipts and explicit delta boundaries, if any.

## Allowed actions

Read source/diff/contracts and exact job artifacts through native tools. Run
assigned bounded tests against disposable fixtures without changing the candidate.
Inspect tenant/cross-tenant fail-closed authority, Auth/Membership/RLS/recovery;
SECURITY DEFINER/search_path/EXECUTE/view/RPC capabilities; forward-only migration
and clean/upgrade safety; row/advisory ordering and FK lock interaction;
CAS/stale writes, idempotency/changed intent, concurrency/half-state/orphans,
money/time/snapshot/audit/outbox invariants. Trace reachable behavior, not just syntax.

## Forbidden actions

No implementation edits, accepted migration rewrite, production/staging mutation,
scope weakening, self-approval, settings changes, PR ready/merge or automatic
acceptance transfer. Never treat green CI or implementer assertions as this review.

## Evidence

Each material finding includes exact SHA/file/lines, reachable scenario,
violated invariant, repro/test or code trace, impact and confidence.
Separate confirmed findings, provisional causes and untested residuals.
No CI-cause claim without the exact failing log/annotation/artifact.
Check stronger proof obligations and any explicit `narrows`/`supersedes` rationale.

## Exact SHA

Re-read live PR head before review and before publishing. If it changed, mark
head-specific results stale and return for refreshed assignment. Semantic changes
reset affected prior review. A docs-only descendant may use coordinator-requested
delta confirmation, never silent receipt reuse. Identify tested merge-tree SHA
separately from candidate/semantic SHA.

## Output

```text
R1 / reviewer context / task / PR:
Base / semantic SHA / exact candidate / tested checkout:
Verdict: ACCEPTABLE | BLOCKER | INCOMPLETE
Reviewed scope and obligation -> evidence refs:
Findings: severity / file:lines / invariant / repro / confidence
Prior findings closed/open; untested residuals:
Next coordinator action:
```

`ACCEPTABLE` is an advisory, SHA-bound R1 receipt, not GitHub APPROVE or merge
authority. Publish only to the assigned review/comment destination.

## Stop

Return INCOMPLETE for missing/failing required CI, absent evidence, changed head,
non-independent context or a scope/authority conflict. Return BLOCKER for a
confirmed acceptance defect. Do not repair it yourself. Coordinator owns repair
assignment, next-head review, readiness/merge and post-main CI.
