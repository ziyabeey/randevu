# Relational Case Composer Gate v0.1

**Status:** frozen before implementation  
**Parent:** Bundle M8 Relational Evidence Core, PR #590 exact-head CI #2938 SUCCESS at `49f91ea591345ab477228b3c8ce91cbaa30d60c1`  
**Purpose:** deterministically decide **which real H19 facts belong together** in a relational case before any Jev call.

M8 can represent and judge a relational case. It intentionally does not decide which facts should be combined. This gate closes that gap without giving Jev control over evidence selection.

## 1. Non-negotiable split

The composer is deterministic.

Jev MUST NOT:

- select its own evidence;
- choose which hypothesis receives a case;
- choose case size;
- request extra facts during composition;
- expand scope to unrelated files/units;
- resolve evidence lineage.

The flow is:

```text
M4/M5/M6/M7 + mutation/history/coverage outputs
           ↓
normalized scoped fact pool
           ↓
deterministic eligibility
           ↓
deterministic case selection
           ↓
RelationalEvidenceCase
           ↓
optional Jev judgment
```

## 2. Scoped fact envelope

M8's immutable `RelationalEvidenceFact` remains unchanged.

Composition receives a wrapper:

```json
{
  "fact": { "...": "M8 normalized fact" },
  "scope": {
    "kind": "hypothesis | semantic-unit | path | related-path",
    "hypothesisId": null,
    "path": null,
    "unitId": null,
    "relationDigest": null
  }
}
```

The wrapper is composition metadata. It is not silently injected into the M8 fact.

### scope rules

- `hypothesis`: exact frozen M5 hypothesis ID is required.
- `semantic-unit`: exact path + unit ID are required.
- `path`: exact repository path is required.
- `related-path`: exact repository path + a deterministic M4 relationship digest are required.

There is no `global` scope in v0.1.

A repository-wide metric may be useful later, but it cannot enter a hypothesis relation merely because it exists.

## 3. Eligible facts for a hypothesis

Given frozen hypothesis H with target path P and optional unit U, a fact is eligible only when one of these is true, in descending scope strength:

1. **exact-hypothesis**: wrapper hypothesis ID = H.id;
2. **exact-unit**: H has U and wrapper path = P and wrapper unitId = U;
3. **exact-path**: wrapper path = P;
4. **explicit related-path**: wrapper path is connected to P by a relationship already present in the frozen M4/M5 input and `relationDigest` validates that exact relation.

String similarity, directory proximity, naming similarity and model inference are not scope evidence.

## 4. Required anchor

Every composed case MUST contain at least one anchor fact explaining why the M5 hypothesis exists.

Reason → anchor family:

- `surviving-mutant` → `mutation`;
- `explicit-runtime-coverage-gap` → `coverage`;
- `unknown-runtime-coverage-on-impacted-reference` → `coverage`;
- `historical-companion-not-changed` → `history`.

The anchor must be exact-hypothesis, exact-unit or exact-path scoped.

A related-path fact cannot satisfy the required anchor by itself.

If the required anchor is missing, no case is emitted.

## 5. Independence floor

A relational case is emitted only if:

- at least 2 eligible facts exist;
- at least 2 evidence families are represented;
- the selected facts contain an M8 `independent-family-count >= 2`.

This prevents "two differently named views of the same observation" from becoming a Jev relation case.

Shared-lineage facts may remain eligible for context, but they do not satisfy the independence floor.

## 6. One case per hypothesis in v0.1

The composer emits at most **one** case for each M5 hypothesis.

There is no Cartesian product of all eligible fact pairs/triples.

This is the main combinatorial safety rule.

Later gates may compare alternate cases only after v0.1 outcomes establish that doing so has information value.

## 7. Deterministic selection objective

For each hypothesis, consider eligible subsets of size 2–4 that:

- include the required anchor;
- satisfy the independence floor.

Choose the unique subset maximizing this lexicographic objective:

1. highest M8 `independent-family-count`;
2. highest number of distinct evidence families;
3. smallest case size;
4. highest scope-strength sum;
5. lowest lineage-overlap count;
6. lexicographically smallest ordered `factId` list.

Scope strength is frozen:

```text
exact-hypothesis = 4
exact-unit       = 3
exact-path       = 2
related-path     = 1
```

This order deliberately places minimality before scope-strength sum. Otherwise every redundant eligible fact would add positive scope points and make the "smallest case" rule unreachable for supersets.

No learned or Jev-derived weight participates in selection.

## 8. Batch ordering and cap

The composer operates over one frozen M5 packet.

Cases are ordered by:

1. M5 priority: high, medium, low;
2. M5 hypothesis ID.

Maximum emitted cases per batch: **20**.

If more than 20 hypotheses have valid cases:

- emit the first 20 under that ordering;
- mark `truncated=true`;
- record each omitted valid hypothesis as skipped reason `batch-cap`.

The cap is a compute/sampling boundary, not evidence that omitted hypotheses are safe.

## 9. Skipped hypotheses are first-class

Every non-emitted hypothesis records one of:

- `insufficient-eligible-facts`;
- `insufficient-independent-families`;
- `missing-required-anchor`;
- `batch-cap`.

Unknown/insufficient evidence is not silently dropped.

This skipped ledger is part of the batch hash.

## 10. Fact pool immutability and provenance

Composition MUST NOT mutate normalized facts or their provenance.

Duplicate `factId` values with different canonical content are an error.

Identical duplicate facts may be deduplicated by exact canonical content.

Every selected fact must survive byte-equivalent into the resulting M8 case.

## 11. Explicit relation digest for related paths

A `related-path` scope is valid only if its `relationDigest` binds a deterministic relationship record from the frozen input.

Examples:

- temporal-coupling companion relation;
- SCIP/reference blast-radius relation;
- project dependency edge.

The generic composer does not invent related paths.

Tampering with the related-path record or digest makes the fact ineligible/fail closed.

## 12. Batch artifact

The composer emits:

- packet SHA;
- source revision;
- maxCases=20;
- ordered emitted cases;
- ordered skipped records;
- truncation flag;
- `batchSha256`.

```text
batchSha256 = sha256(stableJson(batch without batchSha256) + "\n")
```

No timestamp enters the hash.

## 13. Jev boundary

This gate does not call Jev.

It only produces deterministic M8 cases suitable for a later advisory shadow caller.

This matters scientifically: if Jev selected the evidence that Jev later judged, evaluation would be circular.

## 14. Acceptance gates

### RC1 — exact scope

Unrelated paths/units are never selected without a validated explicit relation.

### RC2 — required anchor

Every emitted case contains the reason-specific direct anchor.

### RC3 — independence floor

No case is emitted below two independent evidence families.

### RC4 — no Cartesian explosion

One hypothesis emits at most one case and each case has 2–4 facts.

### RC5 — deterministic optimum

The same fact pool in any input order produces the same selected facts and case hash.

### RC6 — lineage preference

When two subsets are otherwise equal, lower lineage overlap wins.

### RC7 — minimality

When independence/family objectives tie, the smaller valid case wins before redundant context can gain score merely by adding more scoped facts.

### RC8 — scope preference

Among equally small subsets with equal independence/family objectives, stronger exact scope beats weaker related-path scope.

### RC9 — stable tie-break

Remaining ties are resolved by lexicographic fact IDs only.

### RC10 — batch cap

At most 20 cases are emitted. Overflow is explicit `batch-cap`, never silently lost.

### RC11 — duplicate safety

Conflicting duplicate fact IDs fail closed. Exact duplicates deduplicate deterministically.

### RC12 — source immutability

Composer does not mutate M4/M5 inputs or normalized facts.

### RC13 — no Jev selection

No model/API call exists in composition.

### RC14 — no authority change

Composed cases remain M8 `authority: advisory` and do not affect dispatcher action.

### RC15 — no H19s crossover

Composer imports no H19s routing/cohort state and changes no H19s protocol.

## 15. Non-goals

v0.1 does not:

- generate new facts;
- infer semantic relationships with a model;
- call Jev;
- rank hypotheses by Jev;
- execute M7 candidates;
- choose the next experiment;
- learn selection weights;
- change dispatcher authority;
- modify H19s.

## 16. Promotion rule

Only after this gate is exact-head CI-green may the implementation milestone receive its next Bundle number.

The implementation inherits RC1–RC15 unchanged.
