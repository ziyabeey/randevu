# Development Engine v1

Repo-native guidance for `task/contract -> implementer -> exact-head CI ->
independent R1/R2 -> coordinator merge -> post-main CI`. This is tooling, not a
product feature, authority database, automatic merge system or new required gate.

Historical implementation task **DEV-ENGINE-01 / [#119](https://github.com/ziyabeey1-ai/randevu/issues/119)** is **accepted and closed**.
PR #120 merged at main `02d0a2a6605e9ade1c526cf5f1542ceefa523936`;
post-main CI #1220 / `35312768868` succeeded. Its original 21-path scope and
starting SHA are provenance only, not current execution state. Current durable task
state comes only from TASKS. Open PRs and Issue #65 may carry newer candidate or
coordination evidence, but they do not override TASKS.

## Authority and entry points

| Question | Canonical source |
| --- | --- |
| Permanent rules / handoff | [AGENTS](../../AGENTS.md), [CONTRIBUTING](../../CONTRIBUTING.md), [workflow](../plan/agent-workflow.md) |
| Live task / accepted-main status | [TASKS](../../TASKS.md) only |
| Product boundary / planned sequence | [PRODUCT_SPEC](../../PRODUCT_SPEC.md), [ROADMAP](../../ROADMAP.md) and actual main ref |
| Temporary writer claim / conflict / dispatch | open PRs and [Issue #65](https://github.com/ziyabeey1-ai/randevu/issues/65); never a second durable status source |
| Task scope / refresh | [Context Pack protocol](../plan/context-packs.md) and the assigned contract |
| Review mode / lineage / blocker identity / freshness | [Review lineage contract](../plan/agent-workflow.md#review-lineage); Skills add role-specific evidence only |
| Executor wait-mode | [Shadow Validation Mode](../plan/shadow-validation-mode.md) |
| AI/provider routing | [AI model routing](ai-model-routing.md); coordinator selects roles/routes, models remain replaceable |
| Copilot bootstrap | [Global instructions](../../.github/copilot-instructions.md) and [path instructions](../../.github/instructions) |

An active PR may contain a newer candidate than TASKS; that is candidate evidence,
not accepted project state. Durable status changes only when TASKS is updated through
the normal coordinator/merge flow. Verified-main drift is reported with source
references, not silently repaired by an audit. Projections cannot grant writer tokens or weaken acceptance. Stronger
Context Pack obligations must be satisfied or explicitly `narrows`/`supersedes`
with coordinator rationale and preserved invariants.

For an assigned issue/PR, provide task ID, canonical Context Pack/receipt,
base/head and allowed paths, then follow [AI model routing](ai-model-routing.md)
and invoke only the relevant Skill/route. Roles stay stable; model/engine choices
are replaceable. Never paste all history as a substitute
for a current Context Refresh.

| Skill | Use |
| --- | --- |
| [kepenk-implementer](../../.github/skills/kepenk-implementer/SKILL.md) | Scoped implementation, validation and handoff |
| [r1-db-security-review](../../.github/skills/r1-db-security-review/SKILL.md) | Fresh independent DB/access/security/concurrency context |
| [r2-browser-integration-review](../../.github/skills/r2-browser-integration-review/SKILL.md) | Fresh independent browser/integration/regression context |
| [effective-state-audit](../../.github/skills/effective-state-audit/SKILL.md) | Disposable main + PR + CI + receipt synthesis |
| [development-telemetry-review](../../.github/skills/development-telemetry-review/SKILL.md) | Measurable bounded control/cycle/evidence observations |

Reading a Skill is not automatic execution or tool permission. Record the stable
Skill name actually read; if unavailable, disclose it and use a coordinator-approved
safe equivalent. R0 or implementer self-review never satisfies independent R1/R2.
Risk-based reviewer selection for current tasks remains unchanged. Historical #119
required fresh R1/R2 and completed those reviews before its accepted merge; it is
not an open review gate.

## Capability receipt — 2026-09-18

This is a dated inventory, not a continuously accurate settings claim.

| Capability | Observed/documented status |
| --- | --- |
| Repository | Native API: public, admin/write access, Actions enabled, auto-merge disabled; none establishes Copilot entitlement |
| Main protection | Ruleset 23159972 active: strict `CI gate`, stale-approval dismissal, resolved threads, deletion/non-fast-forward protection; approving-review count 0 |
| Native automatic R0 rule | **Observed active** on PR #136, including review after head updates. Exact account/ruleset toggle state was not independently reread in this repo pass. |
| Project app automations | Activation Issue #121 remains open with no completion receipt; Effective State / Stale Review / Telemetry cards are not claimed active. |
| Instruction/Skill sources | Supplied by this change; discovery in a future/refreshed executor session must be verified, not assumed |
| Cloud automations | **Unavailable for public repositories** under current official docs; private/internal only |
| Local app automation | Documented manual/schedule support; local public-repo event-trigger eligibility not verified |
| Copilot plan, credit balance, UI rollout, Skill enablement | Unknown |
| Review instruction toggle and both auto-approval toggles | Unknown; required intended settings below are not observed facts |
| Active implementation/setup | Native R0 behavior is observed; durable bounded-R0 contract is being updated in PR #136. Other activation/setup remains governed by Issue #121. |

Historical evidence: the initial main CI
[35264446487](https://github.com/ziyabeey1-ai/randevu/actions/runs/35264446487)
succeeded at the original starting SHA. Separately, F11-04 #117
[job/check 105480417908](https://github.com/ziyabeey1-ai/randevu/actions/runs/35306324484/job/105480417908)
at `227b7698a70821a02bb8dfd45b9180194d4e301a` had `runner_id=0`, `steps=[]`
and a runner/account billing annotation before checkout. That receipt is fenced to
that historical run. DEV-ENGINE-01/#119 later completed successfully and is closed;
do not use this paragraph to infer a current account block or an open #119 action.

### Supported formats and product surfaces

- `.github/copilot-instructions.md`: ordinary Markdown global guidance.
- `.github/instructions/**/*.instructions.md`: YAML `applyTo` string, comma-separated
  file globs; optional scalar `excludeAgent: "code-review"` or `"cloud-agent"`.
  This scopes files, not roles or tool permissions.
- `.github/skills/<lowercase-hyphen-name>/SKILL.md`: required YAML `name` and
  `description`; only those fields are used here. No invented `environments`,
  tool preapproval, model lock-in or duplicate Skill copies in docs.
- Current official support includes cloud agent, code review and CLI instructions/
  Skills; the app makes repository/CLI Skills available. GitHub Chat and IDE
  review have their own support matrix, not universal parity.
- CLI combines applicable instruction files without guaranteed overall precedence.
  Avoid conflicts; after changes start/resume a session and inspect `/instructions`.
  Code review can consume root AGENTS/Skills; this does not grant R1/R2 independence.
- App project/global Instructions UI is distinct from committed files. Repo Skills
  are inspectable at **Customize > Skills**; no manual copying should be necessary.
- `.github/github-app.yml` is not a PR automation registry. Its documented
  `automation.auto_issue_session` / `automation.remote_control` and session script
  hooks do not declare these custom event workflows. No app config is added.

Official sources:
[instruction format](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions),
[support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support),
[CLI loading](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions),
[Skills overview](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills),
[Skill format](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills),
[app customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app),
[app repository configuration](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/repository-configuration).

## Setup

**Repository sources alone do not activate account settings.** The prompt files
below remain canonical source text. Native R0 behavior is now observed separately
in the capability receipt above; the other app automation cards remain unclaimed
until Issue #121 has a completion receipt.

| Source | Intended trigger | Truthful initial fallback |
| --- | --- | --- |
| [R0](automations/r0-review.md) | PR opened; repair push = verification only | Manual review; native auto-review UI only if eligible |
| [Effective state](automations/effective-state-audit.md) | PR changes / manual | Manual prompt/Skill after a head change |
| [Stale reviews](automations/stale-review-detector.md) | Head changes after receipt | Manual prompt; advisory comment draft |
| [Telemetry](automations/development-telemetry-review.md) | Manual / scheduled | Manual first, optional approved local schedule |

### Native automatic R0 review — optional operator setup

1. Verify account entitlement and actual UI availability. GitHub repository
   **Settings > Copilot > Code review > Auto-approval**: keep both **Allow Copilot
   to approve pull requests** and **Allow Copilot approvals to count toward merge
   requirements** **OFF**. Do not infer their state from main's review count.
2. Ensure **Use custom instructions when reviewing pull requests** is enabled.
   Review effort may be Lite for cheap R0; this does not change required CI/R1/R2.
3. **Settings > Rulesets > Rulesets > New ruleset > New branch ruleset**.
   Name it, choose Active and target the default branch. Add **Automatically
   request Copilot code review**. Enable **Review new pushes** only when repository
   instructions are being applied and the reviewer can observe the prior frozen
   blocker receipt; new-push reviews must run in VERIFICATION mode, not restart
   discovery. If that state cannot be observed reliably, leave **Review new
   pushes** off and request one targeted verification after the repair candidate.
   Draft review is a separate explicit choice. Preserve existing ruleset 23159972;
   do not replace/relax its checks.
4. Save only after operator authorization, then verify on an actual PR/head and
   record the setup receipt. Native review reads supported instructions/Skills;
   there is no assumed arbitrary saved-prompt field for our R0 Markdown.

[Official native review setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review).
Personal automatic review follows profile > Copilot settings > Automatic Copilot
code review and is documented for Pro/Pro+/Max; eligibility here is unknown.
Do not enable that additionally and accidentally duplicate configured reviews.

### Local/manual app setup — optional operator setup

1. In **Automations > New automation**, enter a name and choose **Manual** first.
   A later telemetry schedule must have an explicit cohort/window and owner.
2. Keep **Run in the cloud** disabled for this public repository. Paste the
   canonical prompt or invoke its available Skill, choose model/agent, then
   **Select project** and select randevu.
3. Keep output read-only/report-only unless the operator explicitly authorizes
   a PR comment. Where tool restrictions are available, do not allow code push,
   approvals, merge, assignment, settings or workflow dispatch. Prompts themselves
   are not a permission sandbox; if enforcement is unclear, keep manual drafts.
4. After authorization click **Create**; run manually with the card's play button.
   Record actual environment/trigger/tools and observed result, not just source existence.

The app docs also describe issue/PR triggers, but this inventory does not verify
local event availability for this account/public repo. Do not advertise working
event automation until a real UI/setup receipt confirms it.
[App setup](https://docs.github.com/en/copilot/how-tos/github-copilot-app/using-automations);
[cloud availability/storage](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations).
Cloud automation records are outside Git and private to their creator. Porting
these sources to a private Kepenk repository requires its own eligibility and
authority check, not changes to this public repo's visibility.

## Projections

[Task schema](schemas/task-manifest.v0.1.schema.json) /
[example](examples/task-manifest.v0.1.json) and
[Evidence schema](schemas/evidence-manifest.v0.1.schema.json) /
[example](examples/evidence-manifest.v0.1.json) implement #119's v0.1 shapes in JSON.
They are disposable observation-only projections, not product/domain or task
authority. Context Pack remains the human-readable projection during this PoC.

The examples are explicitly illustrative (`example: true`), carry no fabricated
live SHA or passing proof, and grant no writable scope. Regenerate real observations
from canonical sources; do not update committed examples on every head change.
`source_refs` links origin evidence, not copied logs. Unknown values use null only
in explicitly nullable schema fields, or a supported pending/unknown status.
Risk flags require assessed booleans: true or false needs source evidence.
The schema cannot represent unassessed risk; stop and return that gap to the
coordinator rather than defaulting it to false. Example risk values are illustrative,
not defaults for real tasks.

`candidate.exact_head_sha` and `ci.exact_sha` refer to the source PR head associated
with the run. `ci.tested_checkout_sha` records the actual tested tree (often the
synthetic PR merge commit); never substitute it for the raw head. `semantic_sha`
identifies the semantic candidate, not an automatic equivalence assertion.
`supersedes` preserves prior artifact/receipt references. Compare external live
head/base again before using any snapshot.

The optional v0.1 provenance fields close two otherwise unrepresentable distinctions:
`candidate.base_main_sha` is the **observed current base**, whereas
`task.identity.base_main_sha` is the task's **starting main**.
`ci.base_main_sha` is the base actually used by that run. A same-head run on an
older base is not current integration proof. Each proof's `exact_sha` and
`tested_checkout_sha` bind its source candidate and actual checkout independently;
the enclosing manifest must not lend its identity to historical proof.
Omitted fields in older projections mean unknown, never implicit equality.
No producer must migrate historical receipts or start maintaining a live manifest.
Served-build and migration-chain identity remain in role-specific linked artifacts.

Stale/unsupported claims remain representable; diagnostics do not rewrite them.
The checker flags missing current passing proof references for the task's named
obligations, non-success CI, missing required review verdicts, unknown identities
and head/base mismatches. A matching label/SHA is only structural consistency:
it does not prove the artifact is authentic, covers every scenario or ran the
claimed tree. Use the canonical [routing table](../plan/agent-workflow.md#review-lineage)
to decide whether evidence refresh, delta confirmation or affected independent
review is needed. The checker deliberately does not guess semantic equivalence,
ancestry, blocker closure, shared-writer ownership or readiness.

`merge.ready` is only a recorded coordinator claim with a receipt, never a
computed authorization. `post_main` records separate merge-SHA/CI evidence;
green PR CI cannot fill it. Shape validation does not authenticate sources or
establish browser/DB proof, reviewer independence or readiness.

## Maturity and bounded executor mode

**`control_maturity`:** `PROPOSED -> SHADOW -> WARN -> BLOCK`; downshift/retirement
`BLOCK -> WARN -> SHADOW -> RETIRED`. New controls here remain SHADOW/advisory.
Promotion/retirement requires measured coordinator review, not a prompt/test toggle.

**`executor_mode`:** existing `ACTIVE / VALIDATING / SHADOW / REPAIR / REVIEW`.
Executor SHADOW is the same implementer/task waiting for validation, fenced by
`shadow_base_sha`: no branch/semantic/ownership/ready/merge writes; at most 3
microtasks, 1 dependency hop, approximately 10% context growth and <=1500-token
receipt. On head change discard head-specific scratch. No independent review
is satisfied by this work.

| Control | Maturity | Relation to existing controls |
| --- | --- | --- |
| DE-R0 | SHADOW | bounded DISCOVERY → frozen blockers → VERIFICATION; reinforces scoped implementation and overlaps R1/R2, never replaces them |
| DE-STATE | SHADOW | depends_on main/PR/#65 provenance; reinforces Context Refresh |
| DE-STALE | SHADOW | reinforces SHA fencing; overlaps stale approval dismissal |
| DE-TELEMETRY | SHADOW | depends_on exact receipts; overlaps CI/review measurements |
| Static artifact checks | Ordinary code correctness | Tests authored syntax/shape, not live governance or new merge authority |

Use `reinforces / depends_on / overlaps / narrows / supersedes / conflicts_with`
when relating any later control. `narrows`/`supersedes` must name rationale and
preserved invariants; no silent weakening. Measure trigger count, material/false
findings, unique/duplicate value, added wall time, context cost and observable
prevented escaped-defect evidence before recommending change. Unknown is not zero;
small samples do not justify broad percentages. No control registry database,
optional triage, optimizer or policy engine is introduced.

## Validation

```bash
node --check scripts/validate-development-engine.mjs
node scripts/validate-development-engine.mjs
node --test tests/development-engine.test.mjs
npm run test:ci-coverage
npm run test:docs
npm run typecheck
npm run build
git diff --check
```

The dependency-free checker accepts only the authored subset: JSON Schema
`$schema`, `title`, `description`, `type`, primitive `const`/`enum`, `properties`,
`required`, `additionalProperties:false`, `items`, `minItems`, `minLength`,
`minimum`, `pattern`. Unsupported keywords fail explicitly; this is **not a
general JSON Schema engine**. Native frontmatter is valid YAML written as one
JSON-quoted string scalar per line, with no unneeded fields. Unsupported
frontmatter syntax/keys are rejected rather than guessed.

Malformed shipped artifacts/missing required sections or invalid example shapes
are static test errors. Selected governance wording drift and projection
freshness/provenance issues produce **ADVISORY** diagnostics, not a live BLOCK
gate; warnings alone exit zero. This is not a semantic prose verifier.
Existing `test:docs` checks tracked Markdown links and task dependencies, so add
new files to Git before relying on it. Positive/negative tests cover syntax,
unknown keywords, stale evidence, provenance, advisory separation and safe discovery.

Existing recursive `tests/**/*.test.mjs` discovery includes the new test without
runner/workflow changes. These `.github`/JSON/script changes select the existing
full code CI: dependency install, audit, typecheck, builds, browser/HTTP, Worker,
PostgreSQL clean/upgrade/regression and connection checks all remain required.
Restore local dependencies only after a missing-dependency failure; CI's existing
`npm ci` is unchanged. No hosted staging dispatch is required by this tooling task.

## Delivery record

PR body plus this task's own TASKS row are the persistent delivery record; if a PR
is unavailable, use a durable #119 handoff linked from that row. Record exact
base/head/branch, changed files, contracts, Skills actually read/unavailable,
local commands/results, failed or skipped checks, CI run/job/attempt/checkout,
blocker and next executable step. This document is setup guidance, not a claim
of acceptance or a constantly regenerated state board.

After fresh exact-head CI, coordinator arranges only the risk-required independent R1/R2 contexts and
owns ready/merge plus post-main CI. If CI cannot execute, keep the task blocked:
no formal review opening, readiness or fabricated green evidence.
