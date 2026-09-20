# DEV-ENGINE-06 — audit provenance and metadata event repair

## Context Pack

- Owner: Codex; user explicitly requested repair of the audited leaks.
- Size: L, split into audit provenance, CI baseline reuse and durable tracking slices. Validation: FOCUSED (CI/governance authority).
- Base main: `f49986a5f40cfb7512706f04733afd869b2cd151`.
- Branch: `fix/dev-engine-audit-provenance`.
- Sources: TASKS tooling track; `docs/plan/agent-workflow.md` review lineage kernel; `docs/runbooks/ci.md`.
- Writable: development audit workflow/helpers/tests, CI scope/workflow/tests, TASKS durable metadata policy, AGENTS and directly related runbook/automation docs.
- Separate existing PR #200: observer authority repair on its existing branch; no parallel replacement PR.
- Out of scope: product code, DB, migrations, F12-05/#187, review delivery/#197, dependency/acceptance closure and app-managed review settings.
- Invariants: CI failure does not imply candidate causality; no model-derived reviewer identity; no stale publication; no self-approval/merge; unknown evidence stays unknown.
- Acceptance: spoofed roles and head/base races rejected; metadata invokes zero stale-review models; initial docs-only PR can reuse exact green main baseline; mixed/code/base-drift falls back to full checks; TASKS does not chase volatile provenance.
- Skills: personal-context checked for continuity; repo-native tooling used for CI/governance (no dedicated CI skill required).

## Delivery

Freshness is entirely deterministic; Gemini is removed from this control. No reviewer allowlist is provisioned implicitly. Missing trusted role configuration yields unknown/no action, never an invented R1/R2. Existing workflow-owned false advisories are withdrawn on the next PR/manual stale-review event.

Copilot, Codex and GHAS automatic app reviews cannot be path-gated by this workflow. The change excludes them from independent role evidence; provider settings remain a separate integration limit.

Next: run focused regressions and required CI, then independent CI/governance review before coordinator merge. Live head/run identities belong on the PR/check surface; this document is a bounded historical handoff.
