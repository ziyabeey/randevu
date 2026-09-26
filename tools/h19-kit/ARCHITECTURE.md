# Architecture invariants

## A1. Evidence isolation

Evidence producers never silently inject facts into semantic-model prompts.

```text
static facts ─┐
test impact ──┼─> deterministic dispatcher
git history ──┘

diff ───────────> semantic probe
```

A semantic probe receives only the input declared by its versioned question contract.

## A2. Adapters are replaceable

Static analysis, test impact, history and reporters expose normalized contracts. A user may choose Semgrep,
another analyzer or no analyzer without changing the dispatcher contract.

## A3. Unknown is first-class

Adapters may return `unknown`. Unknown is never coerced to safe.

## A4. Expensive reasoning is downstream

System Two is an optional escalation target, not the source of truth for deterministic facts.

## A5. Research history is data

Experiment results and failed approaches belong in a machine-readable ledger. A future adapter must be able to
ask whether a proposed method has already failed prospectively before recommending it again.

## A6. Information acquisition is a control problem

H19 does not prefer a model call merely because uncertainty remains. After deterministic
derivation and exact replay are exhausted, the control plane must compare bounded ways to
obtain new evidence: read-only observation, prospective experiment/probe, Jev, explicit
higher-cost escalation, or abstention.

A route may be selected only when its input identity, cost/budget, authority, expected
discrimination and later evaluation method are declared. Unknown may remain unknown when
no justified acquisition route exists.

## A7. Jev is a measured semantic sensor

Jev is one acquisition route, never the authority for deterministic facts. Repeated calls to
the same model/question/input measure stability or disagreement; they are not independent
reference truth. Provider confidence is metadata, not calibrated reliability.

H19 optimizes reliable, decision-relevant uncertainty resolution per acquisition cost. It
retains raw cost, latency, disagreement, abstention and later-confirmed/rejected outcomes
instead of hiding them behind an unfrozen global utility score.
