# M11 Notification Behavioral Validation Gate v0.1

**Status:** frozen before execution  
**Parent:** M11 development supplement #605 exact-head `fd948ea4912ee87b2728e44b9d2b0d8ba62809a0`, CI run `36145146421` attempt 2 SUCCESS  
**Product source revision:** `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`  
**Target M9 case:** `2b924bfe4d9dc5e15d40199189b6b8070bee47d2cca3dc68eb24357f660e33f2`  
**Target hypothesis:** `coverage:explicit-runtime-coverage-gap:worker_notifications.ts`

## 1. Purpose

Validate whether the two named notification helpers that were uncalled in the saved development observation correspond to a useful behavioral validation target.

Saved observation:

- target: `worker/notifications.ts`;
- observed named V8 entries: 21;
- called: 19;
- uncalled:
  - `validGroupSummary`;
  - `renderTemplateV2`.

This is a separate development validation of one existing M9 case. It is not a Jev relation label, evaluation result, product defect claim or M12 selection decision.

## 2. Frozen prior evidence

The validation binds these pre-existing product artifacts from the pinned product revision:

| Artifact | Git blob |
| --- | --- |
| `worker/notifications.ts` | `1adbfb9a194e2020ceb6fcb861a2cafab5573801` |
| `tests/f11-group-notifications.test.mjs` | `19b8d3dcca7cc23c916682c0ae5b3f26ddf59d68` |
| `supabase/migrations/20260917143000_f11_group_notification_repair.sql` | `5e88c00735ae831a4364893e1d9f0672c2b03f9a` |

The existing F11 test is a prior acceptance/specification source only. It MUST NOT be executed as the new M11 outcome and its pass state MUST NOT be copied as a result.

The new suite must be separately authored, frozen and executed after this gate.

## 3. Existing behavior contract

The targeted validation may rely only on behavior already established before this M11 child:

1. Template v2 is used for a multi-line group or any range-priced line.
2. A valid group summary is bounded:
   - line count is 1..10;
   - currency is a three-letter uppercase code;
   - estimates are non-negative, ordered and within the frozen maximum;
   - line array length equals line count;
   - line ordinals are contiguous from 1;
   - each line has string service/staff/time fields;
   - price type is fixed or range;
   - line prices are non-negative, ordered and bounded.
3. A one-line template-v2 summary renders singular appointment wording.
4. A multi-line template-v2 summary renders multi-service wording and preserves line order.
5. Fixed prices render as one amount; range prices render as min–max.
6. Invalid/unbounded group summaries do not reach provider send or the request lock; the job is released retryably as `notification_group_snapshot_unavailable`.
7. Rendered HTML escapes untrusted snapshot/summary text.
8. Provider request fingerprint is derived from method + provider endpoint + provider idempotency key + exact rendered body. Identical frozen input must yield the same fingerprint; a behaviorally relevant rendered-body change must change it.
9. All rendering uses the job timezone snapshot.
10. No real provider delivery is necessary to validate these behaviors.

## 4. New validation suite

The future execution suite is new M11 evidence. It must not modify production code.

Minimum pre-registered scenarios:

### N1 — one-line range render

A valid one-line range summary:

- reaches request lock and fake provider exactly once;
- renders singular appointment wording;
- contains the line ordinal, service and staff;
- contains the min–max line price;
- contains the aggregate min–max estimate;
- exercises both targeted named entries.

### N2 — multi-line order and mixed price presentation

A valid two-line summary containing one range line and one fixed line:

- reaches fake provider once;
- renders multi-service wording;
- preserves ordinal order 1 then 2;
- renders range and fixed prices with their respective semantics;
- renders the aggregate estimate.

### N3 — validation boundary matrix

Each invalid summary below independently fails before request lock/provider send and releases retryably with `notification_group_snapshot_unavailable`:

- null summary;
- lineCount 0;
- lineCount > 10;
- line count/array length mismatch;
- non-contiguous line ordinal;
- invalid currency code;
- negative aggregate minimum;
- aggregate maximum below minimum;
- aggregate amount above the frozen maximum;
- invalid price type;
- negative line minimum;
- line maximum below line minimum;
- line amount above the frozen maximum.

No invalid row may be silently normalized into a valid send.

### N4 — HTML/text safety

A valid summary with HTML-significant service/staff names and snapshot text:

- preserves readable values in the text body;
- HTML output contains escaped values;
- raw executable markup from untrusted fields is absent from HTML;
- management link remains the frozen generated link, not content injected by summary fields.

This is behavioral validation only, not a comprehensive HTML-security audit.

### N5 — timezone render

A fixed UTC instant rendered with the pinned `Europe/Istanbul` timezone snapshot must produce the expected local-time representation in the generated message.

The expected instant and rendered representation must be frozen in the future suite before execution. Runtime is pinned to the M11 Node version.

### N6 — request fingerprint stability

Using one exact frozen claim row + summary:

- two independent preparations produce the same request fingerprint;
- changing one rendered summary field produces a different fingerprint;
- neither path reaches the real provider.

The test observes the fingerprint through the request-lock RPC input rather than exporting private helpers.

## 5. Isolation

The execution must use a temporary tree built from the pinned product revision.

Allowed product/source inputs are explicitly byte-bound. At minimum they include the target and its runtime dependency closure required by the suite.

H19 tooling/producer bytes are bound separately to the child implementation revision.

The evaluation component from M11 remains absent and unread.

No application credentials are inherited. Provider, Supabase and notification RPC calls are mocked/local.

## 6. Coverage observation

The runner records target-scoped V8 output for `worker/notifications.ts`.

The validation must report independently:

- whether `validGroupSummary` was called;
- whether `renderTemplateV2` was called;
- total targeted named entries observed/called;
- TAP scenario pass/fail/skip;
- source and producer identities;
- run start/end and runtime identity.

Coverage is entry-level evidence only. It is not line/branch coverage.

## 7. Decision rule

### M5 coverage outcome = confirmed

Only when all of the following are true:

- all N1–N6 top-level scenarios execute;
- no scenario fails, skips, todos or partially executes;
- both targeted named V8 entries are called;
- source/producer/runtime bindings validate;
- no evaluation input is accessed;
- no real provider/network delivery occurs.

### M5 coverage outcome = inconclusive

Any incomplete execution, missing targeted V8 entry, instrumentation ambiguity, source mismatch, producer mismatch or runtime mismatch is inconclusive.

A behavioral assertion failure is retained as a first-class observation and MUST NOT be rewritten into a passing coverage outcome merely because both functions were called. It requires separate interpretation before an M8 outcome is emitted.

### Rejected

This child does not pre-authorize a `rejected` M5 outcome. Rejecting the original saved gap would require evidence that the original observation/case identity itself was false, not merely that a new behavioral suite failed.

## 8. Independence and counting

- The target is **one M9 case**.
- Multiple anchors bound to that case do not increase sample count.
- N1–N6 are controls within one targeted validation, not six independent cases.
- Existing F11 tests are prior contract evidence, not an independent outcome.
- The same implementer/agent may author this suite; therefore this is a separate observation, not a blinded independent assessor.

## 9. Outcome binding

If confirmed, the result binds through the existing immutable M8 outcome path:

- case SHA = exact target above;
- kind = `m5-validation`;
- value = `confirmed`;
- source digest = exact sealed validation result;
- observed revision = pinned product revision.

No Jev judgment is required and no relation label is created.

## 10. Non-goals

This validation does not:

- establish a production defect;
- test real Resend delivery;
- execute the evaluation split;
- rank cases;
- change M9 selection;
- call Jev;
- calibrate Jev;
- authorize M12;
- add a permanent regression test automatically;
- change H19s or product runtime code.

## 11. Promotion rule

Only after this freeze is exact-head CI-green may a child implementation:

1. freeze the new suite/runner/producer bytes;
2. execute the suite once as the retained empirical run;
3. publish raw TAP/V8 + sealed result;
4. bind an M8 outcome only under the rule in section 7.
