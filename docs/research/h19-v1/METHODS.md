# H19 v1: A Preregistered Semantic Interaction Method for Prospective Regression-Test Discovery

**Version:** 1.0.0  
**Date:** 2026-09-24  
**Creator:** Yusuf Ziya Terzioğlu  
**Case-study system:** Kepenk/Randevu  
**Evidence snapshot:** `3e48d2958607ef20660835cdabd884cc7d3738e2`

## Abstract

H19 is a domain-adapted method for selecting and validating semantic interaction hypotheses in transaction-heavy software. It maps six recurring authority dimensions onto a sparse 19-row binary geometry, uses that geometry to choose interaction candidates, and evaluates each candidate through a preregistered three-arm protocol. The protocol separates candidate selection from test-result inspection: a minimal semantic variation is first evaluated against the unchanged canonical suite; if that suite passes, exactly one prospective probe is frozen; the probe must then fail on the variation at the preregistered invariant and pass unchanged on clean code. Experimental variations never enter production. Successful clean-control probes may be promoted into one fail-closed repository gate with explicit provenance.

In the Kepenk/Randevu case study, a preregistered four-round blind queue produced four incremental discoveries in four rounds. A later equal-budget benchmark compared H19 semantic selection with a simple coverage-first selector across four accepted domains. H19 produced 2 HITs in 4 valid selections, while coverage-first produced 3 HITs in 3 valid selections, with one additional coverage-first cell excluded as protocol-invalid. The benchmark therefore did not establish H19 superiority. The evidence supports a narrower claim: H19 can repeatedly generate incremental executable regression tests under prospective controls, while remaining complementary to combinatorial coverage methods.

## 1. Scope

H19 is intended for systems in which failures often arise from interactions among authority boundaries rather than isolated input values. The original case study is a PostgreSQL-heavy multi-tenant SaaS with idempotent commands, immutable financial and booking snapshots, time-boundary rules, and concurrency/version controls.

H19 is:

- a semantic interaction hypothesis generator;
- a sparse diagnostic geometry;
- a prospective test-discovery protocol;
- a provenance model for turning discoveries into executable regressions.

H19 is not:

- a generic covering array;
- a replacement for pairwise or t-way combinatorial testing;
- a proof of correctness;
- a universal claim that 19 tests are sufficient;
- a runtime dependency.

Combinatorial testing conventionally targets t-way combinations of parameter values. NIST IR 7878 defines and measures such coverage independently of how the tests were generated. H19 deliberately sacrifices complete raw t-way coverage in exchange for semantic selection and sparse diagnostic structure. See: https://doi.org/10.6028/NIST.IR.7878

## 2. Frozen semantic axes

The v1 model has six binary semantic axes.

| Axis | Semantic dimension |
| --- | --- |
| D0 | authorization, tenant, or capability scope |
| D1 | atomicity, idempotency, or command identity |
| D2 | immutable snapshot, value, price, or policy |
| D3 | staff, capacity, or resource authority |
| D4 | time, buffer, local-day, or boundary authority |
| D5 | concurrency, optimistic version, or serialization |

An axis is a semantic fault dimension, not a literal product parameter. A selected pair therefore means: construct one minimal variation that weakens the conjunction between those two authorities while preserving surrounding behavior as far as practical.

## 3. Frozen H19 geometry

The v1 geometry contains 19 rows:

- 1 all-zero center;
- 6 single-axis rows;
- 12 exact two-axis rows;
- the two-axis rows are the pairs at cyclic distance 1 or 2 on the six-axis ring.

The three antipodal pairs are deliberately excluded from geometry-selection credit:

- D0×D3
- D1×D4
- D2×D5

Those pairs are called **holdouts**. A holdout may still be tested as a control or become a permanent product regression, but it is never retroactively counted as an H19-selected geometry HIT.

The dependency-free script `h19_geometry.py` reconstructs the rows and verifies the following binary projection coverage:

| Strength | Covered | Total |
| --- | ---: | ---: |
| 1-way | 12 | 12 |
| 2-way | 57 | 60 |
| 3-way | 128 | 160 |
| 4-way | 147 | 240 |

The same script verifies:

- average single-axis positive fanout = 5.0 rows;
- each selected pair has positive fanout = 1.0 row;
- single-or-pair positive-support coverage = 18/21;
- the only missing pair supports are the three frozen holdouts.

These numbers describe the geometry. They are not evidence that H19 has better fault detection than a covering array.

## 4. Prospective blind-discovery protocol

### 4.1 Selection freeze

Before inspecting the candidate implementation site or the existing tests for that candidate:

1. choose a domain;
2. choose the axis interaction;
3. state the semantic invariant;
4. freeze any queue ordering and selection rule.

The selection record is durable, for example a repository issue.

### 4.2 Final-effective preflight

After the interaction is frozen, trace exactly one user-reachable symbol to its final current-effective definition across forward migrations or later overrides.

This preflight prevents a no-op experiment. It may inspect implementation lineage, but it must not inspect candidate-specific test internals.

### 4.3 Phase 1: one variation, unchanged suite

Apply exactly one minimal semantic variation that weakens only the selected conjunction. Add no new test.

Run the unchanged canonical CI suite.

Terminal outcomes:

- **ALREADY_COVERED**: the current suite fails at the selected invariant. Stop. No second variation.
- **PASS / candidate blind spot**: the current suite accepts the effective variation. Continue.
- **INVALID**: the intervention was no-op, illegal, contaminated, or otherwise unable to test the frozen hypothesis. Exclude it. No substitute variation.

Unrelated infrastructure failures are not semantic outcomes and may be rerun on the exact same head.

### 4.4 Probe freeze

Only after a valid Phase-1 PASS, define exactly one legal prospective probe before reading the existing candidate-specific test internals.

Freeze:

- fixture shape;
- operation order;
- expected discrimination;
- failure classification;
- clean-code oracle.

No alternate probe is allowed after observing the result.

### 4.5 Phase 2: three-arm evidence

A prospective **HIT** requires all three logical arms:

1. **variation-only + current suite = PASS**
2. **variation + frozen probe = FAIL** at the preregistered invariant
3. **clean code + byte-identical probe = PASS**

The probe body should be byte-identical between the variation and clean-control arms. Harness-only errors are repaired identically on both arms and are explicitly excluded from evidence.

### 4.6 Permanent promotion

Experimental variations never merge.

For a completed HIT:

- take the clean-control probe;
- promote it as a permanent regression;
- register it in the one canonical H19 gate;
- preserve selector provenance and three-arm CI receipts.

Production runtime never calls H19.

## 5. Permanent gate and provenance

At evidence snapshot `3e48d2958607ef20660835cdabd884cc7d3738e2`, the repository has one canonical gate:

`supabase/tests/h19_integrity_gate.sql`

After benchmark-v1 promotion it contains 21 permanent scenarios. Each manifest entry stores:

- scenario ID;
- domain;
- two axes;
- selection origin;
- variation-only/current-suite CI receipt;
- variation+probe CI receipt;
- clean-control CI receipt;
- pass status.

Allowed origin values in v1 are:

- `prospective` — selected by the H19 semantic process;
- `holdout` — one of the frozen antipodal controls;
- `coverage-first` — selected by the preregistered benchmark baseline.

Static CI verification fails closed on orphan scenario files, duplicate includes, standalone H19 plan steps, manifest/pass drift, missing evidence receipts, incorrect frozen-holdout origin, or scenario-count drift.

PR #520 exact-head CI #2653 emitted a structured **21/21 PASS** summary. The merge commit is `3e48d2958607ef20660835cdabd884cc7d3738e2`. Post-main CI #2654 attempt 2 also passed all required checks. Attempt 1 ended before code checks during disposable PostgreSQL readiness and is classified as infrastructure-only.

## 6. Blind queue v2

The v2 queue was preregistered before implementation/test inspection and its order did not change after results.

| Round | Domain | Axes | Outcome | Three-arm CI receipts |
| --- | --- | --- | --- | --- |
| A | team | D0×D1 | HIT | 2513 / 2518 / 2519 |
| B | catalog | D0×D2 | HIT | 2544 / 2551 / 2552 |
| C | public-booking | D0×D4 | HIT | 2557 / 2582 / 2583 |
| D | calendar | D4×D5 | HIT | 2597 / 2609 / 2610 |

Within this four-round preregistered queue, the incremental discovery rate was 4/4.

This is strong repository-specific evidence but a small sample. It is not a general estimate of H19 performance.

## 7. Equal-budget benchmark v1

### 7.1 Goal

Benchmark v1 compared **selection strategies**, not generic test-generation technologies.

The frozen cohort contained four already-accepted user-reachable domains:

1. customers;
2. product-sales;
3. expenses;
4. reporting.

Each selector received four frozen domain×pair allocations.

### 7.2 H19 semantic selector

- customers → D1×D5
- product-sales → D1×D5
- expenses → D1×D2
- reporting → D0×D4

### 7.3 Coverage-first baseline

Within each domain's contract-explicit eligible pairs, the baseline selected the globally least-represented permanent pair at preregistration, with lexicographic tie-breaking. Unlike H19 geometry credit, the baseline was allowed to select holdouts.

- customers → D0×D5
- product-sales → D0×D2
- expenses → D1×D4
- reporting → D2×D4

### 7.4 Final benchmark outcomes

| Cell | Selector | Domain | Axes | Outcome |
| --- | --- | --- | --- | --- |
| H-A | H19 semantic | customers | D1×D5 | HIT |
| H-B | H19 semantic | product-sales | D1×D5 | ALREADY_COVERED |
| H-C | H19 semantic | expenses | D1×D2 | HIT |
| H-D | H19 semantic | reporting | D0×D4 | ALREADY_COVERED |
| B-A | coverage-first | customers | D0×D5 | HIT |
| B-B | coverage-first | product-sales | D0×D2 | HIT |
| B-C | coverage-first | expenses | D1×D4 | INVALID / excluded |
| B-D | coverage-first | reporting | D2×D4 | HIT |

Preregistered primary counts:

- H19 semantic: **2 HIT / 4 valid selections = 50%**
- coverage-first: **3 HIT / 3 valid selections = 100%**
- coverage-first allocated-budget view: **3 HIT / 4 frozen selections = 75%**, with one invalid/excluded cell

The coverage-first selector produced more incremental current-suite blind-spot discoveries in this frozen v1 cohort.

This benchmark does not establish general superiority for either selector. The cohort has only four domains, the baseline has one excluded cell, and intervention-design inspection was not fully double-blind across selectors sharing a domain even though all pair selections were frozen prospectively.

## 8. Threats to validity

### Construct validity

The six axes were designed for an authority-heavy transactional SaaS. Other systems may require different semantic dimensions.

### Intervention validity

A variation can accidentally target an obsolete definition. The final-effective preflight was introduced to reduce this risk.

### Observer and selection effects

Prospective freezing reduces post-hoc selection but does not eliminate researcher judgment in choosing domains, semantic variations, and probes.

### Shared-domain contamination

In benchmark v1, once one selector's intervention exposed a domain implementation surface, later intervention design in the same domain was not fully blind. Pair selections remained frozen, so the benchmark is best described as a **selection-strategy comparison under a common intervention protocol**, not a fully double-blind comparison of intervention design.

### Small sample

Blind queue v2 has four rounds. Benchmark v1 has eight allocated cells and seven valid cells. No statistical population-level conclusion is justified.

### Repository dependence

The case study has strong tenant, idempotency, snapshot, time, and concurrency semantics. Results may not transfer to systems with different fault structures.

## 9. Claims supported by v1 evidence

Supported:

> H19 repeatedly generated incremental executable regression tests in an authority-heavy transaction system under preregistered three-arm evidence.

Supported:

> The frozen 19-row geometry is sparse and diagnostically local: selected pair-positive supports have fanout one, while three antipodal pair supports are deliberately held out.

Supported:

> In blind queue v2, four preregistered selections produced four incremental discoveries.

Supported:

> In benchmark v1, coverage-first selection found more incremental blind spots than H19 semantic selection in the frozen cohort.

Not supported:

- H19 is generally superior to covering arrays.
- H19 is generally superior to coverage-first, random, or expert selection.
- H19 replaces pairwise or combinatorial testing.
- 19 rows universally suffice for interaction testing.
- the current sample establishes a new general testing law.

## 10. Reproduction and evidence references

Repository: https://github.com/ziyabeey/randevu

Primary evidence records:

- blind queue v2: https://github.com/ziyabeey/randevu/issues/454
- benchmark v1 preregistration and terminal scoreboard: https://github.com/ziyabeey/randevu/issues/485
- benchmark promotion record: https://github.com/ziyabeey/randevu/issues/519
- promotion PR: https://github.com/ziyabeey/randevu/pull/520
- permanent gate: `supabase/tests/h19_integrity_gate.sql`
- gate support/provenance registry: `supabase/tests/h19_test_support.sql`
- static fail-closed verifier: `scripts/verify-ci-coverage.mjs`

The machine-readable files in this directory carry the benchmark rows and permanent evidence manifest needed to audit the stated counts.
