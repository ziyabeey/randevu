# Test Specification Gate v0.1

**Status:** frozen before implementation  
**Parent:** Bundle M5 — coverage discovery + frozen validation packet  
**Purpose:** convert an eligible M5 coverage hypothesis into a deterministic, provenance-bound **test specification**.

This gate does **not** generate executable test code and does not invoke an LLM.

## 1. Why this gate exists

M5 can say that a change exposes a coverage hypothesis, for example:

- a surviving mutant;
- an explicit runtime coverage gap;
- an unknown runtime-coverage path;
- a historically coupled companion that was not changed.

That is not yet enough to write a trustworthy regression test.

The next layer must say what a validating test would need to do without inventing missing domain semantics.

```text
M5 hypothesis
    ↓
eligibility
    ↓
versioned recipe / explicit evidence
    ↓
minimal test specification
    ↓
readyForExecution true|false
```

## 2. Eligible inputs

A hypothesis is eligible for this v0.1 gate when **either**:

1. it is a `surviving-mutant` hypothesis with a recorded `mutationId` and `mutatorId`; or
2. it has a frozen M5 validation result with status `confirmed`.

A validation result with status `rejected` is ineligible.

An `inconclusive` result is not promoted by this gate.

Other unvalidated coverage hypotheses stay in M5 and are not silently promoted.

## 3. Frozen bindings

Every specification MUST bind to:

- M5 `packetSha256`;
- `hypothesisId`;
- `sourceRevision` from the packet;
- exact target path/unit;
- source evidence IDs;
- optional recipe ID/version/digest when a recipe is used;
- validation-result digest when a confirmed validation result is used for eligibility.

The validation-result digest is:

```text
validationDigest = sha256(stableJson(validationResult) + "\n")
```

Changing any binding changes the specification hash.

## 4. Specification fields

The minimal specification has five semantic sections:

1. **setup**
2. **action**
3. **expected invariant**
4. **mutation to kill**
5. **required observations**

Each semantic section is explicitly either:

- `known`; or
- `unknown`.

Unknown is first-class and MUST NOT be filled with a plausible guess.

### setup

Preconditions/fixtures required before the action.

### action

The operation the validating test must perform.

### expected invariant

The observable property that must remain true.

This is not automatically the same thing as a mutation description.

### mutation to kill

For a surviving-mutant hypothesis this MUST be known and MUST exactly preserve the frozen:

- `mutationId`;
- `mutatorId`.

For confirmed non-mutant hypotheses it may be `unknown`.

### required observations

What the future executable test must inspect to decide whether the invariant held.

Examples of observation categories include return value, persisted state, emitted event, version, lock/serialization outcome or external effect. These are examples only; the generic core does not infer them without evidence/recipe input.

## 5. Versioned recipe contract

A domain adapter MAY supply a deterministic recipe.

A recipe is data, not model reasoning, and has at minimum:

```json
{
  "recipeId": "booking.capacity-boundary",
  "version": "1",
  "digest": "<sha256>",
  "matches": {
    "reason": "surviving-mutant",
    "mutatorId": "boundary.flip"
  },
  "setup": ["..."],
  "action": "...",
  "expectedInvariant": "...",
  "observations": ["..."]
}
```

A recipe MUST be versioned and content-addressed.

Its digest is defined as:

```text
recipe.digest = sha256(stableJson(recipe without digest) + "\n")
```

The digest field is never hashed into itself.

The generic core may compose recipe fields with frozen M5 metadata. It may not extrapolate fields that the recipe does not provide.

## 6. readyForExecution

`readyForExecution=true` only when all required execution fields are known:

- setup;
- action;
- expected invariant;
- required observations.

For a surviving-mutant hypothesis, mutation-to-kill must also be known.

Otherwise:

`readyForExecution=false`

and the missing sections are listed in `unknowns`.

A partial specification is a valid output. A partial specification is not an executable-test authorization.

## 7. Determinism

Given identical:

- packet;
- hypothesis selection;
- validation result;
- recipe;
- gate/schema version;

the canonical specification and `specSha256` MUST be byte-for-byte stable.

The hash is defined as:

```text
specSha256 = sha256(stableJson(specification without specSha256) + "\n")
```

The `specSha256` field is therefore never hashed into itself.

No wall-clock timestamp participates in the specification hash.

## 8. No-fabrication rule

Every `known` semantic section MUST contain a non-empty value/items payload and MUST be traceable to at least one of:

- frozen M5 hypothesis metadata;
- frozen validation result;
- frozen mutation metadata;
- versioned domain recipe;
- deterministic repository evidence explicitly passed into the builder.

If provenance cannot be stated, the section is `unknown`.

## 9. Fail-closed behavior

The builder MUST reject:

- packet hash mismatch;
- unknown hypothesis ID;
- rejected hypothesis promotion;
- surviving-mutant hypothesis without mutation ID/mutator ID;
- recipe whose declared match does not match the hypothesis;
- invalid recipe digest/version;
- attempt to mark an incomplete specification `readyForExecution=true`.

## 10. Acceptance gates

Implementation may be promoted only if all gates pass.

### TS1 — binding integrity

Changing packet SHA, hypothesis ID, source revision, target or recipe identity changes the spec hash.

### TS2 — deterministic replay

Two independent builds from identical frozen inputs produce the same canonical object and `specSha256`.

### TS3 — no fabrication

Missing setup/action/invariant/observations remain `unknown`; the builder does not synthesize prose.

### TS4 — readiness

Incomplete spec → `readyForExecution=false`.

Complete provenance-backed spec → `readyForExecution=true`.

### TS5 — mutant preservation

For surviving-mutant hypotheses, `mutationId` and `mutatorId` survive unchanged into the specification.

### TS6 — validation state

- confirmed hypothesis → eligible;
- rejected hypothesis → rejected by builder;
- inconclusive hypothesis → not promoted;
- surviving-mutant → eligible without a separate confirmed result because the surviving mutant itself is the runtime observation being targeted.

### TS7 — packet immutability

The builder never mutates the M5 packet or validation result.

### TS8 — no executable generation

The v0.1 gate emits specification data only. It MUST NOT write or modify repository test files.

## 11. Non-goals

This gate does not:

- generate test source code;
- claim a hypothesis is a bug;
- run mutation testing;
- choose a test framework;
- invoke Jev or another model;
- change H19s;
- promote unknown domain semantics into prose.

## 12. Promotion rule

Only after this contract is committed and CI-green may the implementation milestone receive its Bundle number and begin.

The implementation milestone inherits this file without changing TS1–TS8.
