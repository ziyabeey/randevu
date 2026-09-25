# FANOUT-001 — M10 fan-out performance and equivalence characterization

**Status:** plan and harness committed before the first live request.
**Harness:** `perf/run-fanout-characterization.mjs`
**Parent:** M10 v0.2 fan-out (#594) on the `RELATIONAL_JUDGMENT_BATCH_GATE-v0.2` freeze (#595).
**Authority:** none. This is a measurement. It changes no gate, threshold, budget or routing rule.

## Questions

1. **Latency:** how does single-request latency grow with 1, 5, 10 and 20 fan-out questions?
2. **Size:** what are the request/response payload size and input-token cost per question?
3. **Equivalence:** is a case's answer inside a 20-question shared state the same as when the case is asked alone in the M8 single-case shape?
   - This decides whether per-case cache keys are sound across different fan-out windows.
4. **Cache:** does a warm cache replay a full batch with zero provider requests?
5. **Failure:** does a provider-level failure produce one bounded error per selected row and no cache writes?

## Arms

| Arm | Runs | Provider requests | Questions |
|---|---|---|---|
| A — size lane | sizes 1, 5, 10, 20 × 3 repeats, fresh cache each run | 12 | 108 |
| B — single-case shape | the 20 cases one by one in the M8 request shape × 2 repeats | 40 | 40 |
| C — cache lane | one 20-question warm-up, then a replay | 1 (+0) | 20 |
| D — failure lane | 5 questions with a 1 ms timeout | 1 | 5 |
| **Total** | | **54** | **173** |

**Case set:** 20 synthetic surviving-mutant hypotheses composed by M9. Each case pairs a mutation anchor with other-family facts in four patterns:
- reinforcing;
- contradicting;
- near-baseline;
- shared lineage plus an independent third family.

The set is fixed in the harness. Its batch digest is recorded in the report.

**Model:** `jev-1.13.0` through the M10 orchestrator, with no retry. Arm B uses the M8 single-case request body directly.

## Metrics

- **Arm A:** median request latency, latency per question, request and response bytes, input tokens and error codes.
- **Arm B vs A:** mean absolute probability difference over the four options (|Δp|) and argmax agreement, for three pairings:
  - single vs single, which is the noise floor;
  - 20-fan-out vs 20-fan-out, the noise floor within fan-out;
  - single vs 20-fan-out, the shape effect.
- **Arm C:** replay provider requests (expected 0), cached rows (expected 20) and replay wall time.
- **Arm D:** provider requests (expected 1), error codes and cache writes (expected 0).

## Interpretation rules, fixed before data

- The **shape effect is material** if the single-vs-fan-out |Δp| is clearly above both noise floors, or if single-vs-fan-out argmax agreement is below both.
  - A material shape effect means fan-out answers are not interchangeable with single-case answers.
  - In that case the cache key must also bind the execution shape before cached answers are mixed across windows. That would be a follow-up gate change, not something this measurement decides.
- **Latency is measured from this environment through its egress proxy.** It is an environment-specific figure, not a provider SLA.
- **Dollar cost is not computed.** Input tokens are reported as the cost proxy because no frozen TypeSafe price table exists.
- **Case set scope:** synthetic cases characterize transport and shape behaviour. They are not evidence about answer quality on real relational evidence.
