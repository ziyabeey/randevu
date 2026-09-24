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
