# Escalation delivery experiment

This follow-up is deliberately stacked on the Development Dispatcher v0 experiment.
It does not change the reducer's authority or turn the reducer into an agent runtime.

## Boundary

The delivery layer starts only after `deriveDispatcherResult()` has produced a
candidate-bound result. It classifies the advisory recommendation into one of four
external delivery dispositions:

- `NO_ACTION`
- `DETERMINISTIC_ACTION`
- `HUMAN_REQUIRED`
- `REASONING_REQUIRED`

Unknown future dispatcher actions fail closed to `HUMAN_REQUIRED`; they never
silently spend model credit.

Only `REASONING_REQUIRED` may create a Haiku compression request. Haiku is an
Evidence Context Compressor, not a reviewer or technical judge. Its job is to
preserve exact identities, contradictions, unknowns, obligations and provenance
while removing duplicated or irrelevant historical material before a higher-cost
reasoning tier is considered.

The reducer remains pure and restart-safe. The delivery layer owns no task state,
queue, scheduler, merge authority or acceptance authority. `TASKS.md` remains the
sole durable live task/status source.

## Case fingerprint

`development-escalation-envelope.mjs` creates a SHA-256 case fingerprint from the
material deterministic state: task/PR/head/main identity, dispatcher disposition,
recommendation, contradiction/unknown/obligation set and explicitly supplied
material evidence. Ordering noise is normalized before hashing.

The fingerprint is a dedupe key, not a new status database. A caller may use it to
avoid firing the same expensive reasoning case twice, but no committed registry is
introduced by this experiment.

## Routine adapter

`fire-claude-routine.mjs` is a generic thin HTTP adapter for a Claude Code Routine
`/fire` endpoint. It reads these runtime-only environment variables:

- `CLAUDE_ROUTINE_URL`
- `CLAUDE_ROUTINE_TOKEN`

The token must live in a secret store and must never be committed. The adapter does
not print the token. `--dry-run` validates the request body without network access.

For the Haiku compressor wiring, the intended repository names are:

- repository variable: `CLAUDE_HAIKU_ROUTINE_URL`
- repository secret: `CLAUDE_HAIKU_ROUTINE_TOKEN`

Opus credentials are intentionally not consumed by this first delivery adapter.
The `/fire` response is treated only as a launch receipt; this repository does not
assume an undocumented result-polling or callback contract. Chaining compressed
Haiku output into the Opus Escalation Governor remains a separate integration seam
until that result handoff is explicitly available and tested.

## Manual/reusable router

`.github/workflows/development-escalation-router.yml` is intentionally not bound to
high-volume GitHub events. It accepts a normalized dispatcher observation plus
optional material evidence, runs the deterministic Dispatcher first, creates the
case envelope, and fires the Haiku Routine only when the disposition is
`REASONING_REQUIRED`.

This preserves the cost boundary:

`canonical observation -> Dispatcher -> delivery disposition -> Haiku only if needed`

A later event collector may call the reusable workflow, but it must produce the
same normalized observation contract and must not move model calls ahead of the
Dispatcher.
