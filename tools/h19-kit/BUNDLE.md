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

## Performance synthesis — accepted

The M0→M5 performance line is now closed with both correctness and operational cache evidence.

Evidence chain:

- PERF-002 exposed whole-root over-invalidation: a one-file change cost ~8.95 s, about 96% of first-index cost.
- PERF-003 proved project-scoped invalidation: a real app-source edit dropped from 5.66 s whole-root reindex to 3.87 s single-shard reindex, with unchanged shards reused.
- GRAPH-EQ-001 proved exact semantic equivalence: 77/77 documents, identical 9,686-node graph digest, 20/20 blast-radius samples.
- #581 adopted the project-scoped TypeScript evidence graph and kept whole-index fallback/fail-closed boundaries.
- #584 synthesized cross-run cache transport, cache-first tool planning, bounded cache pruning and the adopted graph path.

### Cold synthesis receipt

CI `36092255998`, head `765b7187559f688460739432a6711f7746fe0706`:

- initial plan: 0 hits / 3 misses;
- graph blocked on index misses;
- indexer required: true;
- decoder required: true;
- 3 shards materialized;
- final plan: 3 hits / 0 misses;
- merged graph: hit;
- documents: 77;
- graph nodes: 9,686;
- final `ready=true`.

### Warm synthesis receipt

A documentation-only continuation produced exact head
`ae377a15e212267dd9be6d589dda1c8afb16a0a7`.

CI `36092698821` passed with:

- initial plan: 3 hits / 0 misses;
- initial merged graph: hit;
- `needsIndexer=false`;
- `needsDecoder=false`;
- scip-typescript installation: skipped;
- Go decoder setup: skipped;
- SCIP decoder build: skipped;
- materialization work: none;
- cached project-shard graph build: 75.353 ms;
- graph key unchanged: `352706ff46d2a99068927959f895dbacb65bbd38249387956d04b346497a63bb`;
- 77 documents / 9,686 graph nodes;
- final `ready=true`.

The absolute timings are evidence from GitHub-hosted runners, not frozen latency thresholds. The accepted production invariants are exact semantic equivalence, project-scoped invalidation, content-addressed reuse, cache-first external-tool skipping, and fail-closed graph construction.

**Performance production synthesis is complete.**

## Next authorized integration gate

The prepared feature line remains:

- #560 — frozen Test Specification Gate v0.1;
- #561 — M6 minimal test specification;
- #564 — frozen Executable Test Candidate Gate v0.1;
- #566 — M7 executable test candidate.

Those PRs are green on an older lineage and must not be promoted directly.

The next authorized action is:

1. carry #560's frozen schema and contract byte-for-byte onto this accepted synthesis closeout;
2. require exact-head CI green;
3. restack #561 M6 implementation on that accepted gate without dropping any synthesis/cache code;
4. require exact-head CI green;
5. only then repeat the same gate-before-code sequence for #564/#566.

No post-M7 milestone is authorized until that revalidation chain is green.

For a surviving-mutant-driven target, the M6 contract remains:

```text
setup
→ action
→ expected invariant
→ mutation to kill
→ required observations
```

M6/M7 remain **HOLD** only until their synthesis-based restacks pass. No new feature semantics are introduced during restack.

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
