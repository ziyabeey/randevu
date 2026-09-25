# H19 Kit active bundle line

This file is the authoritative **execution sequence** for the current H19 Kit bundle work.

It is intentionally separate from `ROADMAP.md`, which is the long-term integration/productization roadmap.
The M-numbers in these two documents must not be mixed.

## Sequencing invariant

A child milestone is not active until its parent is:

1. implemented;
2. on the intended stacked base;
3. CI-green on the exact head SHA;
4. free of known blocking regressions.

No milestone is promoted merely because its code exists.

Side-hardening PRs may be developed in parallel, but they remain **HOLD** and do not advance the active bundle line.

## Completed bundle milestones

| Bundle milestone | Scope | PR | Green evidence |
|---|---|---:|---|
| M0 | Foundation: evidence/provenance, rule cards, dispatcher, plugin/cache contracts | #533 | green |
| M1 | Repository intelligence: semantic units, history/test-impact infrastructure | #536 | green after retry |
| M2 | Static evidence: H19-owned Semgrep facts + declarative rules | #537 | green |
| M3 | Experiment engine: freeze/blind/gates/ledger/mutation history | #538 | green |
| M3.5 | Code-intelligence graph foundation: SCIP graph, shard/graph cache, affected-project adapters, Tree-sitter fallback, unit→symbol mapping | #544/#547/#548/#549/#550/#551 | green |
| M4 | Change-impact orchestrator | #554 | CI #2831, head `88095f13918301df7188f25e5f50fbcbade4af56` |
| M5 | Coverage discovery + frozen validation packet | #555 | CI #2833, head `32f0bda2296af99ec8720b9be43438268d16b7e2` |
| M6 | Minimal test specification | #561 | CI #2840, head `e52e459a08c5ab56f466303e132beb93400050cb` |
| M7 | Executable test candidate materialization | #566 | CI green, head `7239197bf8cbe010c8c9a1e519992a8931a9f970` |
| M8 | Relational evidence core: deterministic relation math + bounded advisory Jev judgment/outcome chain | #590 | CI #2938, head `49f91ea591345ab477228b3c8ce91cbaa30d60c1` |
| M9 | Relational case composer: deterministic scoped evidence selection before Jev | #592 | CI green, head `440a8b2de05bddec1617600a3187c5c229c1c072` |

## M5 contract

M5 converts deterministic impact evidence into **coverage hypotheses**, not permanent tests and not bug claims.

Current evidence families include:

- explicit runtime coverage gaps;
- unknown runtime coverage on impacted references;
- missing historical companions;
- surviving mutants.

Hypotheses are frozen into a content-addressed validation packet and later recorded as:

- `confirmed`;
- `rejected`;
- `inconclusive`.

A surviving mutant is ranked ahead of a plain coverage-gap hypothesis only when priority and target path are otherwise equal.

## Performance evidence gate

Before the next feature milestone, freeze a reproducible performance baseline for the current M0→M5 engine.

Required measurements:

- real-repository semantic inventory wall time and throughput;
- Git-history cold vs warm-cache wall time;
- real scip-typescript cold indexing time and index size;
- H19 project-shard warm cache-hit time;
- real single-source-change reindex cost;
- tsconfig-scoped shard invalidation cost and unchanged-shard cache reuse;
- deterministic M4/M5 synthetic scale probe.

The first run is measurement-only. Do not invent pass/fail thresholds before the baseline is captured.

PERF-002 established a concrete bottleneck: a single changed file caused ~8.95 s reindex, ~96% of whole-repository first-index cost, while exact-content cache hit was ~28 ms.

PERF-003 then measured TypeScript-project-scoped invalidation: a real app-source edit dropped from 5.66 s whole-root reindex to 3.87 s single-shard reindex (31.5% reduction), while two unchanged shards remained cache hits and an out-of-project script change invalidated zero declared TypeScript shards.

GRAPH-EQ-001 then passed semantic graph-composition equivalence on the real repository: 77 whole-index documents matched 77 merged-shard documents exactly, the 9,686-node H19 graph digest was identical, and 20 representative blast-radius units had zero mismatches.

Production adoption is implemented in #581 and exact-head CI-green at `13fbc34baf5808ba9aef5c5b2d5314f2a8e8f6bf`.

The project-scoped evidence graph is therefore available to the joined feature line, with whole-index fallback remaining explicit and fail-closed.

## Joined parent gate

M7 and project-scoped TypeScript evidence-graph adoption are joined in #588.

Exact joined head:

`1e485164350cfa6b43d2a36aac8bafff30fc9c5e`

Repository CI is green on that exact head.

## M8 Relational Evidence Core

The gate is frozen in `specs/RELATIONAL_EVIDENCE_GATE-v0.1.md` and passed exact-head CI #2937 at freeze head `61e6c22617dc0f29dacf4380895c7a4b0981bc05`.

Bundle **M8** implements the frozen RE1–RE13 contract:

- immutable `RelationalEvidenceCase`;
- deterministic baseline delta/lift and lineage features;
- dimension-safe same-metric ratio helper;
- immutable bounded `JevRelationalJudgment`;
- content-addressed Jev replay identity;
- advisory TypeSafe/Jev adapter with no live-CI dependency;
- immutable externally sourced `RelationalOutcome`;
- calibration-row materialization without treating provider confidence as probability.

M8 remains advisory. It does not change dispatcher action authority, write/execute tests, or modify H19s.

## M9 Relational Case Composer

The composer gate in `specs/RELATIONAL_CASE_COMPOSER_GATE-v0.1.md` is frozen on #591 and final exact-head CI #2944 is green at `def7f4bc2d22484c30d3de00bd12566e3478c30e`.

Bundle **M9** implements RC1–RC16:

- explicit hypothesis/unit/path/related-path fact scope;
- reason-specific direct anchor evidence;
- minimum two independent evidence families;
- at most one 2–4 fact case per hypothesis;
- deterministic subset selection ordered by independent-family count → family diversity → lowest lineage overlap → minimality → scope strength → lexical fact IDs;
- explicit 20-case batch cap and skipped ledger;
- content-addressed related-path relationship records;
- canonical `compositionInputSha256` over fact-pool/scope/relationship inputs;
- exact selected-scope bindings for every emitted case;
- no Jev/model/API call during composition.

M9 remains advisory and deterministic. Jev receives a case only after H19 has selected and frozen its evidence.

## Active milestone — M10 Relational Judgment Batch (v0.3)

The v0.3 judgment-batch freeze in `specs/RELATIONAL_JUDGMENT_BATCH_GATE-v0.3.md` is exact-head CI-green on #597 at `e8171ec210ca5f942ac846f6e3fafce041c3c3ea`.

FANOUT-001/002 measured that the withdrawn v0.2 shared multi-case state was not case-bound. FANOUT-003 showed that one exact M8-shaped request per case, issued concurrently, preserved case binding while retaining low wall-clock latency.

Bundle **M10** therefore implements JS1–JS22:

- exact M9 batch → exact M8 case binding before cache/provider work;
- deterministic content-addressed request planning;
- cache-first replay of v0.3 `single-case` entries only;
- valid v0.1 judgment-only and v0.2 fan-out entries become `cache-upgrade-required`;
- tampered/identity-invalid exact-key content becomes `invalid_cache` with no live fallback;
- `maxLiveQuestions` bounded to 0..20; cache hits consume zero budget;
- exactly one M8 single-case provider request per selected uncached row;
- selected requests are issued concurrently, with no retry;
- per-request atomic validation; sibling requests are independent;
- explicit `live-question-budget` skips for overflow;
- every live row that reaches the provider binds its own `requestSha256`;
- every answered row preserves the exact four-option probability distribution plus provider confidence;
- `insufficient` remains a valid answered abstention;
- run artifact schema is v3;
- no aggregate risk/winner score, no dispatcher authority, no self-calibration;
- fake-provider CI only and no H19s crossover.

M10 remains advisory. It cannot alter dispatcher authority or execute M7 candidates.

### Bounded repair behavior

Cache persistence failures do not turn an accepted provider judgment into an error
or discard sibling artifacts. `runRelationalJudgmentBatch` returns sanitized
`cacheWriteErrors` beside `run`; they are operational diagnostics outside the
scientific run hash. A failed write is not claimed as persisted and is not retried.
The exact request-body digest is re-derived when replaying a cache entry with its
case and when validating a live run against its cases.

M9 selection keeps RC1–RC16, the same comparison objective and the same artifact
identities. It streams candidates with admissible bounds rather than allocating
and sorting all subsets. After the 20-case cap, it proves existence only and still
preserves the precise skipped reason for invalid hypotheses. Worst-case exact
search can remain combinatorial in CPU; the cap is not a universal CPU bound.

Regression evidence includes 96 frozen outputs from the original v0.1 selector,
large-pool minimality, mixed valid/invalid overflow, cache persistence failure,
request identity, real abort, response isolation and 20 concurrent requests.
The local selector-only measurement is recorded in
`perf/baselines/M9-REPAIR-001.local.json`; it is not an end-to-end CI speed claim.

## Next preparation — proposed M11 measurement gate

The [M11 measurement contract](specs/RELATIONAL_MEASUREMENT_GATE-v0.1.md) and
[24-anchor pilot inventory](experiments/m11/README.md) are a review draft.
They specify existing-suite / deterministic-H19 / H19-plus-Jev comparisons,
independent relation labels and functional outcomes, explicit denominators,
cost/cache measurements and a bounded collection plan.

This preparation does not mark M10 accepted or M11 implemented. The inventory
contains no materialized cases or labels. M10 remains advisory: B/C test plans
stay identical, so this gate cannot claim a Jev-driven test-selection gain.
The next implementation slice is an offline development-split materializer;
paid collection requires its concrete budget and independently sourced evidence.
M12 selection remains a later contract, not an activated milestone.

## Side-hardening HOLD

The following work does not advance the active bundle sequence until explicitly integrated after the active parent line remains green:

- #556 — SCIP indexer registry;
- #557 — call-edge contract.

They are useful infrastructure, but are not substitutes for completing the active bundle gate.

## H19s separation

H19s / SHADOW-01 remains a separate frozen real-traffic experiment.

H19 Kit bundle work must not:

- change H19s cohort eligibility;
- change H19s routing thresholds or questions;
- run Jev before the H19s blind-label sequence authorizes it;
- treat H19s synthetic/real-traffic evidence as equivalent to H19 Kit integration progress.
