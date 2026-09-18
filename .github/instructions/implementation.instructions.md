---
applyTo: "**"
excludeAgent: "code-review"
---

# Scoped implementation

Use the current canonical task/Context Pack and the
[kepenk-implementer Skill](../skills/kepenk-implementer/SKILL.md).
Task Manifests are only projections: reconcile their source references before use.

Write only allowed files, preserve accepted invariants, and prefer the smallest
repair. Reproduce an acceptance defect with the narrowest meaningful failing test
before changing behavior. Do not implement future dependencies as if accepted.
Stop after 2–3 failures of the same hypothesis and return exact evidence.

Do not edit another writer's migrations, CI plan or task rows. Preserve all
required checks. Freeze the review candidate only after fresh exact-head CI;
pending CI may freeze further writes but does not open review/readiness.
Any later semantic repair resets affected acceptance; report head changes.

Keep handoff facts in the PR and the task's own TASKS row, not only chat.
No self-ready, self-merge, fabricated test success or self-issued R1/R2 verdict.
