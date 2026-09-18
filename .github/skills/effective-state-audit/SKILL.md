---
name: "effective-state-audit"
description: "Derive a disposable, provenance-backed task/PR state from verified main, live head/CI and latest binding coordination receipts without changing authority."
---

# Effective-state audit

## Role

Observation-only auditor; not writer, coordinator or independent R1/R2.
Read [source/authority map](../../../docs/development-engine/README.md).
`control_maturity: SHADOW` describes this control, not executor wait-mode.

## Required inputs

Repository/task/PR, live main ref, main TASKS/PROJECT_STATE, current PR/head,
CI run/job/attempt and checkout identity, current Context Pack, latest binding
Issue #65 receipts and any disposable Task/Evidence projections.

## Allowed actions

Use native APIs/repo tools, bounded to the task and its direct dependencies.
Separate verified main, live PR overlay and proposed/unverified state. Reconcile
stale prose against source refs without replacing them. Report scope, evidence,
review freshness, proof-obligation drift and next executable action.

## Forbidden actions

No branch, TASKS, roadmap, ownership, acceptance or settings writes; no CI reruns,
ready/merge, approval, new source-of-truth database or autonomous repair. Do not
treat manifests, latest timestamps or implementer summaries as binding decisions.

## Evidence

Every discrepancy names conflicting sources and observed SHA/time. Missing data
is unknown, not success. A CI cause needs the exact failed job artifact/annotation;
secondary summaries remain provisional. Distinguish an ordinary in-progress
TASKS overlay from an actually stale verified-main summary.

## Exact SHA

Read head/main at start and again before output. If either changes, discard
head-specific deductions and refresh. Preserve superseded evidence as historical.
Identify semantic SHA, raw candidate head, tested merge-tree and post-main SHA
separately; flag stale R1/R2 for coordinator-requested delta/final confirmation.

## Output

```yaml
main_sha: null
task: null
pr: null
head_sha: null
mode: null
ci: {}
blockers: []
reviews: {}
staleness: []
next_action: null
source_refs: []
```

This disposable output reports existing canonical blockers; its own findings
are advisory, never a new BLOCK gate. Use the assigned output destination only;
posting a comment requires explicit permission and a final head recheck.

## Stop

Return an explicit unknown/conflict with source refs when authority, access or
provenance is unavailable. Hand real contradictions, stronger proof obligations
or scope decisions to the coordinator; never resolve them by rewriting state.
