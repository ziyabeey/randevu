# Jev R0 second signal

**Registered scheduled workflow, advisory only.** Trigger: daily schedule and
manual `workflow_dispatch` ([workflow](../../../.github/workflows/development-jev-r0-shadow.yml)).
Control `DE-JEV-R0`, maturity `SHADOW`; overlaps `DE-R0` receipt parsing in
`scripts/prepare-development-review-observation.mjs` and never replaces it.

## What it does

`scripts/jev-r0-shadow.mjs` reads PR reviews and comments from the lookback
window (default 7 days), selects R0 receipt candidates with the same rule as the
review observation, and applies the production "clean" rule, copied verbatim and
pinned by `tests/jev-r0-shadow.test.mjs`. It then asks TypeSafe Jev
(`jev-1.13.0`, pinned) for the reviewer's own verdict: `clean`, `changes_needed`
or `needs_human`. A disagreement with Jev confidence ≥ 0.9 is reported as a flag
in the job summary and the `jev-r0-shadow` artifact.

## Boundaries

- No GitHub writes: the token is read-only and the script only sends `GET`.
- Not a PR check, dispatcher input, R0 blocker, R1/R2 receipt or merge signal.
- No `TYPESAFE_API_KEY` secret: the job skips and exits 0.
- Jev errors are recorded per receipt; they never fail the job.
- Data sent to TypeSafe: review/comment text of this repository only. No
  customer or production data.

## Measurement and promotion

Evidence behind the control (`experiments/jev-tr-eval/r0` on branch
`claude/upbeat-maxwell-kiof98`): over 230 historical R0 candidates the production
rule matched the reviewer's own verdict in 77.8%; a Jev flag at ≥ 0.9 caught 27 of
51 rule errors with 0 false alarms. On team-authored receipts Jev alone was
weaker than the rule (80.0% vs 87.3%), which is why it is only a second signal.

Record per run: candidates, flags, confirmed rule errors, false alarms, Jev
errors and token cost. Unknown is not zero. Promotion beyond `SHADOW` needs a
measured coordinator decision; the proposed bar is zero false alarms over four
weeks of flags. A separate, AI-free fix of the rule's formatting blind spots
(`VERDICT: **ACCEPTABLE**`, `PASS / ACCEPTABLE`, Copilot `🟢 Approval recommended`)
belongs to the owner of the review observation, after DEV-ENGINE-09 acceptance.
