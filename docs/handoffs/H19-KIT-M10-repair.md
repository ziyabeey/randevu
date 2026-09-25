# H19 Kit M10 bounded repair

Task: H19-KIT-M10; owner: Codex, user-authorized repair on 2026-09-25.
Size: M. Validation budget: FOCUSED (cache durability and exact selection equivalence).
Source of task state: TASKS.md. Existing PR: #594.

## Context pack

- Starting main: `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.
- Starting candidate: `3ca0c03693023b605caac59c11fad8a9cbad52a3`.
- Branch: `h19-kit-m10-relational-judgment-batch`.
- Stacked base: v0.3 freeze `e8171ec210ca5f942ac846f6e3fafce041c3c3ea`.
- Approved repair: preserve successful judgments after cache persistence errors;
  verify exact single-case request digests; reduce M9 selection allocations and
  unnecessary overflow work without changing RC1–RC16 output.
- Writable scope: M9 composer, M10 batch and Jev adapter; their existing tests;
  focused performance evidence, README/BUNDLE clarification, TASKS row and this receipt.
- Outside scope: H19s, product/DB/auth, provider/model/question versions, selection
  objective, emitted batch format, dispatcher authority, live provider experiments.
- Contract: scientific artifacts and deterministic choices stay unchanged;
  cache persistence diagnostics remain outside scientific run identity.
- Acceptance: existing M8/M9/M10 checks; successful sibling results during cache
  write failure; exact request binding; real abort and 20-request bounds; frozen
  exhaustive selection equivalence; large-pool/overflow measurements; required CI.
- Skills: no listed skill specifically covers this isolated Node.js algorithm;
  use existing repo contracts and tools. No UI/DB skill applies.

## Repair receipt

Implemented repairs:

- cache write failures preserve all accepted results and continue sibling writes;
  sanitized diagnostics are outside scientific run identity;
- cached and live request digests are verified against exact single-case bodies;
- M9 uses streaming exact search with admissible pruning and stops optimizing
  overflow cases, while preserving their precise valid/invalid skipped reasons;
- README/roadmap/task links now describe the current advisory library boundary.

Local validation (Node v24.19.0): M6/M7/M8/M9/M10 smoke PASS; M9 includes 96
original exhaustive-selector golden cases plus order reversal, 100-fact
minimality and mixed overflow; M10 includes cache failure, request binding,
real timeout, wrong-model/extra-answer isolation and 20 concurrent requests.
`git diff --check` and modified module syntax checks passed.

Performance: M9-REPAIR-001, same 24-fact synthetic input, one warmup and five
alternating paired measurements: median 507.54 ms original vs 18.82 ms repaired
(26.96x in this local microbenchmark), identical batch digest. The repaired
101-fact two-family fixture took 12.70 ms. These are selector-only observations;
no provider, whole-CI or universal asymptotic speed guarantee is claimed.

No live provider call or application/DB migration change. Full required CI runs
on the remote exact head after publication. No main acceptance or independent
reviewer approval is claimed by this receipt.

Next concrete step: verify exact-head CI and the remaining independent review
before considering any M11 work or parent-ordered promotion.
