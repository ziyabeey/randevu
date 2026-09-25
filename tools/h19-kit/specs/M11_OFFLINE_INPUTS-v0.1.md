# M11 offline inputs v0.1

This bounded development-split adapter implements input preparation for the
[proposed M11 measurement gate](RELATIONAL_MEASUREMENT_GATE-v0.1.md). It does not
complete empirical M11 evaluation or confer acceptance on its parent proposal.

## Entry points

- `src/experiments/m11-materializer.mjs`: `materializeM11Development`,
  `validateM11Materialization`, `validateM11Inventory`, `freezeM11Observation`,
  `m11FactFromObservation`, `m11Digest`, `m11SourceBlobSha`.
- `bin/h19-m11-materialize.mjs`: offline file reader; JSON on stdout, nonzero
  exit and no JSON result for invalid input. It does not invoke a shell, test,
  provider, network client or code generator.
- `npm --prefix tools/h19-kit run test:m11-materializer`: synthetic contract
  checks; not empirical pilot evidence.

`materializeM11Development` accepts a frozen inventory, separately trusted
`expectedInventorySha256`, a byte reader `readSource(path)`, and optional
`observations`. It snapshots caller-owned data before asynchronous reads.

## Trust boundary

The adapter verifies identities and the internal consistency of producer-supplied
observations. It cannot prove that a producer ran a command, captured all
dependencies, or truthfully declared independent root inputs. Content hashes are
integrity bindings, not signatures or independent scientific validation.

Source-only mode verifies exact inventory bytes and control-name presence for
development anchors. Without observations every anchor is retained as
`missing-observations`; no empty M5 packet, inferred coverage or fake fact is made.
Evaluation source content is never requested by the adapter. A corrupt supplied
receipt/source fails the complete call; corruption is not an ordinary missing row.

## Observation bundle

The optional JSON object has these fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` / `kind` | `1` / `m11-offline-observations` |
| `inventorySha256` | Exact trusted scenario inventory |
| `sourceRevision` | Same pinned product revision as inventory |
| `clusters` | One producer-declared complete source/dependency closure per inventory cluster |
| `receipts` | At most one receipt per development anchor; evaluation/unknown IDs rejected |
| `bundleSha256` | `m11Digest(bundle without bundleSha256)` |

Each cluster is `{ cluster, complete: true, sourceBindings: { path: gitBlobSha } }`.
It must contain every reference suite and primary target in that cluster, plus
the producer's full dependency/evidence-source closure. Known inventory bindings
cannot change. A source path cannot cross development/evaluation boundaries;
shared development paths must have identical identities. Evaluation closure
metadata is checked, but its file contents and outcome labels are not read.
Missing/incomplete closure is a hard error for a supplied observation bundle.

Source paths are normalized relative paths with no hidden/traversal segments.
The CLI also checks resolved paths stay within the supplied source root. Source
bytes must reproduce their pinned Git blob SHA-1, including UTF-8 byte length.
Extra dependency bindings are producer declarations verified against supplied
bytes; they are not independently authenticated Git commit membership proofs.

## Per-anchor receipt

A receipt carries `anchorId`, `packetArtifactSha256`, `changeArtifactSha256`,
`artifacts`, `factPool`, and `relationships`.

All artifacts are sealed with `freezeM11Observation`:

| Field | Required value |
| --- | --- |
| `schemaVersion` | `1` |
| `kind` | `m5-packet`, `change`, `fact-source`, or `relationship-source` |
| `producer` / `producerVersion` | Nonempty producer identity/version |
| `sourceRevision` | Pinned product revision |
| `sourcePaths` | Nonempty unique paths within this anchor's declared cluster closure |
| `rootDigests` | Nonempty unique SHA-256 identities of original observation inputs |
| `payload` | Kind-specific producer data |
| `artifactSha256` | `m11Digest(artifact without artifactSha256)` |

Root digests must remain shared when two facts descend from the same original
measurement. A new wrapper, producer or fact name does not create independence.
The adapter derives fact lineage from these root digests and rejects caller
lineage that differs; independent review must still verify the root declarations.

Payload contracts:

- `m5-packet`: `{ packet }`, an existing frozen M5 packet. Its canonical schema,
  digest, revision, hypotheses and anchor target bindings are checked. The
  adapter does not invent an M5 discovery report from source filenames.
- `change`: `{ mode, changeId, changedFiles }`; mode is `change` with nonempty
  paths, or `baseline` with no changed paths. Identity and files bind the packet.
- `fact-source`: `{ facts: [...] }`; each record uses M8 fact fields plus optional
  `evidenceIds`, excluding `provenance` and `lineageIds`. The adapter derives
  provenance from the artifact and verifies the supplied scoped M9 fact equals
  that normalized record. Unknown values remain null. No arbitrary baseline,
  sample size or metric calculation is introduced by the adapter.
- `relationship-source`: the observed relationship fields excluding `sourceId`
  and `relationDigest`; the adapter derives the M9 record using the artifact
  digest as `sourceId` and checks both source paths.

Provider-result and label/outcome keys are rejected recursively in the bundle;
the `validation` fact family is also excluded from these pre-judgment inputs.
This schema check does not detect a dishonest producer hiding a label inside an
unrelated scalar. The collection protocol and independent assessment remain
responsible for semantic separation. No outcome or label is produced here.

## Output and skips

Output is a deeply frozen `m11-development-materialization` v1 artifact. It binds
the inventory, pinned revision, inherited evidence-engine revision, materializer
version, input bundle digest and verified development source bindings. Each
development anchor has a row, including absent observations and M9 skips.

| Row state | Meaning |
| --- | --- |
| `skipped / missing-observations` | No receipt; source binding only |
| `skipped / no-hypotheses` | A valid recorded M5 packet has no hypotheses |
| `skipped / no-eligible-cases` | M9 rejected every hypothesis; exact reasons remain in `hypothesisSkips` |
| `materialized` | At least one M9/M8-validated case; any partial skips remain visible |

Packets, batches and cases are deduplicated by their existing hashes. Two
reference controls sharing one case are two anchor bindings, not two independent
experiments. Anchor counts and unique artifact counts are separate.
The existing 20-case cap applies per M9 packet; a cohort is not one provider batch.

The outer manifest uses `m11Digest(body)` and binds the exact observation bundle.
Input array reordering can therefore change its identity while M9's canonical
case selection stays unchanged. `validateM11Materialization` replays all bindings
from original source bytes and receipts and compares the complete output.

## Acceptance evidence

The focused suite covers exact M9 identity preservation, immutable caller/output
state, Unicode source binding, missing observations, corrupt/stale inputs,
evaluation exclusion, closure overlap, shared-lineage rejection, unknown values,
relationship provenance, duplicate case deduplication, the 20-case bound and CLI
failure behavior. CI adds this check without removing any prior gate.

The [development readiness receipt](../experiments/m11/DEVELOPMENT-READINESS-001.json)
records the actual pinned inventory: 12 source-verified anchors, six source
blobs, 12 missing-observation skips, zero packets/cases. That is an honest input
readiness result, not a completed benchmark or a negative finding about H19.
