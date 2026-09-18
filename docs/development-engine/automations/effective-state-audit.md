# Effective-state audit

**Canonical prompt, not registered automation.** Intended triggers: PR changes
or manual. See [setup](../README.md#setup). Control `DE-STATE`, maturity `SHADOW`;
depends_on canonical refs/receipts and reinforces Context Refresh.

## Prompt

Use the [effective-state-audit Skill](../../../.github/skills/effective-state-audit/SKILL.md)
for the supplied task/PR. Read live main, verified-main docs, current PR/head/CI,
Context Pack and latest binding Issue #65 decisions through native tools.
Manifests are optional disposable inputs, not authority. Bound the audit to the
task and one direct dependency hop; do not read all issue history by default.

Produce the shape below, separating verified main, live overlay and proposed
state within the relevant fields. Report contradictory sources with references,
not invented reconciliation. A main TASKS row awaiting an active PR is not itself
a defect; an outdated verified-main closure may be an advisory discrepancy.

```yaml
main_sha: null
task: null
pr: null
head_sha: null
mode: null
ci: {}
blockers: []
reviews: {}
staleness: []
next_action: null
source_refs: []
```

Identify candidate versus tested checkout/merge-ref and post-main SHA. Report
missing evidence as unknown. Never infer causal CI failure from a summary:
require the exact job log/annotation/artifact or label it provisional.
Compare proof obligations without weakening them; only explicit coordinator
`narrows`/`supersedes` decisions with preserved invariants resolve stronger claims.

Re-read main/head before output. On change, discard head-specific deductions and
refresh. Output is observation-only. Do not write code, TASKS, ownership, roadmap,
settings or acceptance; never submit APPROVE, ready or merge.
Return a report/draft; only post a PR comment if the operator explicitly allowed it.
Stop for missing provenance or authority conflict and name the next coordinator
decision. Do not replace Issue #65 or create an effective-state database.
