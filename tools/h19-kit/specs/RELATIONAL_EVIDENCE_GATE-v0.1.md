# Relational Evidence Gate v0.1

**Status:** frozen before implementation  
**Parent:** joined H19 M7 + project-scoped evidence-graph base, PR #588 exact-head CI-green at `1e485164350cfa6b43d2a36aac8bafff30fc9c5e`  
**Purpose:** turn multiple H19 evidence signals into deterministic relational evidence that Jev may classify as an **advisory** second signal without receiving execution authority.

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

The relational layer separates:

```text
frozen facts
  ↓
deterministic normalization + baseline math
  ↓
RelationalEvidenceCase
  ↓
bounded Jev choice
  ↓
JevRelationalJudgment
  ↓
later independent observation
  ↓
RelationalOutcome
  ↓
calibration evidence
```

These are three immutable artifacts. A later Jev answer or outcome never mutates the original case identity.

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

In v0.1, a fact's `value` is the canonical value emitted by that metric's deterministic producer. An optional `denominator` records sample/context information; the generic relational core MUST NOT assume that `value / denominator` is the intended rate. A `rate` feature is accepted only from the deterministic metric definition/producer that owns that metric. Generic cross-fact ratio helpers may operate only on identical `metricId` values in v0.1.

For example:

```text
mutation escape lift = current mutation escape rate / historical mutation escape rate
test density lift     = current test density / historical test density
```

Those two lifts may then participate in one relational case.

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

## 7. Artifact A — RelationalEvidenceCase

A v0.1 case binds exactly one frozen M5 hypothesis and between **2 and 4** normalized facts.

It binds:

- M5 `packetSha256`;
- `hypothesisId`;
- hypothesis reason/priority;
- source revision;
- normalized facts;
- deterministic features;
- `authority: advisory`.

Its immutable identity is:

```text
caseSha256 = sha256(stableJson(case without caseSha256) + "\n")
```

No Jev answer, provider error or later outcome is included in this hash.

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

## 9. Artifact B — JevRelationalJudgment

A Jev judgment references the immutable `caseSha256`.

An answered judgment MUST bind:

- provider;
- exact model;
- question ID `RELATION_DIRECTION`;
- question version `0.1`;
- canonical input SHA-256;
- bounded choice;
- provider confidence.

A provider/API error is also a frozen judgment artifact, with:

- exact case/model/question/input binding;
- no choice;
- no confidence;
- bounded error code.

The immutable identity is:

```text
judgmentSha256 = sha256(stableJson(judgment without judgmentSha256) + "\n")
```

Malformed choices, missing model identity or input mismatch fail closed.

A provider error contributes no relation direction and never changes deterministic H19 output.

## 10. Content-addressed replay

The Jev call identity is a pure key over:

```text
model
+ questionId/questionVersion
+ canonical relational input digest
```

If a stored judgment exists for that exact key, replay reads the stored judgment.

This is how a nondeterministic external model becomes deterministic from H19's point of view for an already observed input.

A new model version or question version creates a new key and is never silently substituted.

## 11. Artifact C — RelationalOutcome

A Jev judgment is not allowed to validate itself.

A later outcome references:

- immutable `caseSha256`;
- optional exact `judgmentSha256`;
- observed source revision;
- external outcome kind;
- external outcome value;
- content digest of the independent source.

Allowed external kinds:

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

The immutable identity is:

```text
outcomeSha256 = sha256(stableJson(outcome without outcomeSha256) + "\n")
```

No outcome exists until an independent observation exists. Absence of an outcome is not a negative label.

## 12. Calibration

Once an independent outcome exists, H19 may derive calibration records containing at minimum:

- model;
- question version;
- Jev choice;
- provider confidence;
- external outcome;
- evidence family combination;
- sample count.

The first implementation MUST NOT invent a confidence threshold from another domain.

In particular, DE-JEV-R0's measured `0.9` flag threshold is evidence about R0 receipt parsing only and is not inherited by H19 relational evidence.

Provider confidence is an observed model field. It is not treated as calibrated probability until H19 has measured that mapping on this task.

## 13. Authority boundary

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

## 14. Acceptance gates

Implementation may receive a Bundle number only after this frozen gate is CI-green.

### RE1 — case provenance binding

Changing a fact value, lineage, producer/version, source revision, M5 packet or hypothesis changes `caseSha256`.

### RE2 — deterministic replay

Identical frozen case inputs produce byte-identical facts/features and `caseSha256`.

### RE3 — unknown preservation

Unknown values/baselines/denominators remain unknown and never become zero/false/neutral.

### RE4 — dimension safety

Invalid cross-metric ratios are rejected or represented as unknown. Compatible declared ratios reproduce exactly.

### RE5 — lineage safety

Facts with shared lineage do not increase independent-family count merely because there are multiple fact records.

### RE6 — bounded Jev output

Only `strengthens | weakens | unrelated | insufficient` is accepted for `RELATION_DIRECTION-v0.1`.

### RE7 — judgment provenance

Model, provider, question version, exact case hash and input digest are mandatory. Input/case mismatch is rejected.

### RE8 — model failure isolation

Missing API key, timeout or provider error produces no authoritative relation and does not change the immutable case or deterministic H19 output.

### RE9 — no naive averaging

Contradictory facts remain represented as contradictions. The core does not hide disagreement by averaging unrelated evidence into one generic score.

### RE10 — external outcome only

A Jev judgment cannot be used as its own outcome/label. `RelationalOutcome` requires independently bound source evidence.

### RE11 — authority isolation

Adding/removing/changing a Jev judgment or outcome does not change deterministic dispatcher authority in v0.1.

### RE12 — immutable artifact chain

Creating a judgment does not alter `caseSha256`; creating an outcome does not alter either `caseSha256` or `judgmentSha256`.

### RE13 — no H19s crossover

The gate reads no H19s cohort/routing state and changes no H19s protocol files.

## 15. Non-goals

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

## 16. Promotion rule

Only after this contract and its three schemas are committed and exact-head CI-green may the implementation milestone be named Bundle M8.

The implementation inherits RE1–RE13 unchanged.
