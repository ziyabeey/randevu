# Relational Judgment Batch Gate v0.3

**Status:** frozen before implementation.
**Supersedes:** the execution shape of `RELATIONAL_JUDGMENT_BATCH_GATE-v0.2.md` (§2, §7, §8, §9, §12, JF7–JF9, JF14). Every other v0.2 rule stays in force.
**Parent:** v0.2 freeze #595.
**Evidence:** FANOUT-001 (pre-registered) plus the exploratory FANOUT-002 and FANOUT-003, recorded in `perf/FANOUT-001.md` on `h19-kit-m10-fanout-perf`.

## 1. Why v0.2's shared state is withdrawn

v0.2 put every selected case into one structured shared state and asked one Choice question per case, each naming its own `cases[i].state` path. FANOUT-001 measured this with `jev-1.13.0`. Two runs gave the same result:

| Comparison | Top-choice agreement |
|---|---|
| the same case asked alone vs inside a 20-case shared state | **40–50%** |
| noise floors (single vs single; fan-out vs fan-out) | 85–100% |

- FANOUT-002 reversed the case order. Answers stayed with the question **position** (70% agreement) far more than with the named **case** (35%).
- FANOUT-003 sent one case per request, concurrently. Answers stayed case-bound (17/20 top-choice agreement with sequential single-case answers, mean |Δp| 0.020). Wall time was about 0.7 s for 20 cases.
- Input tokens were about 9% higher than fan-out; the fan-out state is billed once but contains every case.

A shared multi-case state therefore does not produce judgments about the named case, and its answers must not become per-case canonical cache entries. The provider's parallel-question contract suits many questions about **one** state, not many cases packed into one state.

## 2. Execution shape

For one judgment run:

1. **Binding, plan and budget.** Exact batch/case binding, the deterministic request plan, cache-first selection and `maxLiveQuestions` ∈ 0..20 are unchanged from v0.2 §3–§6.
2. **One request per case.** Every selected uncached row gets exactly one provider request in the M8 single-case shape:
   - body: `{ model, state: relationalJevState(case), questions: { relation: <frozen M8 Choice question> } }`;
   - that body is exactly what the M8 input digest (`inputSha256`) describes. The per-case cache key, which is built from that digest, therefore identifies the exact request.
3. **Concurrency.** Selected requests are issued concurrently, at most 20 in flight.
4. **Request count.** `providerRequestCount` equals the number of selected rows that reached the provider. It is 0..20 and never exceeds `maxLiveQuestions`.
5. **No retry.** Each selected row is attempted at most once.

## 3. Per-request atomic acceptance

A response is accepted for its row only if all of these hold:

- the HTTP request succeeded;
- the returned model identity is the expected model;
- the answer-ID set is exactly `{relation}`;
- the answer is a typed Choice payload (`type: "choice"`);
- the choice is one of the frozen four options;
- the confidence is finite and in [0,1];
- the probability map has exactly the four option keys, each finite in [0,1], and sums to 1 within 0.02.
  - The tolerance comes from 160 recorded TypeSafe Choice answers, whose sums were 0.99–1.00.

Otherwise that row becomes an immutable advisory error and nothing from that response is cached. Sibling rows are independent: a failed request does not change another row's accepted answer, cache hit or budget skip.

## 4. Cache entries

Only v0.3 entries are replay-eligible. A v0.3 entry binds:

- the exact validated M8 judgment;
- the exact four-option distribution;
- `executionShape: "single-case"`;
- the digest of the exact provider request body (credentials excluded).

Other exact-key content is classified as follows:

- **Upgrade required (`cache-upgrade-required`), may be refreshed live under the normal budget:**
  - a valid legacy v0.1 judgment-only entry, because its probabilities were not preserved;
  - a valid v0.2 fan-out entry, because its shape is withdrawn by §1.
- **Invalid (`invalid_cache`), never falls back to live:**
  - tampered or identity-invalid content;
  - anything else.

## 5. Run artifact

As in v0.2 §13, with these changes:

- `schemaVersion: 3`;
- `providerRequestCount` follows §2;
- there is no run-level fan-out digest;
- every live row that reached the provider carries its own `requestSha256`, and other rows carry `null`.

No timestamp participates in the scientific identity.

## 6. Unchanged boundaries

All v0.2 authority, provenance, abstention, probability/confidence, secret-hygiene, outcome and H19s boundaries remain in force:

- `insufficient` is a normal answered option;
- no aggregate score;
- no dispatcher authority;
- no self-calibration;
- fake-provider CI only;
- no H19s crossover.

## 7. Acceptance gates

| Gate | Requirement |
|---|---|
| **JS1** exact source binding | Batch/case mismatch fails before cache or provider work. |
| **JS2** deterministic plan | Equivalent inputs produce the identical request-plan identity. |
| **JS3** cache first | v0.3 hits never reach the provider and consume no live-question budget. |
| **JS4** cache classes | Legacy v0.1 and v0.2 fan-out entries are `cache-upgrade-required`. Tampered or identity-invalid content is `invalid_cache` and never gets a live fallback. |
| **JS5** bounded questions | Selected live rows never exceed `maxLiveQuestions` or 20. |
| **JS6** deterministic overflow | Overflow rows become `live-question-budget` skips in request-plan order. |
| **JS7** one request per selected case | Exactly one single-case request per selected row; none for cached, invalid or skipped rows. |
| **JS8** single-case shape | Each request body carries exactly one case's M8 state and the frozen M8 question. No other case appears in it. |
| **JS9** per-request atomic acceptance | Missing/extra answer IDs, wrong model or a malformed answer fail that row only. Nothing from that response is cached. |
| **JS10** exact option domain | No choice outside the frozen four options is accepted. |
| **JS11** probability binding | Answered rows and cache entries preserve the exact valid four-option map. |
| **JS12** confidence boundary | Provider confidence cannot change selection, ordering, budget or authority. |
| **JS13** valid insufficient | `insufficient` is a normal answered option with probabilities and confidence. |
| **JS14** bounded failure | A transport, HTTP, timeout or validation failure produces one advisory error for that row. Siblings are unchanged. |
| **JS15** partial replay | Cached and uncached rows coexist; only selected uncached rows reach the provider. |
| **JS16** immutable source artifacts | M9 batch and M8 cases remain byte-equivalent. |
| **JS17** deterministic run identity | Equivalent typed results produce the same run identity, independent of wall-clock time and response arrival order. |
| **JS18** no aggregate score | No overall risk or winner score is introduced. |
| **JS19** no self-calibration | No Jev response can manufacture an M8 outcome. |
| **JS20** secret hygiene | Credentials never enter state, questions, request digests, cache, run artifacts or logs. |
| **JS21** fake-provider CI | CI requires no live Jev credential or network call. |
| **JS22** no H19s crossover | H19s/SHADOW-01 state is neither imported nor modified. |

## 8. Non-goals

Same as v0.2 §18:

- no entropy ranking;
- no change to M9 sampling;
- no test execution;
- no threshold learning;
- no auto-validation;
- no dispatcher authority;
- no H19s change.

## 9. Promotion rule

M10 may be restacked onto this freeze and implemented against JS1–JS22 once this freeze's exact-head CI is green.
