# M11 development observation supplement 001

All ten remaining development anchors now have saved observations. The three
new suites passed **10 top-level controls and five nested checks**. Combined
with bridge 001, eligibility is **three unique M9 cases bound to nine anchors**,
13 no-hypothesis anchors and zero missing observations. No functional defect or
independent relation label was established.

## Execution and denominators

Plan, collector and static audit were committed before execution in
`2af9b7b5f4cf825814b0aa749dae081192a3f636` at **13:03:54 UTC**, 2026-09-25.
Collection ran **13:03:57.449–13:04:01.063 UTC**, once per selected suite, using
Node v24.19.0. This interval includes temporary source preparation and cleanup;
it excludes initial input verification, dependency download and process startup.
It is not an end-to-end performance benchmark.

| Suite | Main controls | Nested checks | Result | Evidence boundary |
| --- | ---: | ---: | --- | --- |
| F12 notification status | 2 | 0 | Passed | Shared helper runtime plus Worker source assertions |
| F12 service price range | 4 | 0 | Passed | Source assertions only; no UI or DB execution |
| S07 runtime budgets | 4 | 5 | Passed | Local HTTP timeout checks and mocked notification/scheduled calls |
| New collection | 10 | 5 | 15/15 TAP points passed | Ten anchor bindings, not 15 independent samples |

The earlier inventory prose understated nested checks as three; there are five
because the two final-RPC variants each create a nested test. Frozen anchor
inventories remain unchanged. Across the two seed collections there are 22 main
controls and five nested checks. The separate seven-scenario pagination
validation is not counted as another reference anchor or relation label.

Only 64 development files and eight shared configuration files were copied into
the temporary execution tree. The held-out two-file component was absent.
The required external package was Hono **4.13.8**, verified against the pinned
lockfile's SHA-512 archive integrity before extraction. No install scripts ran.
Child processes received explicit Node/TZ/locale settings without application
credentials. V8 recorded 42 repository modules and 29 Hono files for the runtime
suite; the other suites loaded two and one repository modules respectively.
All observed file loads stayed inside the declared boundary.

## What the measurements support

| Target and suite | Called / observed named V8 entries | Uncalled entries | Eligibility |
| --- | ---: | --- | --- |
| Shared notification status helper; F12 status | 2 / 2 | None | No M5 gap hypothesis |
| Worker entry; S07 runtime | 1 / 2 | `fetch` | M5 hypothesis retained; no independent eligible importer fact |
| Worker notifications; S07 runtime | 19 / 21 | `validGroupSummary`, `renderTemplateV2` | One new M9 case; two positive production importer witnesses |
| Outbound request; S07 runtime | 5 / 6 | `rejectBoundary` | One new M9 case; three positive production importer witnesses |
| Eight source-only target observations | Unknown | Unknown | No fabricated zero coverage or gap |

Named V8 entries include inferred names for function expressions. In the pinned
outbound helper, `rejectBoundary` initially refers to `() => undefined` and is
immediately replaced by the Promise executor's reject function. Its uncalled
initial entry does **not** demonstrate an untested timeout behavior. The existing
suite actually passes header/body deadline and caller-abort checks. M9 eligibility
is a mechanical evidence criterion, not validation of a useful test opportunity.
Do not change production code merely to call this placeholder.

The notification template functions are the more useful next candidate for a
separate, prospectively specified behavioral validation. Current passing seed
tests do not validate those functions or establish whole-product correctness.

## Provenance and combined flow

The new bounded static scan contains **144 positive relative import/re-export
edges and zero unresolved relative imports within its declared inputs**. It is
not a complete semantic call graph or complete fan-in claim. All dependency
facts retain its single audit root. Coverage facts retain their original whole
suite-run root. Shared files, one development component and reused suite runs
mean these are correlated observations, not independent statistical trials.
The global repository closure is split metadata and is never used as a fact root.

| Combined development flow | Count |
| --- | ---: |
| Frozen development anchors / recorded receipts | 22 / 22 |
| Materialized anchors | 9 |
| No-hypothesis anchors | 13 |
| Missing-observation anchors | 0 |
| Unique M5 packets / M9 batches | 5 / 5 |
| Unique M9 cases | 3: one preserved + two new |
| Additional skipped path hypotheses | 1, bound to four runtime anchors |
| Independent relation assessments / newly established functional defects | 0 / 0 |

The skipped `worker/entry.ts` hypothesis has only a coverage fact. A test importer
or common runtime configuration is not relabeled as independent production fan-in.
Every original receipt, materialization row and case from bridge 001 is retained
unchanged. No evaluation test, model call or real provider delivery was made.

New case identities:

- Notifications: `2b924bfe4d9dc5e15d40199189b6b8070bee47d2cca3dc68eb24357f660e33f2`.
- Outbound request: `998d3c0f62199184d8f9c8b86474d6af8f9177db471d06fe2bfc654ffef75113`.

The evaluation group still has two anchors in **one** component. It remains a
descriptive feasibility sample, unsuitable for independent n=2 inference or
calibration claims. Independent assessment and any budgeted comparison remain open.

## Reproduction and verification

Inputs and outputs: [PLAN.json](PLAN.json), [STATIC-AUDIT.json](STATIC-AUDIT.json),
[COLLECTION.json](COLLECTION.json), [BRIDGE.json](BRIDGE.json).

Plan SHA-256: `a9a5450b1b0965d7e60caff6fe38f7f297b01a0ec4580047d1ed1438aab49cb2`.
Collection SHA-256: `f611762898cee59b00888ca5bda484f5c901b2fa95652ca35fe75b403de88ddf`.
Combined bridge SHA-256: `24fc94cbbe6aa2e1491f25c3ba593859a2476fe3e25b24b6f0b1d749bf44c50d`.

From repository root with the exact pinned product source snapshot:

```bash
node tools/h19-kit/bin/h19-m11-supplement-bridge.mjs \
  tools/h19-kit/experiments/m11 \
  a9a5450b1b0965d7e60caff6fe38f7f297b01a0ec4580047d1ed1438aab49cb2 \
  f611762898cee59b00888ca5bda484f5c901b2fa95652ca35fe75b403de88ddf \
  /path/to/pinned-source > /tmp/m11-supplement-replay.json

H19_M11_SOURCE_ROOT=/path/to/pinned-source \
  npm --prefix tools/h19-kit run test:m11-supplement
```

The smoke replays saved evidence, not product test execution. It checks source,
producer and dependency identities; nested counting and failed/partial/skip
rejection; raw TAP/V8 summaries; evaluation exclusion; preserved original roots,
receipts and cases; and full materialization equality. It passed locally. Existing
CI checks remain unchanged with one additive receipt smoke; exact candidate CI
run/job/attempt is recorded in the draft PR.

For a new empirical run, pass the same artifact directory, plan hash, pinned
source directory and exact verified Hono archive to `h19-m11-supplement.mjs`.
Write to a new output file: timestamps and measured counts can differ. Never
overwrite the saved collection or present a rerun as its original observation.

Next: freeze a bounded behavioral validation for the notification template case,
with expectations from pre-existing contracts, before executing it. Parent stack
review/main acceptance and the M11 comparison gate are still pending.
