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
- deterministic M4/M5 synthetic scale probe.

The first runs are measurement-only. Do not invent pass/fail thresholds before the baseline is captured.

### PERF-001 / PERF-002 result

The first two baselines found a blocking performance issue in the current root-level SCIP invalidation strategy:

- first index: ~9.3 s;
- exact-content cache hit: ~28 ms;
- one source-file change: ~8.95 s, or 96.2% of the first-index cost.

The measured single-file change was under `scripts/`, while the explicit product TypeScript projects are rooted in
`src/`, `worker/`, and `vite.config.ts`.

### Next authorized performance gate

Repair TypeScript project ownership and SCIP shard invalidation, then remeasure app-only, worker-only,
unrelated-tooling-change, and exact-content paths.

Do not start the next feature gate until this remediation is measured.

## Next authorized feature gate after performance remediation

**Minimal test specification from validated/high-value coverage hypotheses.**

For a surviving-mutant-driven target, the first specification contract must be able to state:

```text
setup
→ action
→ expected invariant
→ mutation to kill
→ required observations
```

This is the next planned bundle gate.

**No M6 number is assigned here yet.** Freeze the scope and acceptance contract before naming/promoting the next milestone.

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
