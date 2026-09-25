# M11 Cross-Suite Coverage Adjudication v0.1

**Status:** frozen before execution  
**Parent:** M11 development supplement PR #605 exact-head CI-green at `fd948ea4912ee87b2728e44b9d2b0d8ba62809a0`  
**Product source revision:** `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`

## Purpose

Adjudicate whether the M9 notification coverage case represents:

1. a suite-scoped coverage gap already exercised by another existing repository suite; or
2. a gap that still lacks an existing behavioral execution path.

This gate does **not** assess overall product correctness and does not create a new permanent product test.

## Frozen case

- case SHA-256: `2b924bfe4d9dc5e15d40199189b6b8070bee47d2cca3dc68eb24357f660e33f2`
- packet SHA-256: `be406e7e8826694b77414b88095d01251be3e7b56e1cfd66b546e7272521a757`
- hypothesis: `coverage:explicit-runtime-coverage-gap:worker_notifications.ts`
- reason: `explicit-runtime-coverage-gap`
- original observation root: `214d580bf795bef2f6b3b21923d76ce5208032c22434eff549fd0414bc27e848`
- original suite: `tests/s07-runtime-budgets.test.mjs`

The original saved V8 observation reports exactly two uncalled named functions in `worker/notifications.ts`:

- `validGroupSummary`
- `renderTemplateV2`

That is a suite-scoped observation. It is not a claim that no repository test executes those functions.

## Existing adjudication suite

Use the already-existing, pre-pinned repository suite:

`tests/f11-group-notifications.test.mjs`

Pinned Git blob:

`19b8d3dcca7cc23c916682c0ae5b3f26ddf59d68`

The suite predates this adjudication plan and exercises template-v2 notification behavior through `dispatchNotificationBatch` using local mocked RPC/provider responses.

No real Resend, Supabase or other external network request is authorized.

## Pinned source closure

- `worker/notifications.ts` → `1adbfb9a194e2020ceb6fcb861a2cafab5573801`
- `shared/base64.ts` → `6b2cc95af3216c101c7a8d04f673377b0041e17f`
- `worker/outbound-request.ts` → `f75aea0e20f9c1b85ce58f0caef0a8568ccb180d`
- `tests/f11-group-notifications.test.mjs` → `19b8d3dcca7cc23c916682c0ae5b3f26ddf59d68`
- `package.json` → `85d69437b8d9a307f7d78a13bec6795a65de7ccb`

All bytes must be read from the frozen product revision or an independently verified exact-byte source root.

Current H19/tooling branch bytes are not product evidence.

## One retained execution

The execution slice must:

1. verify every pinned source blob before running;
2. execute exactly `tests/f11-group-notifications.test.mjs` with Node's test runner;
3. retain raw TAP output;
4. collect target-scoped V8 coverage for `worker/notifications.ts`;
5. retain runtime identity and exact source bindings;
6. make no provider/network call outside the suite's mocked fetch implementation;
7. execute once for retained empirical evidence.

Retries caused by infrastructure failure are not additional observations and must be recorded explicitly.

## Acceptance rule

The adjudication is **covered-by-existing-suite** only if all conditions hold:

- the existing suite exits successfully;
- its exact three nested controls complete and pass:
  - template 2 sends one RANGE line once with its bounded estimate;
  - template 2 retains the multi-line summary;
  - invalid or unbounded summaries never reach the provider;
- V8 shows `validGroupSummary` called at least once;
- V8 shows `renderTemplateV2` called at least once;
- no unbound source or evaluation input is loaded.

If any condition is missing, failed, skipped or inconsistent, the adjudication is `inconclusive`.

## Outcome semantics

If the acceptance rule passes:

- the existing M8 `m5-validation / confirmed` outcome may be bound to the frozen case, because the original S07 observation genuinely left the two named entries uncalled and the separate F11 execution demonstrates a path that calls them;
- a separate adjudication field records `crossSuiteCoverage = covered-by-existing-suite`;
- `newPermanentTestRecommendation = none`.

This does **not** mean the functions are globally correct, the product has no defect, or the existing F11 suite is a complete specification.

If acceptance does not pass, no M8 outcome is manufactured and no new test is automatically generated.

## Scientific boundary

The key distinction is:

```text
suite-scoped coverage gap
        !=
repository-wide missing test
```

H19 must not promote every local gap into a new permanent test when an existing independent suite already exercises the same named behavior.

## Non-goals

This slice does not:

- call Jev;
- create relation labels;
- modify product code/tests;
- execute evaluation anchors;
- claim line/branch coverage completeness;
- promote a test into the permanent suite;
- change dispatcher authority;
- activate M12.

## Promotion rule

Execution may begin only after this exact freeze is exact-head CI-green.
