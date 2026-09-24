# H19 Kit Bundle M6 — Minimal Test Specification Contract

**Status:** frozen before implementation  
**Parent:** M5 Coverage Discovery, PR #555, exact green head `32f0bda2296af99ec8720b9be43438268d16b7e2`  
**Roadmap sync:** PR #559, exact green head `96eb4ec48e5ef347c4522bf54f666f2649fac38f`

## Goal

Translate one eligible M5 coverage hypothesis into a deterministic, machine-readable **minimal test specification**.

M6 does **not** generate executable test code.

## Inputs

Required:

- frozen M5 discovery packet with `packetSha256`;
- one `hypothesisId` present in that packet.

Optional deterministic hints may be supplied by upstream/native evidence, but M6 must never invent missing behavior.

## Eligibility

A hypothesis may enter M6 when either:

1. its M5 priority is `high`; or
2. a validation result bound to the same packet/hypothesis is `confirmed`.

A `rejected` validation result makes the hypothesis ineligible.

An `inconclusive` result does not promote a non-high-priority hypothesis.

## Output contract

Every specification contains:

- `schemaVersion`;
- `packetSha256`;
- `hypothesisId`;
- source target;
- hypothesis reason/priority/evidence IDs;
- validation status;
- `setup`;
- `action`;
- `expectedInvariant`;
- `requiredObservations`;
- mutation identity when present;
- `readiness`;
- deterministic `specSha256`.

### Section state

Each required semantic section is explicit:

```json
{
  "state": "known | unknown",
  "items": [],
  "reason": null
}
```

Rules:

- `known` requires at least one non-empty item;
- `unknown` requires a non-empty reason;
- missing evidence becomes `unknown`, never fabricated content.

## Mutation preservation

For `surviving-mutant` hypotheses:

- `mutationId` must be preserved;
- `mutatorId` must be preserved;
- preferred validation remains `test-that-kills-mutant`;
- mutation identity contributes to the specification hash.

If mutation identity required by the frozen hypothesis is malformed/missing, the spec is invalid.

## Readiness

`readiness.readyForExecutableGeneration` is true only when all are true:

- setup is known;
- action is known;
- expected invariant is known;
- at least one required observation is known;
- hypothesis is eligible;
- mutation identity is valid when required.

Otherwise the specification remains useful but explicitly incomplete.

No downstream code generator may treat an incomplete specification as executable authority.

## Determinism

Same:

- frozen packet;
- hypothesis;
- validation result;
- deterministic hints;
- M6 schema version

must produce the same `specSha256`.

Timestamps are not part of the hash.

## Fail-closed rules

M6 must reject:

- packet without `packetSha256`;
- unknown hypothesis ID;
- validation result bound to another packet/hypothesis;
- rejected hypothesis;
- malformed section states;
- malformed surviving-mutant identity.

M6 must not convert:

- coverage gap → bug;
- reference → caller;
- unknown behavior → guessed setup/action/assertion.

## Acceptance gates

M6 passes only if all are true:

**G1 — provenance**
- output retains exact packet SHA and hypothesis ID.

**G2 — determinism**
- identical input produces identical spec SHA.

**G3 — unknown discipline**
- absent hints produce explicit unknown sections, not invented values.

**G4 — readiness**
- incomplete specs cannot become executable-ready.

**G5 — mutation preservation**
- surviving-mutant identity survives round-trip exactly.

**G6 — validation binding**
- mismatched/rejected validation records fail closed.

**G7 — regression**
- exact-head CI passes M0→M6 smoke chain.

## Non-goals

M6 does not:

- write Jest/Pytest/SQL/Go/Rust test code;
- choose an LLM;
- run Jev;
- mutate production source;
- claim a discovered hypothesis is a real defect;
- modify H19s.

## Next gate after M6

Only after M6 is exact-head CI-green may the bundle define a separate gate for:

**Executable Test Generation + execution-based validation**

That future gate must prove generated tests actually execute and distinguish the intended behavior before permanent promotion.
