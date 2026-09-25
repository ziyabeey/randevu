# M11 development collection 001

**The v0.1 split is invalid for materialization.** Five verified shared-path
witnesses connect development and evaluation clusters. Existing rules already
require a versioned re-freeze before labels or provider calls. The old inventory
is retained unchanged; these observations do not silently redefine its split.

- [Recipe](COLLECTION-RECIPE-001.json): eleven Git blob bindings, each checked
  against the GitHub tree at product commit `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.
- [Collected observations](DEVELOPMENT-COLLECTION-001.json): exact commands,
  runtime, test output, scoped raw V8 records, summaries and import witnesses.
- Inventory SHA-256: `68a7608ab16442112263d477b25dec5cb3fd48e5d2caa345c2828c81f965b541`.
- Collection SHA-256: `e089ce3645fcfd78488ecba02a0bcce4f515517a15fa2ac67c84cab7d2231890`.
- Node v24.19.0; parser package `@typescript/typescript6` 6.0.2 reports compiler
  version 6.0.3. Both identities are retained separately.

## Observed scope

| Reference suite | Passed / executed controls | Runtime observation |
| --- | ---: | --- |
| `s07-pagination.test.mjs` | 5 / 5 | 5 of 9 V8 named-function entries called in `worker/pagination.ts` |
| `f12-public-multi-selection.test.mjs` | 7 / 7 | Source-text checks; TSX/CSS targets were not executed by V8 |

The uncalled named entries in the pagination run were `validDate`,
`encodeBookingPageCursor`, `decodeBookingPageCursor` and `bookingPageResult`.
This is a **single-suite observation**, not whole-product coverage, a new bug,
a count of independent samples or evidence that no other suite covers them.
V8 offsets refer to the instrumented script; no TypeScript line/branch coverage
is inferred. Anonymous functions are excluded from this explicitly named-entry
denominator. Repeated entries are merged by name and offset, not by name alone.
Unobserved UI runtime coverage remains `unknown` with null counts, never zero.

## Split contamination

| Development cluster | Evaluation cluster | Shared pinned paths |
| --- | --- | --- |
| pagination | catalog-price-projection | `worker/pagination.ts`, `shared/base64.ts` |
| pagination | runtime-notification | `worker/pagination.ts`, `shared/base64.ts` |
| public-selection | catalog-price-projection | `src/api.ts` |

The shortest witnesses include `worker/bookings.ts → worker/pagination.ts`,
`worker/app.ts → worker/bookings.ts → worker/pagination.ts`, and both
`src/PublicMultiServiceSelection.tsx → src/api.ts` and
`src/BookingPage.tsx → src/api.ts`. Exact parsed import statements and source
line numbers are retained in the observation. Type-only imports are included
conservatively when encountered; comments and arbitrary strings are not edges.

This bounded audit resolves 13 static import edges and leaves 29 import
references unresolved within its input. It does not inspect all transitive
files, dynamic imports, source-file reads, CSS assets, package/configuration
inputs or other evidence lineage. `complete` is always false. A positive
witness suffices to invalidate the split; no witness never means a valid split.
Evaluation source was read only for import metadata; evaluation tests were not
run and no evaluation outcomes were collected.

## Reproduction and trust

Use a separate checkout of the pinned product commit for `SOURCE_ROOT`, and
this tool branch for the collector. The source root must contain every file in
the recipe. From the tool repository root:

```bash
npm install --prefix tools/h19-kit --ignore-scripts --no-audit --no-fund
node tools/h19-kit/bin/h19-m11-collect.mjs \
  tools/h19-kit/experiments/m11/COHORT-v0.1.json \
  68a7608ab16442112263d477b25dec5cb3fd48e5d2caa345c2828c81f965b541 \
  tools/h19-kit/experiments/m11/COLLECTION-RECIPE-001.json \
  SOURCE_ROOT
npm --prefix tools/h19-kit run test:m11-collection
```

Unlike the read-only materializer, this CLI **executes the trusted pinned
development test suites**. It validates identities before execution, requires
exactly the inventory's development suites, collects V8 output in isolated
temporary directories, clears inherited `NODE_OPTIONS`, bounds each invocation
to 30 seconds, rechecks source bytes, and removes temporary coverage output.
It does not install product dependencies or invoke evaluation/provider code.
Hashes bind producer records; they are not signatures or proof of completeness.

Stdout is a JSON receipt; malformed input, missing files, timeout or malformed
coverage fails with nonzero exit. A completed reference test failure, when a
valid TAP summary exists, is retained with its nonzero `exitCode`; process
success means collection completed, not that every test passed. CI checks the
collector using local fixtures and replays the saved raw measurements; it does
not treat nondeterministic run timing as a golden value. A fresh collection has
a different digest when timings or runtime differ.

## Gate and next action

The real materializer was not invoked: zero packets, batches or cases were
produced. The new integration check confirms that shared-source closure also
fails the existing materializer boundary. Coverage and dependency findings have
not been recast as independent M8 facts or reference relation labels.

Next: expand all five clusters to complete source/evidence closure, compute
connected components, and freeze a new inventory version with disjoint groups
before any materialization or labels. The witnesses already join four declared
clusters; moving a single filename or keeping the original 12/12 denominator
would not repair the design. Determine whether enough independent evaluation
components remain, and extend the sampling plan if necessary. No provider run
or empirical H19 effectiveness/calibration claim is authorized by this receipt.
