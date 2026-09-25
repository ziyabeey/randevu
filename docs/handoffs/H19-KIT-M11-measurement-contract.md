# H19 Kit M11 measurement contract — context and handoff

Task: H19-KIT-M11-GATE. Owner: Codex. UTC date: 2026-09-25.
User assignment: prepare the next measurement contract and cohort while M10 is reviewed.
Size: M. Validation budget: LIGHT; research documentation and frozen inventory only.
Live task authority: [TASKS.md](../../TASKS.md). This is a candidate-bound receipt.

## Context pack

- Starting main: `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.
- Stacked parent: M10 PR #594, `6a37baebca749482465d3dd302f9bae56d3ff2e0`.
- Parent exact-head evidence: CI #2965 SUCCESS; independent review/main acceptance pending.
- Branch: `h19-kit-m11-measurement-contract`; target the existing M10 branch.
- Goal: make M11 evaluation reproducible and prevent relation probabilities being
  reported as defect probabilities or advisory judgments as test-selection gains.
- Writable scope: the M11 spec, experiment inventory/README, BUNDLE next-step
  section, this handoff and only the H19-KIT-M11-GATE task row.
- Read boundary: M8 outcome/question, M9 case selection, M10 v0.3 requests,
  M3 freeze utilities and named source tests at the pinned main revision.
- Preserved: M8/M9/M10 artifacts, provider/question/model versions, 20-case cap,
  deterministic selection, existing CI, dispatcher authority, H19s separation.
- Outside scope: runtime/runner implementation, new test execution authority,
  live provider calls, labels, app/DB/UI changes, M12 ranking, merge/promotion.
- Acceptance: 24 unique source-bound anchors, exact source references, disjoint
  declared clusters, reproducible M3 manifest hashes, no invented outcomes;
  explicit comparison arms, denominators, costs, leakage rules and entry gates.
- Skills: no available skill specifically covers repository Markdown research
  contracts. Existing repo/M3–M10 contracts are the applicable equivalent;
  no document-rendering, UI or DB skill is required for this scope.

## Prepared artifacts

- [M11 contract](../../tools/h19-kit/specs/RELATIONAL_MEASUREMENT_GATE-v0.1.md).
- [Pilot inventory and reproduction](../../tools/h19-kit/experiments/m11/README.md).
- 24 scenario anchors, 12 development / 12 evaluation, in five declared clusters.
- Every anchor refers to an existing named test and primary source blob identities.
- All case materialization, relation labels and independent outcomes remain pending.

The inventory is a purposive pilot, not 24 new defects, 24 M8 cases or 24
independent samples. Source-contract checks alone do not prove runtime behavior.
No provider call, calibration result or end-to-end speed gain is claimed.

## Validation and handoff

Local validation passed: JSON and M3 hash reconstruction; 24 unique IDs and named
tests in six exact suite contents; 23 source blob bindings; 12/12 split and five
cluster consistency; null outcome fields; 113 local links; and diff hygiene.
Exact-head CI and publication evidence belong in the PR, not volatile TASKS fields.
The existing main does not yet contain this proposal or the M7–M10 task additions.

Known limits: the manifest is an input inventory, not executable measurement
data; dependency-lineage closure, runtime evidence and a separately scoped
materialization adapter are still needed. M10 acceptance remains pending.

Next concrete step after contract review: implement a bounded offline adapter
that materializes the development split using the existing M5/M8/M9 validators
and reports ineligible anchors with reasons. Keep evaluation outcomes sealed
and require the separate live-run budget receipt before any paid inference.
