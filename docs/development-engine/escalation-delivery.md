# Escalation delivery

This delivery layer sits after the pure Development Dispatcher. It does not turn
the reducer into a workflow-state authority and does not replace R0, R1, R2, CI,
TASKS or coordinator acceptance.

## Routing boundary

The deterministic result is classified into exactly one external disposition:

- `NO_ACTION`
- `DETERMINISTIC_ACTION`
- `HUMAN_REQUIRED`
- `REASONING_REQUIRED`

Unknown future dispatcher actions fail closed to `HUMAN_REQUIRED`. Only
`REASONING_REQUIRED` may launch the Haiku Evidence Context Compressor.

Haiku is not a reviewer and does not answer the escalated technical question. It
removes duplicate and historical noise while preserving candidate-bound facts,
contradictions, unknowns, obligations and source provenance. Haiku then initiates
the bounded Opus handoff exactly once.

## Trusted case binding

The GitHub router requests a short-lived GitHub Actions OIDC token with a custom
`aud` value binding:

- case fingerprint,
- source-envelope byte count,
- workflow SHA.

The token is signed by GitHub and also carries repository, repository ID, workflow
reference and runner claims. The Haiku session copies that attestation unchanged
into `/tmp/kepenk-opus-handoff.json` and runs the fixed command:

```text
node scripts/fire-opus-escalation.mjs --package /tmp/kepenk-opus-handoff.json
```

`fire-opus-escalation.mjs` verifies the GitHub signature and claims against the
public GitHub OIDC JWKS before it compares the package fingerprint and byte count.
The model cannot make an altered case pass by changing both a package value and a
command-line expectation. No payload-derived value is interpolated into shell
syntax.

The GitHub router receives only Haiku Routine credentials. Opus credentials remain
inside the Haiku Routine environment and are read only by the validated adapter.
If signature, provenance, transport or Routine validation fails, the handoff stops
with a non-secret `OPUS_HANDOFF_BLOCKED` reason.

## Provenance and compression receipt

The escalation envelope includes the normalized Dispatcher facts as well as
conditions, obligations and recommendation. This preserves exact CI run/job/
attempt identities, reviewed SHAs and proof source references for compression.
The case fingerprint hashes the same merged source-reference set emitted in the
envelope.

The successful Opus launch receipt reports:

- case fingerprint,
- source-envelope bytes,
- compressed-package bytes,
- compression ratio,
- attested GitHub run ID,
- Claude session ID and URL.

These fields measure compression behavior without treating Haiku prose as project
or acceptance authority. The fingerprint remains a dedupe key, not a status store.

## Triggering

`.github/workflows/development-escalation-router.yml` remains manual/reusable for
general escalation. The narrowly scoped
`.github/workflows/development-review-automation.yml` collector may call it for
independent review delivery after a successful PR CI run or a later submitted R0
receipt. The collector checks out canonical `main`, rebuilds the normalized
observation from live GitHub evidence and proceeds only when the pure Dispatcher
returns `request_required_reviews`. Model calls never move ahead of the
Dispatcher.

The resulting chain is:

```text
canonical observation -> Dispatcher -> disposition -> Haiku -> attested Opus handoff
```

`TASKS.md` remains the sole durable live task/status authority.

## Activation gates

The general escalation delivery layer entered main without an automatic event
collector. DEV-ENGINE-04 adds only the independent-review collector after its
event budget and duplicate-spend contract were separately defined. A candidate
must still have current exact-head CI, a current clean R0 receipt, current main
integration and an exact canonical TASKS-to-PR binding before R1/R2 credentials
can be reached.
