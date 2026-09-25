# Relational Judgment Batch Gate v0.1

**Status:** frozen before implementation  
**Parent:** Bundle M9 Relational Case Composer, PR #592 exact-head CI SUCCESS at `440a8b2de05bddec1617600a3187c5c229c1c072`  
**Purpose:** deterministically bind a frozen M9 case batch to bounded, replayable Jev relation judgments without giving Jev evidence-selection or action authority.

M8 already defines one immutable `JevRelationalJudgment` and the TypeSafe/Jev adapter. M9 decides which evidence belongs together. This gate defines the missing orchestration layer between those two pieces.

## 1. Authority split

H19 owns:

- which hypotheses are eligible;
- which facts enter each case;
- case order;
- call budget;
- cache identity and replay;
- judgment provenance;
- all downstream action authority.

Jev owns only one bounded choice for one already-frozen case:

`strengthens | weakens | unrelated | insufficient`

Jev MUST NOT:

- add or remove facts;
- request another case;
- choose a different hypothesis;
- compute new ratios/metrics;
- aggregate across cases;
- produce an overall risk score;
- trigger tests, writes, merges or dispatcher actions.

## 2. Input contract

A judgment run accepts:

- one validated M9 relational case batch;
- the exact ordered `RelationalEvidenceCase` objects referenced by that batch;
- provider identity;
- model identity;
- frozen question ID/version from M8;
- explicit `maxLiveCalls` in the range 0..20;
- optional exact-answer cache.

Every case SHA in the batch must resolve to exactly one supplied case.

Missing, extra, duplicated or hash-mismatched cases fail closed before any provider call.

## 3. Deterministic request plan

Before reading cache or calling Jev, H19 freezes an ordered request plan.

Order is exactly the M9 batch case order.

For each row record:

- hypothesis ID;
- case SHA;
- M8 relational input digest;
- provider;
- model;
- question ID/version;
- deterministic cache key.

The plan has:

`requestPlanSha256 = sha256(stableJson(plan without hash) + "\n")`

No timestamp enters this identity.

Changing batch identity, case content, model, provider or question version changes the request-plan identity.

## 4. Cache-first execution

For every planned row:

1. validate the exact M8 case;
2. compute the existing M8 Jev cache key;
3. replay a valid exact-key cached judgment when present;
4. only uncached rows are candidates for a live provider call.

A cached judgment must itself validate against the exact case/model/question/input identity.

Invalid cache content fails closed for that row and MUST NOT be silently accepted.

Cache replay does not consume live-call budget.

## 5. Live-call budget

`maxLiveCalls` is explicit and bounded to 0..20.

Among uncached rows, live-call eligibility follows request-plan order only.

When the live-call budget is exhausted, remaining uncached rows are emitted as skipped reason:

`live-call-budget`

Budget omission is not evidence that a case is unrelated or safe.

No adaptive Jev-selected reordering exists in v0.1.

## 6. One provider attempt per uncached eligible row

v0.1 performs at most one provider attempt for each uncached row selected inside the budget.

There is no hidden retry loop.

Timeout/HTTP/transport/missing-key outcomes use the existing M8 advisory error-judgment contract.

Provider errors do not abort already valid sibling rows and do not mutate the case batch.

## 7. Provider confidence is not calibrated probability

The provider-returned confidence value is preserved exactly as `providerConfidence`.

It MUST NOT be interpreted as:

- empirical correctness probability;
- dispatcher threshold;
- risk score;
- hypothesis priority;
- live-call routing weight.

Calibration requires later independent outcomes.

## 8. Valid abstention

`insufficient` is a valid answered Jev choice, not a provider failure.

It means the frozen evidence supplied to Jev does not justify a directional relation judgment.

It remains distinct from:

- timeout;
- HTTP error;
- transport error;
- missing API key;
- budget skip.

## 9. Judgment run artifact

The run artifact records:

- M9 `batchSha256`;
- `compositionInputSha256`;
- `requestPlanSha256`;
- provider/model/question identity;
- `maxLiveCalls`;
- ordered row results;
- counts: cached, live, answered, insufficient, error, skipped;
- `judgmentRunSha256`.

Each row is exactly one of:

### answered

- case SHA;
- judgment SHA;
- source = `cache | live`;
- choice;
- provider confidence.

### error

- case SHA;
- judgment SHA;
- source = `cache | live` when applicable;
- frozen error code.

### skipped

- case SHA;
- no judgment SHA;
- reason = `live-call-budget`.

`judgmentRunSha256 = sha256(stableJson(run without judgmentRunSha256) + "\n")`

Timestamps may be recorded outside the hashed scientific identity but cannot affect replay identity.

## 10. No cross-case aggregation

v0.1 does not compute:

- majority vote;
- average confidence;
- overall PR risk;
- winner hypothesis;
- weighted evidence score;
- learned threshold.

The output is a set of independently bound advisory judgments.

Cross-case ranking requires a later gate with external outcome evidence.

## 11. Outcome/calibration boundary

M8 `RelationalOutcome` and calibration-row primitives remain the only allowed path from a judgment to empirical evaluation.

The judgment batch MUST NOT label its own answers correct.

Future calibration must bind an independently produced outcome to:

- exact case SHA;
- optional exact judgment SHA;
- observed revision/source digest.

No self-confirmation from Jev output is valid outcome evidence.

## 12. Secrets and artifact hygiene

API keys/tokens MUST NOT appear in:

- request plan;
- judgment artifacts;
- cache values;
- logs;
- error codes.

Provider response storage is limited to the bounded fields required by M8 judgment validation.

Raw free-form provider prose is not part of v0.1.

## 13. CI boundary

CI tests this gate with deterministic fake provider responses only.

Normal repository CI MUST NOT require a live Jev credential or network call.

A future live experiment must be explicitly invoked and recorded separately.

## 14. Acceptance gates

### JB1 — exact batch binding

A run cannot start when batch/case identities do not match exactly.

### JB2 — deterministic request plan

Input ordering outside the already-frozen M9 batch cannot change request-plan identity.

### JB3 — cache first

A valid exact-key cached answer is replayed with zero provider calls.

### JB4 — cache tamper rejection

Wrong case/model/question/input cache content is never accepted.

### JB5 — bounded live calls

Live provider calls never exceed `maxLiveCalls` or 20.

### JB6 — deterministic budget order

When budget is smaller than uncached count, earlier M9 rows receive the available slots and the rest become explicit `live-call-budget` skips.

### JB7 — one attempt

Each uncached in-budget case causes at most one provider attempt.

### JB8 — advisory provider errors

Timeout/HTTP/transport/missing-key results remain immutable advisory error judgments and do not mutate sibling cases.

### JB9 — valid insufficient

`insufficient` remains an answered judgment and is never rewritten as error/unrelated.

### JB10 — confidence boundary

Provider confidence is stored but cannot affect dispatcher authority, case order or live-call budget.

### JB11 — immutable source artifacts

M9 batch and M8 cases remain byte-equivalent before and after execution.

### JB12 — deterministic run artifact

Equivalent cached outcomes produce the same scientific run identity independent of wall-clock time.

### JB13 — no aggregate score

Implementation exports no overall Jev risk/priority/winner score.

### JB14 — outcome separation

No Jev answer can create its own calibration outcome.

### JB15 — secret hygiene

Credentials/raw authorization values never enter persisted artifacts or error text.

### JB16 — no live CI dependency

Acceptance tests use a fake provider and pass with no Jev API key.

### JB17 — no H19s crossover

No H19s/SHADOW-01 routing, cohort or question state is imported or modified.

## 15. Non-goals

v0.1 does not:

- learn weights;
- rank hypotheses;
- choose the next experiment;
- execute M7 test candidates;
- auto-promote a Jev judgment;
- combine judgments into a PR risk score;
- calibrate provider confidence;
- modify H19s.

## 16. Promotion rule

Only after this gate is exact-head CI-green may the implementation milestone receive the next Bundle number.

The implementation inherits JB1-JB17 unchanged.
