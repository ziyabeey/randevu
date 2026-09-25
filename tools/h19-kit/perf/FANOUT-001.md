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

---

## Results (`jev-1.13.0`, cloud container behind an egress proxy, 2026-09-25)

Two complete runs of the plan: `baselines/FANOUT-001.ccr-cloud.run1.json` and `…run2.json`.
- Run 1's report omitted the per-case single-shape probabilities. The harness was fixed to write them before run 2 (commit message records this); arms and rules did not change.
- All 108 runs × 2 were valid: no provider errors outside the failure lane.

### Arm A — size lane (median of 3; run 2, run 1 in brackets)

| Questions | Request latency | Per question | Request bytes | Input tokens |
|---|---|---|---|---|
| 1 | 241 ms (229) | 241 ms | 3,188 | 1,710 |
| 5 | 233 ms (266) | 47 ms | 18,262 | 8,928 |
| 10 | 293 ms (300) | 29 ms | 34,830 | 16,629 |
| 20 | 400 ms (432) | 20 ms | 69,662 | 32,927 |

- Input tokens grow linearly with the number of cases: the shared state is billed once and contains every case.
- A 20-question fan-out costs about the same tokens as 20 single-case requests. The gain is request count and latency.

### Arms C and D

- **Cache replay:** 0 provider requests, 20/20 cached, 66–78 ms wall.
- **1 ms timeout:** 1 request, 5 `timeout` errors, 0 cache writes.

### Equivalence — material shape effect (both runs)

| Pairing | Mean \|Δp\| | Argmax agreement |
|---|---|---|
| single vs single (noise floor) | 0.030–0.035 | 85–95% |
| 20-fan-out vs 20-fan-out (noise floor) | 0.019–0.024 | 90–100% |
| **single vs 20-fan-out** | **0.124–0.134** | **40–50%** |

By the rule fixed before data, the shape effect is material. Fan-out answers are **not** interchangeable with single-case answers.

## Exploratory follow-ups (not pre-registered)

### Post-hoc analysis of run 2

- Only 1–2 of 20 fan-out answers were closest to their own case's single-shape answer.
- On average, fan-out answers were closer to the batch-mean single answer (|Δp| 0.114) than to their own case (0.124).
- The loss grows with size:

  | Questions | Argmax agreement with single | Mean \|Δp\| |
  |---|---|---|
  | 1 | 1/1 | 0.055 |
  | 5 | 2/5 | 0.129 |
  | 10 | 3/10 | 0.156 |

### FANOUT-002 — case or position?

Same 20 cases, batch order ×2 and reversed order ×2 (4 requests; `baselines/FANOUT-002.ccr-cloud.json`).

| Pairing | Mean \|Δp\| | Argmax agreement |
|---|---|---|
| same order repeated (noise) | 0.020–0.028 | 90–95% |
| **same position, different case** | 0.069 | **70%** |
| **same case, different position** | 0.112 | **35%** |

In a 20-case shared state, answers follow the question's position far more than the case the question names.

### FANOUT-003 — concurrent single-case requests

Each case in its own M8-shaped request, 1/5/10/20 in parallel × 2 (72 requests; `baselines/FANOUT-003.ccr-cloud.json`).

- **20 in parallel:** 669–709 ms wall, all valid, 36,040 input tokens (+9% vs fan-out).
- **Repeat agreement:** |Δp| 0.023, argmax 90%.
- **Against sequential single-shape answers:** |Δp| 0.020, argmax 17/20. Answers stay bound to their case.

## Reading

- On this synthetic set, a multi-case shared state does not give case-bound answers with `jev-1.13.0`. The explicit `cases[i].state` path in each question does not stop the model mixing cases; answers track position.
- Fan-out saves requests and about 40% of wall time against 20 parallel requests, and about 9% of tokens. But each answer is not a judgment about its named case.
- Per-case requests run concurrently keep case-bound answers at about 0.7 s for 20 cases.
- TypeSafe's parallel-question model fits many questions about **one** state, as H19's six-axis V question does. It does not fit many cases packed into one state.

## Consequence (for the gate owner; not decided here)

- The v0.2 execution shape (§7 shared multi-case state) should not be used to produce per-case judgments or canonical cache entries until a gate change addresses this.
- A candidate v0.3 keeps every v0.2 property except the shared state:
  - probability-complete cache;
  - `cache-upgrade-required` / `invalid_cache`;
  - `maxLiveQuestions`;
  - atomic validation per request;
  - no retry;
  - one per-case request per selected row, issued concurrently.
- Synthetic cases are structurally similar to each other. Real relational cases may bind better or worse; this has not been measured.
