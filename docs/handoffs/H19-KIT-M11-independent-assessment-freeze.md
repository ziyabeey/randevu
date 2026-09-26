# H19 Kit M11 independent relation-assessment freeze

Task: **H19-KIT-M11-INDEPENDENT-FREEZE**. Owner: Codex + coordinator. Date: 2026-09-25.

## Purpose

Freeze the first blind independent-relation assessment inputs for the three unique
development M9 cases produced by the M11 observation bridge, without collecting
labels and without exposing provider/Jev output, later functional outcomes or the
held-out evaluation observations.

Parent evidence:
- notification behavioral validation PR #614 exact head `429a44a31083d0a2cadac9e26ba0d0aae6eae49e`;
- exact-head CI #2999 attempt 2 SUCCESS;
- committed notification result replayed deterministically; empirical lane skipped.

This slice creates assessment inputs only. It does **not** claim independent
agreement, relation accuracy, calibration, functional defects or M12 readiness.

## Frozen packets

Artifact:
`tools/h19-kit/experiments/m11/independent-assessment-001/FREEZE.json`.

The artifact contains exactly three packets copied byte-for-structure from the
three unique relational cases in `supplement-001/BRIDGE.json`:

1. `M11-BLIND-001` — case
   `2b924bfe4d9dc5e15d40199189b6b8070bee47d2cca3dc68eb24357f660e33f2`,
   notification coverage hypothesis.
2. `M11-BLIND-002` — case
   `998d3c0f62199184d8f9c8b86474d6af8f9177db471d06fe2bfc654ffef75113`,
   outbound-request coverage hypothesis.
3. `M11-BLIND-003` — case
   `bf214c9fa35b06b906c149fb8415549040131aa33b91a1c1c9b582ad915c39ad`,
   pagination coverage hypothesis.

All remain development evidence at product revision
`07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.

## Assessment contract

Rubric is exactly `RELATION_DIRECTION` v0.1 with four allowed labels:
`strengthens`, `weakens`, `unrelated`, `insufficient`.

Each case requires **two separately sourced assessments**. An assessor receives
only the frozen relational case plus the frozen relation rubric.

Before sealing its own receipt, an assessor must not see:
- Jev/provider judgments or probability vectors for that case;
- later functional validation/outcome evidence for that case;
- another assessor's label or rationale;
- evaluation-split observations.

A receipt records case/packet identity, assessor identity/kind, rubric identity,
one four-class label, a brief case-bound rationale, an exposure declaration and
seal time. Disagreement is retained and adjudicated separately. `unresolved`
is an adjudication state, not a fifth relation label.

## Freeze validation

`test/m11-independent-assessment-freeze.mjs` checks that:
- the rubric equals the implementation's exact `RELATION_DIRECTION_QUESTION`;
- the three packets equal the three bridge cases;
- every relational case passes the existing validator;
- packet count and IDs are fixed;
- required exposure flags are false;
- judgment/probability/validation/outcome/provider fields cannot leak into packets;
- known later-result identifiers cannot appear in blind packet bytes.

CI runs this smoke as part of the ordinary code gate.

## Boundaries and next step

Labels collected in this slice: **0**.

No Jev call, provider request, paid call, functional execution, evaluation
execution, product mutation or M12 selection authority is introduced.

After this freeze receives exact-head CI, the next executable step is to obtain
two genuinely separate sealed assessment receipts for each packet. Those receipts
must be collected without using the current implementer identity as a substitute
for an independent assessor. Only after both receipts are sealed may disagreement
adjudication and later provider-output joining begin.
