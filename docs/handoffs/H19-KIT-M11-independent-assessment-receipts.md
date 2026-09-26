# H19 Kit M11 independent assessment receipt contract

Task: **H19-KIT-M11-INDEPENDENT-RECEIPTS**. Owner: Codex + coordinator. Date: 2026-09-25.

## Purpose

Define a sealed append-only receipt format for blind M11 relation assessments
before collecting any real assessor label.

Parent freeze: PR #615, branch
`h19-kit-m11-independent-assessment-freeze`, exact head
`5208f40a3b0cfe14d33c05ea47ff0183c562c097`, CI #3000 SUCCESS.

This slice adds validator/runtime support only. It does not create empirical
assessment receipts, does not adjudicate a relation label and does not make a
claim that any assessor is independent.

## Receipt identity

`src/experiments/m11-independent-assessment.mjs` binds each receipt to:

- one frozen packet id and exact case SHA;
- the exact `RELATION_DIRECTION` v0.1 input digest;
- source revision and bridge identity;
- assessor id and assessor kind;
- one of `strengthens | weakens | unrelated | insufficient`;
- a bounded case-only rationale;
- the four exposure declarations, all false;
- a seal timestamp;
- a deterministic SHA-256 receipt identity.

The validator rejects packet/case/input/rubric/lineage drift and any changed
receipt bytes.

## Structural ledger boundary

The ledger may report that two distinct assessor IDs supplied receipts for a
packet. It deliberately does **not** infer that the assessors are substantively
independent and deliberately does **not** resolve a reference label.

Even with two structurally valid receipts:

- `independenceVerified` remains `false`;
- `resolvedReferenceLabel` remains `null`;
- `independenceVerifiedPackets` remains 0;
- `resolvedReferenceLabels` remains 0.

Assessor independence and disagreement adjudication therefore require a separate
evidence step. Hashes and duplicate-ID checks are provenance controls, not truth.

## Validation

`test/m11-independent-assessment-receipts.mjs` uses synthetic in-memory fixtures
only. No fixture is stored as empirical evidence.

The smoke verifies:
- deterministic receipt sealing and replay;
- exact case/input/rubric/lineage binding;
- false-only exposure declarations;
- invalid/tampered receipt rejection;
- unknown packet rejection;
- one receipt per assessor per packet;
- source/bridge drift rejection;
- two distinct receipts do not automatically become an independent truth label.

## Boundaries and next action

Real labels collected: **0**.

No provider/Jev call, Claude Routine fire, product execution, evaluation
execution, paid call or M12 authority is introduced.

The existing R1/R2 development-review routines are not used as reference-label
collectors because they operate on PR review context and may see repository/diff/CI
state outside the blind packet. The next evidence step must collect receipts from
assessors whose allowed exposure can actually be controlled and documented.
