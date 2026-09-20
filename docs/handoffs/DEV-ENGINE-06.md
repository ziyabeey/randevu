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
- Context continuity: prior project context checked; repo-native tooling used for CI/governance (no dedicated CI skill required).

## Delivery

Freshness is entirely deterministic; Gemini is removed from this control. No reviewer allowlist is provisioned implicitly. Missing trusted role configuration yields unknown/no action, never an invented R1/R2. Existing workflow-owned false advisories are withdrawn on the next PR/manual stale-review event.

Copilot, Codex and GHAS automatic app reviews cannot be path-gated by this workflow. The change excludes them from independent role evidence; provider settings remain a separate integration limit.

Next: run focused regressions and required CI, then independent CI/governance review before coordinator merge. Live head/run identities belong on the PR/check surface; this document is a bounded historical handoff.

## Context Refresh — coordinator conflict repair

Coordinator scope: [repair dispatch](https://github.com/ziyabeey1-ai/randevu/pull/202#issuecomment-5747357177).
Starting candidate: `900defb434858341e5b7bd56f28827b6479d59a6`.
Integrated main: `eef412b475a05f32857fd300702bc48a99b68f41` (PR #203).

Only TASKS conflicted. Preserve the updated DEV-ENGINE-04 owner date and open integration/CI/review obligations in its durable row. Preserve #203’s complete factual snapshot below, explicitly as historical provenance rather than a continuously synchronized task field. The DEV-ENGINE-06 record and existing audit/CI implementation remain intact. This repair changes only TASKS and this handoff; no workflow/product/DB/auth/policy expansion.

Next: fresh exact-head CI, then coordinator-dispatched R1 for CI/governance, role identity/freshness and audit gates. Keep #202 draft. R2 is not dispatched. #200 stays on coordinator hold until #202 merges.

## Preserved #203 evidence

Verbatim DEV-ENGINE-04 row from `main@eef412b475a05f32857fd300702bc48a99b68f41:TASKS.md`. “Current” below describes that historical snapshot, not a fresh assertion about the live PR. Its prior-head failed CI is superseded and cannot be assigned to the replacement candidate. Live identity must be re-read from PR/check evidence.

```text
| [DEV-ENGINE-04](https://github.com/ziyabeey1-ai/randevu/issues/196) | Dispatcher-required bağımsız R1/R2 incelemelerini ayrı Claude Routine API endpoint'lerine güvenli ve tekrar-harcamasız teslim etme | TEMEL | İncelemede | Koordinatör / 2026-09-20 | [PR #197](https://github.com/ziyabeey1-ai/randevu/pull/197) current head `ef153013` · head `01e766d1` main snapshot'ını merge etmiş; current main `f49986a5` entegrasyonu açık · prior head `407b0c8a` exact-head [CI #1630](https://github.com/ziyabeey1-ai/randevu/actions/runs/35457312709) **failure** (attempt 2; `Run all required code checks`) historical/superseded · current-head required CI gate kanıtı yok · 3 unresolved review thread (1 current, 2 outdated): CI run↔tested-checkout binding, job↔attempt binding, exact TASKS PR-link binding · repair replies prior head `407b0c8a` üzerinde; fresh exact-head CI/review closure yok · tooling dependency DEV-ENGINE-02 · GitHub `mergeable=false` (`dirty`) |
```
