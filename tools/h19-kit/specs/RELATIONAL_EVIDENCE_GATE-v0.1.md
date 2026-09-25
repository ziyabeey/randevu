# Relational Evidence Gate v0.1

**Status:** frozen before implementation  
**Parent:** joined H19 M7 + project-scoped evidence-graph base, PR #588 exact-head CI-green at `1e485164350cfa6b43d2a36aac8bafff30fc9c5e`  
**Purpose:** turn multiple H19 evidence signals into a deterministic relational case that Jev may classify as an **advisory** second signal without receiving execution authority.

This gate does not ask Jev for an overall risk score and does not let Jev invent measurements.

## 1. Why this gate exists

M5–M7 can already produce useful but separate observations:

- surviving mutants;
- runtime coverage gaps or unknown coverage;
- temporal/historical coupling;
- dependency and blast-radius evidence;
- validated coverage hypotheses;
- deterministic test specifications;
- executable test candidates.

A list of facts is weaker than a measured relationship between facts.

For example, "4 surviving mutants" is one observation. "Mutation escape is 3.2× its own historical baseline while test density is below its baseline and the signals come from independent lineages" is a stronger, auditable statement.

The relational layer therefore separates:

```text
facts
  ↓
deterministic normalization + baseline math
  ↓
relational case
  ↓
bounded Jev choice
  ↓
advisory judgment
  ↓
later external outcome
  ↓
calibration evidence
```

## 2. Core split: math belongs to H19, semantic comparison belongs to Jev

H19 deterministically owns:

- counts;
- rates;
- ratios where dimensions are explicitly compatible;
- baseline deltas;
- lift;
- sample size;
- lineage overlap;
- independent evidence-family counts;
- content/provenance hashes.

Jev may answer only a bounded semantic question over frozen inputs.

Jev MUST NOT be asked to calculate a ratio, invent a baseline, estimate sample size or turn its own confidence into a probability of a bug.

## 3. Normalized evidence fact

Every fact in a relational case MUST bind:

- stable `factId`;
- evidence family;
- `present | absent | unknown` state;
- metric identity;
- scalar value or `null`;
- unit;
- optional denominator;
- optional sample size;
- optional baseline with its own sample size/source;
- lineage IDs;
- producer/version/input/source provenance;
- provenance digest.

Unknown is first-class.

`unknown` MUST NOT be coerced to:

- zero;
- false;
- absent;
- baseline;
- neutral evidence.

## 4. Evidence lineage and false amplification

Two observations derived from the same underlying input are not independent votes.

Examples:

- a coverage-gap fact and a missing-test-target fact derived from the same coverage report;
- two findings emitted by the same mutation observation;
- duplicated evidence passed through two adapters.

The relational layer MUST preserve `lineageIds`.

Agreement strength is counted by independent families/lineages, not raw fact count.

Jev is explicitly told when evidence shares lineage and MUST NOT treat shared lineage as independent confirmation.

## 5. Comparable metrics

The engine MUST NOT divide arbitrary dimensionless-looking scores.

A ratio is valid only when the metric definition declares the operands compatible or when the ratio is intrinsic to the metric, such as:

```text
surviving mutants / executed mutants
covered impacted references / impacted references
validated hypotheses / attempted validations
```

Cross-family comparison should normally be expressed through each metric's own baseline-relative feature, not by dividing unrelated scores.

For example:

```text
mutation escape lift = current mutation escape rate / historical mutation escape rate
test density lift     = current test density / historical test density
```

Those two lifts may then participate in a relational case.

## 6. Deterministic feature set v0.1

The frozen v0.1 feature vocabulary is:

- `rate`;
- `ratio`;
- `lift`;
- `baseline-delta`;
- `agreement-count`;
- `contradiction-count`;
- `independent-family-count`;
- `lineage-overlap`.

A feature is explicitly `known` or `unknown`.

Division by zero, missing denominators or missing baselines produce `unknown`, never Infinity/NaN and never a guessed replacement.

Every feature records its source fact IDs and observed sample size when applicable.

## 7. Relational case scope

A v0.1 relational case binds exactly one frozen M5 hypothesis and between **2 and 4** normalized facts.

The case binds:

- M5 `packetSha256`;
- `hypothesisId`;
- hypothesis reason/priority;
- source revision;
- normalized facts;
- deterministic features;
- optional Jev judgment;
- external outcome state;
- `authority: advisory`;
- content-addressed `caseSha256`.

The case hash is:

```text
caseSha256 = sha256(stableJson(case without caseSha256) + "\n")
```

No wall-clock timestamp participates in the hash.

## 8. Jev question contract

The first allowed Jev question is `RELATION_DIRECTION-v0.1`.

It is a choice question.

### Instructions

Given one frozen hypothesis, 2–4 normalized facts and deterministic features, decide how considering the facts **together** changes support for the frozen hypothesis compared with considering the supplied facts independently.

Do not infer missing facts. Do not calculate new metrics. Do not treat shared-lineage facts as independent confirmation.

### Choices

- `strengthens` — the supplied combination adds mutually reinforcing support beyond the facts considered independently;
- `weakens` — the combination introduces a contradiction or materially undercuts support;
- `unrelated` — the relationship does not materially change support for the hypothesis;
- `insufficient` — unknowns, incompatible metrics, lineage ambiguity or missing evidence prevent a justified relation judgment.

No free-form verdict is authoritative.

The model/provider may return its native confidence field. H19 records this as `providerConfidence`, not as a probability that the hypothesis is true.

## 9. Jev answer binding

An answered Jev judgment MUST bind:

- provider;
- exact model;
- question ID;
- question version;
- canonical input SHA-256;
- choice;
- provider confidence;
- canonical answer SHA-256.

Malformed choices, missing model identity or input mismatch fail closed.

A provider/API error may be recorded as an error judgment, but it contributes no relation direction and never fails the deterministic H19 pipeline.

## 10. Content-addressed replay

The Jev call identity is a pure key over:

```text
model
+ questionId/questionVersion
+ canonical relational input digest
```

If a stored answer exists for that exact key, replay reads the stored answer.

This is how a nondeterministic external model becomes deterministic from H19's point of view for an already observed input.

A new model version or question version creates a new key and is never silently substituted.

## 11. Outcome binding and calibration

A Jev judgment is not allowed to validate itself.

A later outcome must come from an external evidence source, for example:

- frozen M5 validation;
- mutation execution;
- future executable-test run;
- bounded human review.

The frozen outcome vocabulary is:

- `confirmed`;
- `rejected`;
- `inconclusive`;
- `mutant-killed`;
- `mutant-survived`;
- `test-pass`;
- `test-fail`;
- `regression-found`;
- `no-regression`.

An unobserved case remains `unobserved`.

Once an external outcome exists, H19 may derive calibration records containing at minimum:

- model;
- question version;
- Jev choice;
- provider confidence;
- external outcome;
- evidence family combination;
- sample count.

The first implementation MUST NOT invent a confidence threshold from another domain.

In particular, DE-JEV-R0's measured `0.9` flag threshold is evidence about R0 receipt parsing only and is not inherited by H19 relational evidence.

## 12. Authority boundary

All v0.1 Jev output is advisory.

It MUST NOT directly:

- call `route()`;
- change a finding action;
- write a test;
- execute a test;
- kill/promote a mutant;
- merge a PR;
- change H19s routing;
- mark a hypothesis confirmed/rejected.

Deterministic policy remains the only action authority.

## 13. Acceptance gates

Implementation may receive a Bundle number only after this frozen gate is CI-green.

### RE1 — provenance binding

Changing a fact value, lineage, producer/version, source revision, M5 packet or hypothesis changes the case hash.

### RE2 — deterministic replay

Identical frozen inputs produce byte-identical facts/features and `caseSha256`.

### RE3 — unknown preservation

Unknown values/baselines/denominators remain unknown and never become zero/false/neutral.

### RE4 — dimension safety

Invalid cross-metric ratios are rejected or represented as unknown. Compatible declared ratios reproduce exactly.

### RE5 — lineage safety

Facts with shared lineage do not increase independent-family count merely because there are multiple fact records.

### RE6 — bounded Jev output

Only `strengthens | weakens | unrelated | insufficient` is accepted for `RELATION_DIRECTION-v0.1`.

### RE7 — Jev provenance

Model, provider, question version and exact input digest are mandatory for an answered judgment. Input mismatch is rejected.

### RE8 — model failure isolation

Missing API key, timeout or provider error produces no authoritative relation and does not change deterministic H19 output.

### RE9 — no naive averaging

Contradictory facts remain represented as contradictions. The core does not hide disagreement by averaging unrelated evidence into one generic score.

### RE10 — external outcome only

A Jev answer cannot be used as its own outcome/label. Calibration requires independently bound evidence.

### RE11 — authority isolation

Adding/removing/changing a Jev judgment does not change deterministic dispatcher authority in v0.1.

### RE12 — no H19s crossover

The gate reads no H19s cohort/routing state and changes no H19s protocol files.

## 14. Non-goals

v0.1 does not:

- generate an overall risk score;
- claim correlation is causation;
- learn online and change policy during the same run;
- rank all hypotheses in a tournament;
- choose the next experiment by information gain;
- auto-promote Jev confidence thresholds;
- execute M7 candidates;
- change production code;
- change H19s.

Pairwise hypothesis tournaments, calibrated ranking and information-gain experiment selection require later gates after relational outcomes accumulate.

## 15. Promotion rule

Only after this contract and schema are committed and exact-head CI-green may the implementation milestone be named Bundle M8.

The implementation inherits RE1–RE12 unchanged.
