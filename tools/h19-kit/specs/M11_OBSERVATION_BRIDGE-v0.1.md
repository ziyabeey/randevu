# M11 saved-observation bridge v0.1

This bounded adapter derives development receipts from the original two-suite
collection's separate runtime and bounded static observations. The complete
repository-file closure verifies the repaired split but is not a fact root.
It implements the next preparation step in [the v0.2 split amendment](M11_COHORT_REFREEZE-v0.2.md).
It does not complete M11, alter M5/M8/M9 selection, change enrolled anchors or
provide independent labels, outcomes, review acceptance or a provider budget.

## Trust and replay

`bridgeM11Observations` accepts the old/refrozen inventories, complete Git
snapshot, saved closure, original collection recipe and saved collection,
separately trusted `expectedInventorySha256` and `expectedCollectionSha256`, and
a byte reader. Inputs are snapshotted before asynchronous reads.

The inventory digest transitively binds the old inventory, closure and complete
Git snapshot. The adapter reconstructs the v0.2 component assignment and Git
tree, checks every declared closure input against that tree, then verifies all
development and common-context bytes. Evaluation bytes are not requested.
This reuses the exact authenticated static observation; it does not recalculate
the graph with a different parser or claim to validate arbitrary runtime loads.

The bounded source audit is replayed against its original eleven pinned inputs
with its exact parser versions; all eleven now belong to development. The global
closure includes evaluation files and is never admitted as an evidence root.
The collection retains its original inventory identity and blocked historical
split status. Its digest binds the recipe, raw scoped V8 records, TAP and run
identities. Run/recipe/source/control bindings and raw-summary consistency must
match. All original collection inputs must fit the refrozen development split
and each receiving anchor component. Extra inputs or changed bytes fail the
whole call rather than becoming a missing-observation skip. v0.1 supports the
recorded completed passing controls only; failed, cancelled or partial runs
require a separately specified interpretation.

Hashes prove identity and consistency, not that a producer was honest. This
bridge relies on the previously reviewed collection and closure profile; it
does not turn a user-supplied hash into independent empirical validation.

## Frozen derivation

| Input | Derived record | Limits |
| --- | --- | --- |
| Scoped named V8 entries | Number uncalled, denominator number observed | One suite invocation; not branch/line coverage or a bug label |
| No V8 entries for target | `unknown`, value/denominator `null` | Source-text assertions do not execute UI/CSS |
| Bounded audit import edges | Distinct observed importers under `src/`, `worker/`, `shared/` | Positive witnesses only; not complete fan-in, invocation count or symbol-use count |
| No change observation | Baseline change receipt, empty changed-files list | `safeToNarrow: false`; no invented impacted references |

Only a positive observed uncalled count creates an M5 explicit runtime gap
hypothesis. An unknown UI target receives no change-impact hypothesis. The M5
packet's unknowns explicitly restrict it to a suite-scoped baseline. The
discovery helper's aggregate missing-test suggestion is not imported as a fact.
Every receipt retains collection/run ancestry; no saved run is renamed or rerun.
Facts have no inferred baseline or statistical sample size.

The dependency fact is scoped to the hypothesis path itself: its metric is the
number of directly importing source files witnessed by the bounded audit. It does not use an
unbound related-path scope. All importer paths must belong to the same component.
The complete original audit source set is retained on that static receipt,
including unresolved-import context. The count is a lower bound from positive
witnesses; missing edges are not absent evidence. No environment/configuration
fact is used to satisfy M9.

## Original observation roots

- Coverage and any test result from an invocation share the original
  `observationSha256`, regardless of producer, metric, wrapper or anchor ID.
- Dependency facts retain the whole original `auditSha256`. Different edges,
  metrics or targets derived from that audit do not become independent roots.
- The bounded audit did not consume the V8/TAP collection. Their measurement roots
  differ while their subject/source revision is shared. M9's count of two
  disjoint observation families is **not statistical independence** of those
  facts, reference controls, source components or assessor judgments.
- Rebinding either observation to v0.2 does not create a new original root. The
  new wrapper/bundle digest is provenance, not an extra independent vote.

The [offline materializer](M11_OFFLINE_INPUTS-v0.1.md) validates the derived
receipts and runs M9 unchanged. It deduplicates identical packets/batches/cases
and retains all development rows. A repeated suite case bound to five controls
is one case, not five independent trials. Empty UI packets remain visible.
`complete: true` covers repository file inputs of these current receipts only;
future observation lineage remains explicitly incomplete.

## Entry points and validation

- Module: `src/experiments/m11-observation-bridge.mjs`.
- Read-only CLI: `bin/h19-m11-bridge.mjs ARTIFACT_DIR INVENTORY_SHA256 COLLECTION_SHA256 SOURCE_ROOT`.
- Focused test: `npm --prefix tools/h19-kit run test:m11-bridge`.
- [Real result and reproduction](../experiments/m11/BRIDGE-001.md).

The CLI reads fixed artifact filenames and writes JSON to stdout. It rejects
source-root escapes, runs no shell/test/provider/network and writes no input
files. Invalid inputs return a nonzero exit with no result JSON. Tests cover
immutable inputs, wrong hashes/bytes, rehashed inconsistent V8/TAP/ancestry,
evaluation exclusion, unknown values, duplicate-vote rejection, real M9 replay
and CLI behavior. Existing required CI gates remain unchanged.
