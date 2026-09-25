# Relational Measurement Gate v0.1 — proposed M11

**Status:** review draft; preparation only, not a completed freeze or measurement.
**Task:** H19-KIT-M11-GATE. **Parent:** M10 v0.3, PR #594.
**Pinned tool revision:** `6a37baebca749482465d3dd302f9bae56d3ff2e0`.
**Pinned product revision:** `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.

M11 measures independent correctness, coverage-discovery utility and cost. It
does not grant Jev test-selection or execution authority. This proposal can be
reviewed while M10 is pending; it does not complete M10 or activate M12.

## 1. Questions and claim boundaries

1. Does H19's deterministic discovery identify independently confirmed coverage
   gaps or functional regressions beyond the existing suite?
2. Does Jev classify the relationship between frozen facts consistently with an
   independent relation assessment, and when does it abstain or fail?
3. What additional time, calls, tokens and billed cost does each stage require?

These are different endpoints. RELATION_DIRECTION-v0.1 predicts `strengthens`,
`weakens`, `unrelated`, or `insufficient`, meaning joint support relative to
considering facts independently. None means "bug present". A test failure does
not automatically label the relation `strengthens`; a passing test does not
label it `weakens` or prove the absence of a defect.

## 2. Comparison arms

| Arm | Input and action | Valid comparison |
| --- | --- | --- |
| A — existing checks | Frozen checkout, the union of the six reference suites in the inventory and fixed execution environment | Baseline detections and full baseline cost |
| B — deterministic H19 | A plus frozen M4/M5 discovery, M6/M7 artifacts and M9 cases; no provider | Incremental independently verified findings and additional cost versus A |
| C — H19 + Jev advisory | Exactly B's packets, cases, candidate identities and order, plus M10 judgments | Relation assessment, abstention/error behavior and provider overhead versus B |

For v0.1, C cannot reorder, add or suppress B's tests. B and C therefore do not
constitute a Jev test-selection efficacy experiment. Any claimed C-over-B
detection improvement requires a new, preregistered intervention and is outside
this gate. At most compare advisory information quality and its cost here.

A is a bounded reference baseline, not the entire repository suite. Any claim
that B adds a finding is relative to these named checks. Existing required CI
remains a separate unchanged release gate; this pilot cannot justify skipping it.

A separate, explicitly scoped offline harness may later validate B's candidates.
It is the experiment operator's harness, not authority added to M7/M10 or the
production dispatcher. This planning PR supplies no such runner.

## 3. Pilot inventory and materialization

[COHORT-v0.1.json](../experiments/m11/COHORT-v0.1.json) freezes 24 **scenario
anchors**, 12 development and 12 evaluation, across five declared clusters.
The [inventory README](../experiments/m11/README.md) gives source identities,
selection limits and verification commands. It is a purposive feasibility pilot,
not a random sample of production changes and not a statistical power claim.

Each anchor binds a named existing test and primary targets at the product
revision. Reference tests are baseline checks, not independent truth. In
particular, source-text assertions cannot establish runtime/browser correctness.
An anchor has no M8 case until actual provenance-bound evidence is collected.

The offline materializer must, before labels or provider responses:

1. Freeze the full product checkout, tool checkout, environment/lockfile and
   execution commands. Record exact source and test artifact digests and the
   observed change/diff identity, or explicitly mark a no-change baseline.
2. Collect actual M4/M5 observations. Never synthesize coverage, history,
   baselines, lineage or a defect from the test name; unknown stays unknown.
3. Freeze M5 packets, fact pools and relationship records. Run M9 with its
   existing anchor, independent-family and 2–4 fact constraints unchanged.
4. Bind every emitted case and every skip to its inventory anchor. Retain
   ineligible anchors and their reasons; do not backfill favorable replacements.
5. Freeze the candidate list and shared B/C execution plan before judgments.
6. Publish a separate materialized manifest using M3 hash conventions. The
   anchor inventory remains unchanged; the new artifact references its digest.

The inventory size is not a provider batch size. Each M9/M10 batch remains
bounded to 20; assign materialized cases to batches in ascending anchor ID then
case SHA order. A new input/case/model/question changes identity; no mixed cohort.

## 4. Leakage, clustering and labels

Development: pagination and public-selection. Evaluation: calendar-refresh,
catalog-price-projection and runtime-notification. Sibling variants and shared
evidence lineage must remain in one split. The materializer expands dependency
and lineage clusters; any cross-split overlap invalidates the declared split and
requires a versioned re-freeze **before** labels or provider calls. No silent moves.
Evaluation is held out from this experiment's tuning, not claimed unseen during
the model's training. These are public repository sources.

Do not tune prompts, thresholds, inclusion rules or policies on evaluation
responses. Prompt/model/question changes create a new cohort version. Existing
M8–M10 fixtures, the 96 selector golden cases and known repair outcomes are
development/contract evidence only, not fresh evaluation observations.

Two separate append-only records are required:

- **Relation reference:** exact case/input SHA, the same four-class vocabulary,
  assessor identity, rubric version, label/rationale digest and exposure record.
  Two independent assessments see the frozen case but no Jev output and no
  later functional outcome. Disagreement requires documented adjudication;
  unresolved assessment is `unresolved`, distinct from a justified `insufficient`.
  A future evaluator must not manufacture these receipts with the implementer
  identity or treat an additional model vote as independent truth.
- **Functional outcome:** existing M8 RelationalOutcome from a separate test,
  frozen M5 validation, controlled functional observation or bounded review;
  bind case, observed revision, source digest and existing allowed kind/value.
  Distinguish confirmed coverage gap from confirmed functional defect. A new
  test detects a regression only with a reproducible relevant failure and
  corresponding control behavior; an infrastructure error is inconclusive.

Labels must be sealed before viewing the associated model output. Label artifacts
are excluded from provider state and evidence lineage. After the join, verify
case/request identity; retain conflicting, unavailable and inconclusive rows.
Missing outcomes are neither negative labels nor successful validations.
Do not add relation-class values to the frozen M8 outcome vocabulary.

## 5. Metrics and denominators

Publish counts before rates and retain all enrolled anchors in the flow ledger:
enrolled → materialized/skip → selected/budget-skip → answered/abstained/error
→ independently assessed/unresolved → functional outcome/inconclusive/missing.

| Metric | Definition and population |
| --- | --- |
| Additional functional findings | Unique independently verified regressions detected by B but not A on the same revision/observation; deduplicate by root-cause/outcome identity, not case count |
| Coverage-hypothesis yield | Independently confirmed coverage hypotheses / all attempted validations; also show rejected, inconclusive and missing counts |
| Precision of functional claims | Confirmed / (confirmed + independently rejected) functional claims; missing/inconclusive shown separately |
| False-discovery proportion | Independently rejected / (confirmed + rejected) functional claims; do not name this the population false-positive rate |
| Recall/FPR | Not available unless independently labeled positives/negatives cover the complete eligible universe, including unselected cases |
| Relation agreement | Provider returned choice vs resolved independent four-class label; show confusion matrix, support per class and exact denominator |
| Relation scoring | Multiclass Brier and log loss only for independently labeled four-class cases with a valid stored probability vector |
| Abstention | Answered `insufficient` / all answered judgments; it remains a valid fourth class, not transport failure |
| Failure and omission | Provider errors / attempted requests; budget skips / eligible cases; report invalid cache, write failures and unmaterialized anchors separately |
| Selective agreement | Agreement among non-abstaining answered cases with resolved labels, alongside retained fraction and all excluded counts |
| Cost | Actual provider requests, usage tokens and billed/estimated cost with rate source, currency and effective date; unknown cost is null, not zero |

For relation scoring, preserve the original four values. M10 accepts sum error
within 0.02 without changing stored values. Derive scoring-only q[k] = p[k]/sum(p)
and record original sum and normalization flag; never rewrite the cache receipt.
Brier = mean(sum over four classes of (q[k] - oneHot(label)[k])²), unscaled.
Log loss = mean(-ln(max(q[label], 1e-15))); disclose epsilon and clipped-row count.
Use Jev's returned choice for agreement; report any choice/argmax discrepancy
instead of silently replacing its choice. `providerConfidence` is reported as a
provider field, never substituted for the probability vector.

This pilot reports descriptive values and cluster-level counts. Do not fit or
claim validated confidence thresholds, a reliable calibration curve, population
generalization, or an independent n=24 from five clusters. Development and
evaluation results remain separate. A later confirmatory cohort must predeclare
its sampling unit, effect size/power plan and uncertainty method before collection.

## 6. Timing, cache and resource budget

Record scan/index, discovery/composition, candidate materialization, validation,
provider wall time and total end-to-end wall time. B/C totals include their shared
baseline work; also report incremental cost to avoid hiding preprocessing.
Concurrent wall time is not the sum of request latencies. Retain per-request
latencies and completed/error/skipped counts. Record preparation/install time
separately; do not label a selector microbenchmark as end-to-end speedup.

For deterministic stages, use one unreported warmup then five paired measured
cycles, using A/B/C in odd cycles and C/B/A in even cycles. Each cold
measurement starts with empty isolated H19 caches; each warm measurement uses
the immediately preceding exact cold artifacts. OS/process-cache state is
recorded separately; "H19 cold" is not a claim of a cold operating system.

Provider measurement uses one first-observation call per exact key with no retry,
then five cache-only replays with `maxLiveQuestions: 0`. The cold provider sample
and repeated warm timings are different populations. Replaying the same answer
does not increase the accuracy sample size. Provider failures remain recorded;
no automatic replacement calls. Insufficient cached coverage prevents calling
the replay run "fully warm". Repeated live latency sampling requires a separately
budgeted, versioned experiment; do not clear a cache merely to buy more samples.

Report sample counts and median. p95 uses nearest-rank ceil(0.95*n); below 20
observations also flag `low-sample` and show the range. Do not claim stable tail
latency from five replays or a handful of live requests.

No paid calls are enabled by this draft. A future launch receipt must pin model
and question, exact case manifest, batch plan, timeout, request/token limit,
currency/rate evidence, aggregate monetary ceiling and an already authorized
operator budget. Unknown pricing or absent ceiling blocks paid execution. Enforce
M10's 0..20 budget per batch **and** a declared cumulative experiment cap; splitting
a cohort into batches never bypasses the cumulative ceiling. Existing session
authorization suffices where it supplies the required concrete budget.

## 7. Versioned evidence chain

Inventory → materialized input manifest → independent sealed label receipts →
frozen run plan → A/B/C run artifacts → independent functional observations →
joined metric report. Labels and observations can be produced by separate
operators; provenance records their ordering and identities.

Use existing M3 `freezeCases` / `freezeProtocol` and stableJson-plus-newline hash
conventions; preserve all M8/M9/M10 hashes. Store operational timestamps/costs
outside scientific identities. An aggregate report binds exact artifact digests,
source/tool revisions, exclusion reasons and denominators; it does not mutate
source artifacts. Every repair starts a new run identity and preserves prior data.

## 8. Acceptance gates

| Gate | Evidence required |
| --- | --- |
| ME1 — bounded preparation | Only contract, inventory and documentation; no runtime/authority or H19s changes |
| ME2 — traceable inventory | 24 unique anchors; existing named tests and exact primary source blobs; M3 hashes reproduce |
| ME3 — honest pending state | Zero fabricated M8 cases, relation labels, outcomes, provider responses or measurements |
| ME4 — comparable arms | Same frozen source/environment; B/C case and candidate identity equality; all preprocessing and validation costs reported |
| ME5 — materialization | Existing M5/M8/M9 validators pass or a recorded skip; no invented evidence or replacement sampling |
| ME6 — independent labels | Sealed relation assessments and separate outcome evidence; complete provenance and unresolved ledger |
| ME7 — correct semantics | No bug-probability claim from relation vectors; explicit denominators, scoring transform and non-independence limits |
| ME8 — bounded collection | Existing M10 budgets/no-retry/cache identities, cumulative paid ceiling and receipt-bound provider run |
| ME9 — reproducibility | Cold/warm populations, input digests, raw timings, execution order, run failures and cost basis retained |
| ME10 — staged acceptance | Proposal review and exact-head CI before freeze; required parent acceptance before promotion; later runner/data gates checked separately |

This PR can satisfy ME1–ME3 and specify ME4–ME10; documentation CI does not
demonstrate that a benchmark, empirical calibration or paid run occurred.

## 9. M12 boundary and next implementation slice

M12 may propose cost-aware selection after usable independent evidence exists.
Entropy of one four-class vector is uncertainty, not expected information gain.
An information-gain claim additionally needs a declared observation/outcome model
and expected posterior uncertainty, validated under its own prospective gate.
M11 introduces no such ranking, threshold, aggregate risk score or dispatcher rule.

The next bounded implementation is an offline development-split materializer and
receipt validator. Its task must freeze writable scope and acceptance before
implementation; it must not acquire live credentials, alter the evaluation split
after outcomes, execute product changes, or silently implement M12.
