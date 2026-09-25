# Relational Judgment Batch Gate v0.2

**Status:** frozen before implementation  
**Supersedes:** `RELATIONAL_JUDGMENT_BATCH_GATE-v0.1.md`  
**Parent:** v0.1 freeze PR #593 exact-head CI #2949 SUCCESS at `fd2bc67598bc9f4d9dd98946ccf19242d7b1d3d6`  
**Purpose:** preserve all v0.1 authority and provenance boundaries while replacing one-request-per-case execution with TypeSafe speculative fan-out.

The TypeSafe API evaluates multiple questions independently against the same structured state in one request. H19 therefore batches uncached relational cases into a single shared state and one parallel `questions` map.

## 1. Authority split

All v0.1 authority rules remain unchanged.

H19 owns:

- case eligibility and order;
- cache identity;
- live-question budget;
- batch-state construction;
- provider request count;
- replay;
- all downstream action authority.

Jev owns only one bounded Choice answer per already-frozen case:

`strengthens | weakens | unrelated | insufficient`

Jev does not select evidence, cases, ordering, follow-up calls or actions.

## 2. Terminology repair

v0.1 used `maxLiveCalls` for a limit that was conceptually a **case/question budget**.

v0.2 replaces it with:

`maxLiveQuestions` ∈ 0..20

A cache miss consumes one live-question slot only if the case is included in the fan-out request.

A cache hit consumes zero live-question slots.

For one judgment run:

- `providerRequestCount` MUST be 0 when there are no selected uncached rows;
- `providerRequestCount` MUST be 1 when at least one uncached row is selected;
- it MUST NEVER exceed 1.

## 3. Exact batch and case binding

Before cache lookup or provider work, H19 validates the exact M9 batch and exact set of M8 cases.

Missing, extra, duplicated, reordered-through-identity or hash-mismatched case artifacts fail closed.

## 4. Deterministic request plan

The request plan remains content-addressed and ordered exactly by the M9 batch.

Every row binds:

- hypothesis ID;
- case SHA;
- M8 relational input digest;
- provider/model;
- question ID/version;
- per-case cache key.

The plan hash remains independent of timestamps.

## 5. Cache-first selection

For each planned row, H19 checks the existing exact per-case Jev cache key first.

A v0.2 replay-eligible cache entry must bind both:

- the exact validated M8 judgment identity; and
- the exact four-option probability distribution returned with that judgment.

Only probability-complete v0.2 entries are replayed immediately and omitted from the provider fan-out request.

A valid legacy v0.1 judgment-only cache entry is not tampering, but it is insufficient for v0.2 scientific replay because its probability vector was not preserved. It is treated as `cache-upgrade-required` and may enter the live fan-out selection under the normal question budget.

Invalid/tampered exact-key cache content becomes an immutable `invalid_cache` advisory error for that row and MUST NOT fall through to a live request.

## 6. Fan-out selection

After cache replay, remaining uncached rows are considered in M9/request-plan order.

The first `maxLiveQuestions` uncached rows are selected into one fan-out request.

All remaining uncached rows become explicit:

`live-question-budget`

skips.

The budget is deterministic. Jev does not reorder it.

## 7. Shared state

The provider request uses one structured state:

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "caseSha256": "...",
      "state": { "...": "exact M8 relationalJevState" }
    }
  ]
}
```

Cases appear in selected request-plan order.

Each question explicitly references its own structured-state path, e.g.:

`Evaluate only cases[3].state for this relation judgment.`

Question IDs are opaque transport IDs and MUST NOT be relied upon as model-visible instructions.

## 8. Parallel typed questions

The single provider request contains one Choice question per selected uncached case.

Each Choice uses the same frozen four options and criteria from M8:

- strengthens
- weakens
- unrelated
- insufficient

Every question is evaluated independently against the shared state.

No answer from one question becomes context for another.

## 9. Provider response binding and atomic live acceptance

The documented System One response contract returns one answer per submitted question. v0.2 therefore does not invent an undocumented per-question provider-error envelope.

A live fan-out response is accepted only when all of these are true:

- HTTP request succeeded;
- returned model identity is the expected model;
- the answer-ID set is exactly the submitted question-ID set;
- every answer is a valid typed Choice payload;
- every answer carries the exact frozen four-option probability domain.

If any selected answer is missing, any extra answer appears, or any answer is malformed, the **entire live response fails closed**.

No judgment from that live response is written to canonical cache.

Already replayed cache-hit siblings remain valid and unchanged.

This gives the live network operation transaction-like acceptance while keeping successful canonical storage per case.

For every answer H19 freezes:

- case SHA;
- selected choice;
- full exact probability distribution over the four allowed choices;
- provider confidence;
- provider/model/question identity;
- source = live.

The probability keys MUST be exactly the frozen choice set, each value finite in [0,1], and the distribution sum MUST be within deterministic numeric tolerance of 1.

## 10. Probability versus confidence

v0.2 explicitly preserves both.

- `probabilities` are the model's distribution over the four Choice options.
- `providerConfidence` is the provider's summary statistic derived from that distribution.

Neither is treated as empirical correctness probability for H19.

Future calibration must compare these values with independent outcomes before any threshold acquires operational authority.

## 11. Abstention

`insufficient` remains a normal answered Choice option.

It is not:

- a transport error;
- a malformed response;
- a cache miss;
- a budget skip.

It must retain its returned probability and confidence like every other Choice.

## 12. One provider request, no hidden retry

A run may issue at most one provider request.

There is no hidden retry loop in v0.2.

If that request fails at transport/HTTP/timeout level, or fails the atomic response-completeness/type checks in section 9, every selected live question receives an immutable advisory error judgment bound to its exact case.

No selected live answer from the failed request is cached.

Cached siblings remain valid and unchanged.

Budget-skipped siblings remain skipped.

## 13. Judgment run artifact

The run artifact records:

- M9 batch SHA;
- composition input SHA;
- request-plan SHA;
- provider/model/question identity;
- `maxLiveQuestions`;
- `providerRequestCount`;
- ordered row results;
- counts: cached, live, answered, insufficient, error, skipped;
- judgment-run SHA.

Answered rows include:

- judgment SHA;
- source;
- choice;
- exact probability map;
- provider confidence.

Error and skipped rows remain bounded typed records.

No timestamp participates in the scientific identity.

## 14. Cache write behavior

Each valid live answer is frozen into an exact per-case judgment artifact and cached under the existing per-case cache key.

A later run may therefore replay any subset of previously answered cases without repeating the fan-out request for those cases.

Partial cache reuse is first-class.

## 15. Type safety

No free-form provider prose is parsed.

The implementation consumes only the bounded System One response fields required for:

- Choice option;
- probability map;
- confidence;
- model identity.

Any unexpected shape fails closed.

## 16. Outcome/calibration boundary

No Jev answer validates itself.

M8 independent outcomes remain required for empirical calibration.

The full probability vector captured here exists specifically so later calibration can test:

- empirical accuracy by returned probability;
- reliability curves;
- confidence/selective-risk behavior;
- abstention behavior;
- future information-gain policies.

No such policy is authorized by this gate.

## 17. Acceptance gates

### JF1 — exact source binding
Batch/case mismatch fails before cache/provider work.

### JF2 — deterministic plan
Equivalent inputs produce identical request-plan identity.

### JF3 — cache first
Exact probability-complete v0.2 cache hits never enter the fan-out state/questions and consume no live-question budget.

### JF4 — cache schema/tamper handling
A valid legacy judgment-only cache entry becomes `cache-upgrade-required` and may be refreshed live. Tampered or identity-invalid cache content becomes `invalid_cache` and never receives a live fallback.

### JF5 — bounded questions
Selected live questions never exceed `maxLiveQuestions` or 20.

### JF6 — deterministic overflow
Overflow rows become `live-question-budget` skips in request-plan order.

### JF7 — zero-or-one provider request
A run performs exactly 0 or 1 provider request.

### JF8 — shared-state path binding
Every live question explicitly names only its own case state path.

### JF9 — atomic answer completeness
Every selected question has exactly one typed answer. Missing/extra IDs, wrong model identity or any malformed answer fail the whole live response; zero answers from that response enter canonical cache.

### JF10 — exact option domain
No choice outside the frozen four options is accepted.

### JF11 — probability binding
Answered rows preserve the exact valid four-option probability map.

### JF12 — confidence boundary
Provider confidence is preserved but cannot change ordering, budget or dispatcher authority.

### JF13 — valid insufficient
`insufficient` remains a normal answered option with probabilities/confidence.

### JF14 — one failed request, bounded errors
A provider-level or atomic-response-validation failure creates one advisory error per selected live row, caches none of those live rows, and does not mutate cache hits/skips.

### JF15 — partial replay
Cached and uncached rows may coexist; only uncached selected rows enter the one live request.

### JF16 — immutable source artifacts
M9 batch and M8 cases remain byte-equivalent.

### JF17 — deterministic run identity
Equivalent cached/live typed results produce the same scientific run identity independent of wall-clock time.

### JF18 — no aggregate score
No overall risk/winner score is introduced.

### JF19 — no self-calibration
No Jev response can manufacture an M8 outcome.

### JF20 — secret hygiene
Credentials never enter state, questions, cache artifacts, run artifacts or logs.

### JF21 — fake-provider CI
CI requires no live Jev credential/network call.

### JF22 — no H19s crossover
H19s/SHADOW-01 state is neither imported nor modified.

## 18. Non-goals

v0.2 does not:

- rank cases by entropy;
- change M9's 20-case sampling policy;
- execute tests;
- learn thresholds;
- auto-validate high-confidence answers;
- alter dispatcher authority;
- modify H19s.

Those require empirical outcome data first.

## 19. Promotion rule

Only after this v0.2 freeze is exact-head CI-green may M10 be restacked and implemented against JF1-JF22.
