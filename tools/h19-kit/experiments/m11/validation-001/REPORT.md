# M11 targeted validation 001

**One suite-scoped coverage hypothesis is confirmed. All seven new unit
scenarios passed, and all four originally uncalled functions were exercised.**
No functional defect was demonstrated by these scenarios. This is a development
measurement; independent relation assessment and the full M11 comparison remain
pending.

| Measurement | Recorded result |
| --- | ---: |
| Attempted M5 hypotheses | 1 |
| Confirmed coverage gaps / inconclusive | 1 / 0 |
| New targeted scenarios passed | 7 of 7 |
| Previously uncalled entries now called | 4 of 4 |
| Original suite: called named V8 entries | 5 of 9 |
| New targeted suite alone: called named V8 entries | 5 of 9 |
| Union of the two recorded runs: called named V8 entries | 9 of 9 |
| Functional defects established | 0 |
| Relation assessments / provider calls | 0 / 0 |

The union deduplicates exact name/start/end identities. It does not add 5 + 5:
`validTimestamp` is shared by both runs. The four additions are `validDate`,
`encodeBookingPageCursor`, `decodeBookingPageCursor` and `bookingPageResult`.
**9/9 refers only to named function entries in `worker/pagination.ts`**, not
line coverage, branch coverage, all input combinations or the whole product.
The added suite is retained as an experiment, not automatically promoted into
the product's permanent regression suite.

## What the new scenarios checked

| ID | Behavior | Expected-behavior source |
| --- | --- | --- |
| V01 | Preserve a valid leap-day range, row key and revision | F13-02 date-range contract |
| V02 | Preserve the unbounded null/null range | F13-02 compatibility contract |
| V03 | Legacy booking cursor versions request restart | F13-02 v3 transition contract |
| V04 | Require paired, valid, increasing calendar dates | F13-02 paired range and half/reversed-range acceptance |
| V05 | Continue from the last visible row; omit the extra probe row | S07-C2 limit+1/keyset contract |
| V06 | Empty, short and exact-limit final pages have no continuation | S07-C2 continuation contract |
| V07 | Preserve the fixed row sequence and date range across helper pages | S07-C2 stable traversal and F13-02 range binding |

Prior sources at product revision `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`:

- `docs/handoffs/F13-02.md`, Git blob `8d53a553c780bd2b9e9d5d81565adda3537dfb37`.
- `docs/plan/s07-c2-pagination-budgets.md`, Git blob `2c47655de380a1a9577a0a551d3289f8385c6c75`.

The suite was authored by Codex after inspecting the helper and prior contracts.
It is a separate observation, **not a blinded assessor or automatic M7-generated
candidate**. The abbreviated wire fields are characterized from the existing
helper schema; the product documents supply behavioral expectations rather than
an independent wire-format specification. Encoding is also inspected with
standard JSON/base64 primitives, avoiding a round trip as its only check.
This pure helper test does not exercise HTTP, database ordering, concurrent
writers, business-timezone conversion or DST behavior in PostgreSQL.

## Freeze and execution

- [Plan](PLAN.json) and [suite](booking-pagination.test.mjs) were sealed before
  execution. Remote pre-execution commit:
  `efc19df4d4c1bdfdada4741521c589cece248f2e` at **12:16:26 UTC**.
- Plan timestamp: **2026-09-25 12:15:34.721 UTC**.
- First and only retained empirical run: **12:16:39.012–12:16:40.151 UTC**
  (**15:16:39–15:16:40 Istanbul**), Node **v24.19.0**.
- Isolated temporary tree: the frozen suite, `worker/pagination.ts` and its sole
  repository dependency `shared/base64.ts`. No evaluation file, product source
  modification, original-suite rerun, live service or provider was involved.
- Internal setup/verification: **204.4 ms**; child test execution: **900.7 ms**;
  recorded runner interval: **1,139.1 ms**. The interval excludes process/module
  startup and final result assembly/output. These are one-run local observations,
  not an end-to-end H19 benchmark or a speedup claim.

The frozen decision rule requires seven passing named controls and positive
execution of every original uncalled entry. Incomplete execution, missing
coverage or failed controls produce `inconclusive`; failures are not
automatically classified as product defects.

## Bound result

| Artifact | SHA-256 |
| --- | --- |
| Plan | `77d82b1ee762f86bf679236eaf0b3b6331e80598ea0232289e76b42972a38f4a` |
| Existing M9 case | `bf214c9fa35b06b906c149fb8415549040131aa33b91a1c1c9b582ad915c39ad` |
| [Result with raw TAP/V8](RESULT.json) | `07f6bb0527a8c835dbb775785b29456ef99224c88ff9bb67e217cb01e05f7e93` |
| Outcome source | `6c5ace8e3697aa6c34233a43957e81a8f7053af84286197de3733dba43d33066` |
| M8 outcome | `42b0ae3dfbb1e7bfc2bd4e25d74579006c40fffd8d9ddefbc9627f3e6bc2770c` |

The M8 outcome is `m5-validation / confirmed`, bound to the existing case and
observed product revision, with no model judgment. Its source explicitly says
the endpoint is a suite-scoped coverage gap. It is not a relation-class label,
bug probability or a claim of defect absence. The five anchor bindings still
represent one unique case and one attempted hypothesis.

The two oracle documents are recorded as additional development outcome inputs.
Their Git identities are checked against the complete pinned snapshot; no
evaluation path overlaps. The original case, inventories and source closure are
unchanged. This receipt accounts for its own inputs; future observation lineage
remains incomplete. If later outcomes reuse these roots across splits, the
separation must be checked again.

## Replay and rerun

The receipt check replays the saved observation, M5 decision, M8 outcome and
coverage union without executing the product again:

```bash
npm --prefix tools/h19-kit run test:m11-validation
```

To perform a **new** targeted run, use Node v24.19.0 and a separate checkout of
the pinned product revision as `SOURCE_ROOT`:

```bash
node tools/h19-kit/bin/h19-m11-validate.mjs \
  tools/h19-kit/experiments/m11 \
  tools/h19-kit/experiments/m11/validation-001/PLAN.json \
  77d82b1ee762f86bf679236eaf0b3b6331e80598ea0232289e76b42972a38f4a \
  SOURCE_ROOT
```

The CLI writes JSON to stdout. Do not overwrite the historical result with a
rerun: timestamps, timings and observation identities will differ. Plan,
candidate and producer byte identities must match before execution. Invalid
inputs fail without an outcome; transport/partial runs retain inconclusive
evidence where parseable. Existing required CI remains separate from this
empirical record and its outputs are not imported as labels.

Next: collect the ten still-missing development observations under the refrozen
inventory. Independent relation labels, a concrete paid-comparison budget and
more independent evaluation components are still required for later M11 claims.
