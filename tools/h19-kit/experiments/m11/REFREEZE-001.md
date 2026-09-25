# M11 source split repair 001

The original split had overlapping source dependencies. The versioned repair
keeps all 24 anchors and groups shared-file components together: **22 development
anchors / 2 evaluation anchors, with one repository component in each split**.
The groups share zero repository files under the frozen profile. The evaluation
sample remains too small for general performance, accuracy or calibration claims.

The [v0.2 amendment](../../specs/M11_COHORT_REFREEZE-v0.2.md) defines the exact
boundary between per-scenario source/evidence files, locked external modules,
common environment and future uncollected evidence. This is a review candidate;
the parent stack and independent evidence gates remain open.

## Artifacts

| Artifact | SHA-256 |
| --- | --- |
| [Complete Git file snapshot](SOURCE-SNAPSHOT-001.json) | `153958b516547d5e9854c62356a704f5b10a2819b6391aed20725a31d2c95c32` |
| [Repository file closure](REPOSITORY-CLOSURE-001.json) | `55a9fc202bb79e809d991beef4af83260f335fa7fde40eb402db668f6069b7ea` |
| [Candidate inventory v0.2](COHORT-v0.2.json) | `79b802f95f6612a628ea23d8d7cb2cf6719465124a35743fa956eff4784ff662` |
| [Source readiness](SOURCE-READINESS-002.json) | `d5cf4e46d99a84d3554dd86dd42fd98cff87eb31a537b430a49ad36bbd279c47` |

Source: `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.
Git tree: `e85fd3faf26671b2a5137d99b1be7765f06bb13c`.
Evidence-engine pin remains `6a37baebca749482465d3dd302f9bae56d3ff2e0`.
Collection environment: Node v24.19.0; parser package 6.0.2, compiler 6.0.3.

## Results

- Complete Git index: 680 file entries; tree identity reconstructed with Git's
  binary tree encoding. No source inventory inferred from a partial checkout.
- Reachable source/evidence inputs: 66 files, 157 local reference edges,
  58 external import references, zero unresolved inputs under the profile.
- Common context: eight separately bound configuration/lock files.
- Development component: pagination, public-selection, catalog-price-projection
  and runtime-notification; 22 anchors, 64 files.
- Evaluation component: calendar-refresh; 2 anchors, 2 files.
- Materializer source readiness: 22 source-bound anchors, 64 verified files,
  22 missing-observation skips, zero packets/batches/cases.

The readiness run contains zero observations; it demonstrates that the repaired
source split passes the existing boundary. It is not completed M11 measurement.
No evaluation suite, product change, label, independent outcome or provider call
was executed by this slice. Existing required product CI remains separate and
its test results are not imported as M11 labels.

## Reproduce

Use this tool branch and a separate checkout of the pinned product commit as
`SOURCE_ROOT`. The CLI needs the reachable files and the eight common context
files; the complete index is checked independently against its pinned Git tree.
From the tool repository root:

```bash
npm install --prefix tools/h19-kit --ignore-scripts --no-audit --no-fund
node tools/h19-kit/bin/h19-m11-refreeze.mjs \
  tools/h19-kit/experiments/m11/COHORT-v0.1.json \
  68a7608ab16442112263d477b25dec5cb3fd48e5d2caa345c2828c81f965b541 \
  tools/h19-kit/experiments/m11/SOURCE-SNAPSHOT-001.json \
  153958b516547d5e9854c62356a704f5b10a2819b6391aed20725a31d2c95c32 \
  SOURCE_ROOT
npm --prefix tools/h19-kit run test:m11-closure
```

The JSON response contains `closure`, `inventory` and `readiness`. Inputs are
snapshotted before asynchronous reads; source identity/configuration errors
fail. Unknown dependencies produce a blocked response with no new inventory or
readiness. A completed traversal with no evaluation component records that
condition and omits readiness. No source, test or existing artifact is modified.

Exact environment changes alter the closure and inventory identities. Reproduce
the historical digests using the recorded runtime/parser versions; never rewrite
old observations to make a new environment appear identical. The tool cannot
prove honest independent assessment from hashes or certify arbitrary dynamic
runtime behavior outside its explicit profile.

## Next action

Bind the real development coverage/source observations to an actual M5 discovery
packet and independently sourced M9 facts, then check eligibility and all lineage
again. Keep the sample descriptive and preserve skips. More independent
evaluation components are required before any confirmatory accuracy claim.
