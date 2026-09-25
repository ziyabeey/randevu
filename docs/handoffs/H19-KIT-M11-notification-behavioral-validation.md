# H19 Kit M11 notification behavioral validation

Task: **H19-KIT-M11-NOTIFICATION**. Owner: Codex + coordinator. Date: 2026-09-25.

## Purpose

Validate the useful behavioral target selected after the M11 development supplement without changing product runtime code or converting development evidence into an independent relation judgment.

Target case: `2b924bfe4d9dc5e15d40199189b6b8070bee47d2cca3dc68eb24357f660e33f2`.

Hypothesis: `coverage:explicit-runtime-coverage-gap:worker_notifications.ts`.

Target source: `worker/notifications.ts`.

Original uncalled entries:
- `validGroupSummary`
- `renderTemplateV2`

The legacy `rejectBoundary` no-op initializer was deliberately not promoted into a manufactured behavioral test.

## Frozen contract

Product source revision: `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.

Plan SHA-256: `9478ae5199235075f1b142fab20de20222aa150a29a68c856239da1008855e3c`.

Runtime: Node `v24.21.0`.

The first CI attempt stopped before empirical execution because the originally frozen runtime no longer matched the hosted Node 24 patch version. No scenario ran and no empirical artifact was retained. The plan was refrozen before execution; candidate, product and producer bytes were unchanged.

The retained validation uses six predeclared controls, fake RPC/provider transport, isolated source materialization and target-scoped V8 coverage. It performs no real provider delivery, paid model call, evaluation execution or product mutation.

## Retained empirical result

CI #2995 executed the candidate exactly once and uploaded `h19-m11-notification-validation-001`.

Committed artifact:
`tools/h19-kit/experiments/m11/notification-validation-001/RESULT.json`.

Identities:
- result SHA-256: `0cf55fb091f93b96ad40443e61b12265408201bcdd3ef872c3c79b01827ffb8c`
- observation SHA-256: `21287dd226610ecd7ced23c4caaeffe3963f3d1268bb3558bfd30bbc9bd2a443`
- outcome SHA-256: `d322986a41d928e4531c19d3a42b43c92ab4a186096d360837f7b9024a1c3b82`

Observed:
- six of six behavioral controls passed;
- `validGroupSummary` was observed and called;
- `renderTemplateV2` was observed and called;
- M5 validation status: `confirmed`;
- functional defects established: 0;
- independent relation assessments: 0;
- real provider calls: 0.

The result confirms the previously measured suite-scoped coverage gap and that the frozen behavioral candidate exercises both original uncalled entries. It does not establish a product defect or an independent relational label.

## Saved-result replay

Once `RESULT.json` exists, the empirical CI lane is ineligible. CI instead runs a saved-result replay that:

1. validates the frozen plan and source lineage;
2. reinterprets the retained run through the current M11 notification interpreter;
3. requires the complete recomputed result to equal the committed result;
4. requires the confirmed M5 outcome, 6/6 controls and both original gap calls;
5. rejects modified run bytes through the sealed observation identity.

This makes the empirical observation single-execution evidence rather than a repeatedly regenerated measurement.

## Boundaries and next gate

This remains one development case in one connected component. Repeated anchors are not independent trials. The same development side authored the candidate, so relation assessment remains explicitly non-independent.

No M12 authority is activated here. The remaining M11 gate is to define and satisfy an independently sourced assessment/comparison budget without contaminating the held-out evaluation split or relabeling this development result as independent evidence.
