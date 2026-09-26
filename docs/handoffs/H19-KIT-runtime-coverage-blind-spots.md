# H19 Kit path-granular runtime-coverage blind spots

Task: **H19-KIT-RUNTIME-COVERAGE-BLIND-SPOTS**. Owner: Codex + coordinator. Date: 2026-09-26.

## Why this slice exists

The successful frozen yzt-digital portability artifact exposed a diagnostic
granularity problem in the blind-spot ledger.

M4 reported eight distinct impacted paths with unknown runtime coverage, but the
ledger represented them as one scope-level `impact-unknown: runtime-coverage`
candidate. After one path is validated, the aggregate candidate remains present
and cannot express partial blind-spot reduction.

Observed yzt-digital baseline:
- 149/149 TypeScript semantic units mapped;
- zero symbol-mapping gaps;
- eight impacted paths with unknown runtime coverage;
- one targeted runtime hypothesis later confirmed;
- generated Playwright candidate passed.

## Change

When an M4 impact contains both:
- the explicit `runtime-coverage` unknown; and
- `symbolImpact.report.unknownCoveragePaths`;

H19 now emits one deterministic
`runtime-coverage-unknown-path` candidate per path.

Candidate subject:
- impact scope id;
- normalized path.

The coarse generic `impact-unknown` runtime-coverage record is suppressed only
when path-level evidence exists. Older/partial callers without
`unknownCoveragePaths` keep the aggregate fallback.

## Why it matters

A comparable before/after ledger can now measure:

`2 unknown paths → 1 unknown path → 0 unknown paths`

as:
- 50% blind-spot reduction;
- then 100% reduction.

This does not claim that passing a test automatically supplies coverage. The
caller still has to provide an M4 result whose `coverageByPath` was backed by
explicit runtime evidence.

## Validation

Dedicated smoke proves:
- two distinct path candidates are created;
- one resolved path yields one resolved + one persistent candidate;
- complete closure yields two resolved candidates;
- reduction rate is 0.5 then 1.0;
- legacy aggregate fallback remains available when path-level report evidence is
  absent.

The existing blind-spot production-chain smoke is updated to expect path-specific
runtime-coverage candidates.

No product code, provider call, generated test or M12 authority is introduced.
