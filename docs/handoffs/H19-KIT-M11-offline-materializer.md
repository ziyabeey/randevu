# H19 Kit M11 offline materializer

Task: H19-KIT-M11-MATERIALIZER. Owner: Codex. UTC date: 2026-09-25.
Size: M. Validation: FOCUSED, because input provenance and split isolation are
acceptance boundaries. Live task authority: [TASKS.md](../../TASKS.md).

## Context pack

- User continuation authorizes the bounded offline development-split slice.
- Starting main: `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.
- Stacked parent: #598 at `f2971939a42f5f28647cadf06ee6e9726a24e9cd`, CI #2966 green.
- Branch: `h19-kit-m11-offline-materializer`; parent review/main acceptance remains pending.
- Input: proposed M11 contract and pinned 24-anchor inventory. Implementation
  does not claim independent approval of that proposal or promote its parent.
- Writable scope: one experimental materializer module, one offline CLI, its
  focused tests, package test command and additive CI smoke step, M11 usage/spec
  appendix and development readiness receipt, BUNDLE, own TASKS row, this handoff.
- Preserve M3 hashes and M5/M8/M9 validators; no edits to their semantics.
- Exclude product/DB/UI changes, paid calls, inference, test generation/execution
  in the materializer, evaluation labels, outcome generation, H19s and M12.
- Input records are producer-supplied observations. Integrity validation cannot
  prove an observation actually happened or replace independent review.

## Acceptance

- Verify trusted inventory hash, pinned source bytes and exact development anchors.
- Consume only complete source/lineage closure and provenance-bound M5/fact receipts.
- Reject stale/malformed inputs and cross-split evidence; missing observations
  produce explicit skips rather than synthetic cases or negative outcomes.
- Delegate exact selection and case validation to M9/M8; preserve 20-case cap.
- Deterministic, immutable output, no provider/test runner/network dependency.
- Focused success/negative regression checks, a reproducible 12-anchor readiness
  run and exact-head CI. Existing required checks stay intact.

## Skill and source boundary

No listed skill specifically covers this isolated Node.js experiment adapter.
Existing repo workflow and M3/M5/M8/M9/M11 contracts provide the bounded equivalent.
No UI/browser/DB skill applies; those implementations remain unchanged.

## Implementation and local evidence

- Experimental module and read-only CLI implemented; artifact/source identities,
  producer-declared closures, shared roots and M5/M8/M9 compatibility validated.
- New focused M11 smoke, existing M8 smoke and M9 RC1–RC16 plus 96 golden cases: PASS.
- Node syntax checks and diff hygiene: PASS. No existing CI gate removed;
  an explicit M11 smoke step is added.
- Real pinned development inventory: 12 anchors / six source blobs verified;
  12 `missing-observations` skips, zero packets/batches/cases. Receipt:
  [DEVELOPMENT-READINESS-001.json](../../tools/h19-kit/experiments/m11/DEVELOPMENT-READINESS-001.json).
- Separately executed the two pinned development reference suites: 12/12 PASS
  on Node v24.19.0. Seven are source-text assertions, five are pagination runtime
  checks; no runtime UI or independent M11 outcome claim.
- No provider call, label generation or product change. Observation collection
  and complete dependency closure are missing inputs, not successful measurement.
- Exact publication/CI state is recorded in the PR; main acceptance remains open.

## Next step

After adapter verification, provide independently collected development-split
observation receipts and a full split-closure inventory. A source-only readiness
report must not be presented as a completed measurement or calibration result.
