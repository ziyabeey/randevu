# H19 Kit M11 dependency closure and inventory re-freeze

Task: H19-KIT-M11-REFREEZE. Owner: Codex. UTC date: 2026-09-25.
Size: M. Validation: FOCUSED, because source closure and split leakage determine
whether materialization can proceed. Live authority: [TASKS.md](../../TASKS.md).

## Context pack

- User continuation authorizes completing dependency mapping and repairing the
  contaminated experiment split before any labels or provider calls.
- Starting main/product pin: `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.
- Parent: #600 at `196e634f9962eeaba04cae9440879c42f852ec81`; CI #2968 attempt 2 passed.
- Branch: `h19-kit-m11-lineage-refreeze`. Parent review/main acceptance pending.
- Known blocker: five source-sharing witnesses already connect four of five
  declared clusters. The old 12/12 split cannot be used for materialization.
- Read: frozen inventory and M11 gates, pinned repository tree, transitive source
  dependencies, exact reference-suite file reads and environment/config metadata.
- Write: dependency closure/refreeze module and CLI, focused tests, additive
  package/CI entry, versioned closure/profile/inventory artifacts and report,
  M11 usage, BUNDLE, own TASKS row and this handoff.
- Preserve old inventory/receipts, scenario IDs, pending labels, source/tool pins,
  M3/M5/M8/M9/M10 semantics, CI gates, H19s separation and dispatcher authority.
- Exclude product/DB/UI edits, execution of evaluation suites, generated tests,
  labels, paid calls, outcome-based selection and stack merge/promotion.
- Acceptance: account for all traversed dependencies or retain explicit unknowns;
  do not declare full closure from a static-import-only scan. Repartition whole
  connected components before labels, retain all enrolled anchors and disclose
  the resulting independent-component counts. If no valid evaluation component
  survives, report that and keep materialization blocked.

## Skill boundary

No listed skill specifically covers this isolated Node experiment-closure tool.
The repository workflow and M11 frozen contracts provide the bounded equivalent.
Product/database/browser implementations are read only as dependency metadata.

## Evidence and next action

- Reconstructed the complete 680-entry Git tree at the pinned product revision.
- Verified 66 reachable source files and eight common context files; traversed
  157 local reference edges and recorded 58 external import references. Zero
  unresolved inputs under the explicit repository-file profile.
- Preserved all 24 anchors and old artifacts. Versioned split: 22 development /
  2 evaluation anchors, one repository component each, zero shared source paths.
- Unknown loaders/file reads, unsupported resolution/configuration and ambiguous
  dependencies block a freeze. Remote behavior/future fact lineage is not certified.
- Existing materializer accepted the empty-receipt source closures: 64 development
  files, 22 missing-observation skips, zero packets/batches/cases. No evaluation
  suite, label or provider call was executed by this slice.
- New closure smoke passed; saved artifacts, Git tree identity and CLI verified.
- [Report and exact artifact identities](../../tools/h19-kit/experiments/m11/REFREEZE-001.md).
- Exact-head CI and publication receipts belong in the PR; main acceptance pending.

Next: derive a real development M5 packet and M9-eligible fact receipts from the
collected observations, retain scope/root lineage and revalidate the split for
those actual facts. A single evaluation component supports only descriptive
feasibility; a confirmatory study requires more independent components.
