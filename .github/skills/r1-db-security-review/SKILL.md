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
prior findings/receipts and explicit delta boundaries, if any. Use the canonical
[review lineage contract](../../../docs/plan/agent-workflow.md#review-lineage)
for mode, freshness, blocker identity and follow-up scope.

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

Apply the canonical lineage/freshness routing before review and before publishing.
For DB proof, also identify the tested migration chain in the linked artifact;
green CI alone does not establish the access/concurrency invariant.

## Output

Lead with the canonical `VERDICT / BLOCKERS / EVIDENCE GAPS / REVIEWED SHA / NEXT ACTION`
header, using `ACCEPTABLE | BLOCKER | INCOMPLETE`, then:

```text
R1 / reviewer context / task / PR:
Brief reference / base / semantic SHA / tested checkout:
Reviewed scope and obligation -> evidence refs:
Findings: severity / file:lines / invariant / repro / confidence
Prior findings closed/open; untested residuals:
```

`ACCEPTABLE` is an advisory, SHA-bound R1 receipt, not GitHub APPROVE or merge
authority. Publish only to the assigned review/comment destination.

## Stop

Return INCOMPLETE for missing/failing required CI, absent evidence, changed head,
non-independent context or a scope/authority conflict. Return BLOCKER for a
confirmed acceptance defect. Do not repair it yourself. Coordinator owns repair
assignment, next-head review, readiness/merge and post-main CI.
