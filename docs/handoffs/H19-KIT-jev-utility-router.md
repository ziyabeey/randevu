# H19 Kit Jev Utility Router implementation

Task: **H19-KIT-JEV-UTILITY-ROUTER**. Owner: Codex + coordinator. Date: 2026-09-26.

## Parent

Design gate: PR #632, branch `h19-kit-jev-utility-router-gate`.

This child implements only the pure deterministic planner described by
`tools/h19-kit/specs/JEV_UTILITY_ROUTER_GATE-v0.1.md`.

## Implemented route planner

`src/routing/jev-utility-router.mjs` validates one content-bound question candidate and emits one immutable route decision.

Route precedence:

1. `deterministic` when a deterministic resolution artifact already exists;
2. `cache` on an exact cache hit;
3. `abstain` on invalid cache, insufficient evidence, missing evaluation contract,
   disabled/zero live budget, zero token budget or missing monetary ceiling;
4. `single-live` for one bounded eligible semantic question;
5. `fanout-live` only when fan-out was requested and prospectively authorized.

A requested but ineligible fan-out degrades to one bounded live question.
A requested fan-out that exceeds the frozen live-question budget fails closed to abstain.

## Candidate bindings

The candidate binds:

- question id/version/class/input SHA-256;
- evidence completeness, unknown/conflict counts and lineage-overlap flag;
- deterministic resolution availability/digest;
- exact cache state/key/answer digest;
- live permission;
- max live questions;
- input/output token ceilings;
- timeout;
- monetary ceiling with currency and rate evidence;
- later evaluation method id;
- fan-out policy, calls, disagreement metric and stopping rule.

## Decision identity

Every route decision is content-addressed with the existing stable JSON/cache-key primitive.
Replay from the same candidate must reproduce the exact decision bytes.

The decision records `liveExecutionPerformed=false` and `authority=advisory`.
This module cannot call a provider.

## Smoke coverage

`test/jev-utility-router.mjs` covers:

- deterministic precedence, including over invalid cache;
- exact-cache precedence;
- invalid-cache fail-closed;
- insufficient evidence;
- missing evaluation contract;
- live disabled/zero token/missing monetary ceiling;
- bounded single-live;
- authorized fan-out;
- fan-out budget overflow;
- non-eligible/degenerate fan-out fallback;
- exact replay identity;
- tampered decision rejection;
- unsupported question-class rejection.

CI runs this smoke after the path-granular runtime blind-spot smoke.

## Boundaries and next slice

Provider calls: **0**.

This slice does not yet:
- execute Jev;
- read/write provider cache;
- aggregate fan-out answers;
- compute utility;
- alter blind-spot state;
- alter M8–M11 scientific artifacts;
- grant M12 authority.

Next: add a provider-neutral fake execution/utility ledger that consumes the route decision and records
tokens/cost/latency/answered-insufficient-error state without treating an answer as resolved uncertainty.
