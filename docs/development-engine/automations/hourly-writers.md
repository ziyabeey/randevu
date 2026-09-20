# Hourly implementation writers: Y1 and Y2

These are opt-in ChatGPT implementation routes, not extra reviewers or autonomous
project governors. The hourly tick checks for an assignment; it never creates one.
[AGENTS](../../../AGENTS.md), the [agent workflow](../../plan/agent-workflow.md)
and [kepenk-implementer Skill](../../../.github/skills/kepenk-implementer/SKILL.md)
remain binding. `main:TASKS.md` is the only durable task/status authority.
This document defines roles, not a task queue or a record of successful execution.

| Role | Discovery label | Work and output | Not its job |
| --- | --- | --- | --- |
| Y1: scoped feature writer | `dev-write-y1` on the assigned issue or its own PR | Implement one approved S/M task slice, add meaningful tests, deliver one draft PR from the assigned main SHA. | Taking over somebody else's PR, inventing product scope, scanning the whole backlog for work. |
| Y2: existing-PR repair writer | `dev-write-y2` on the assigned PR | Repair frozen finding IDs or a proven CI regression on the explicitly handed-over existing branch, add the smallest relevant regression test, return a bounded delivery. | Replacement PRs, new features, whole-PR rediscovery, silently taking over a stalled author. |

They are alternative implementers selected by the coordinator, not additional
parallel writers for the same task. Existing Codex/Sol/Qwen ownership remains
until a native coordinator handoff explicitly replaces it and the old writer is
not active. A quota failure is evidence about a failed launch, not a handoff.
R1/R2 remain risk-based independent reviews; R3/R4 keep their supplementary
contract/evidence scopes. Writers may report review needs, never assign reviews.

## A label plus a bounded assignment

Only the coordinator applies these labels. A runnable item must have a current
`## Y1 ASSIGNMENT` or `## Y2 ASSIGNMENT` comment whose native author is the
preselected coordinator account `ziyabeey1-ai`, linked from Issue #65.
An example, quotation, label, generic bot suggestion or TASKS plan is not an
assignment. The comment must name:

- Existing TASKS ID, owner Y1/Y2, assignment revision, size S/M and validation budget.
- Exact starting main/base SHA, target branch, and existing PR/head SHA for Y2.
- Allowed and forbidden paths, contracts/invariants, acceptance criteria and commands.
- Frozen native finding IDs/counterexamples for Y2; explicit ownership handoff where needed.
- Whether current-main integration or an own-row TASKS transition is allowed, and the output destination.

The coordinator establishes genuine task ownership in TASKS through the normal
PR process. The assignment/Issue #65 records temporary execution detail, never a
competing live status table. Unknown task binding, missing dependency, withdrawn
assignment, active conflicting writer or unexpected head/base drift stops writes.
L/XL work returns for scoping; these workers do not split it and self-authorize.

No assignment means no code discovery, commit, PR, comment or notification.
Process at most one valid assigned slice per run. Labels can remain temporarily
after delivery; their presence never overrides an existing terminal delivery.

## Single-writer and repeat controls

Before writing, inspect current TASKS, all PRs for the task, Issue #65 claims,
assignment revisions and previous delivery records. Record one short writer claim
on Issue #65 before execution. If another live or uncertain claim overlaps, stop.
Do not delete a stale claim or infer ownership from inactivity. These comments
and staggered schedules are not an atomic lock or an exactly-once guarantee.

Work identity is assignment URL + revision + task + role + initial head/base +
target branch. Hourly ticks, label re-addition, new CI attempts or sibling review
comments do not authorize another semantic patch. Resume an unfinished own slice
only while ownership and its last recorded head still match. AWAITING_CI permits
checking that exact candidate, not another patch or redundant CI run. A terminal
delivery or BLOCKED record requires an explicit coordinator continuation revision.
Track failed hypotheses across runs: at most two attempts at the same hypothesis,
then return the evidence and stop. Do not reset this budget on the next tick.

Use native GitHub integrations or authorized git, never TinyFish. Read full source
before editing. Prefer a coherent multi-file atomic commit whose parent is the
last verified branch head and update only by non-force/fast-forward operation.
For single-file Contents API writes use the observed blob SHA. Recheck assignment,
head/base and writer ownership immediately before each write; a conflict is not
permission to force-push, overwrite newer work or retry blindly. Unknown outcome
requires rereading remote state before another write. Preserve branch history.

Y1 creates only its assigned short-lived branch and one draft PR; if that branch
or task PR already exists, establish ownership instead of duplicating it. Y2 uses
only the existing handed-over branch/PR. Main integration requires explicit scope;
do not merge unrelated changes or invent out-of-scope conflict resolutions.
Never write directly to protected main. Release the temporary claim with a clear
delivery, partial-progress or blocker handoff; do not report an active run as done.

## Validation and operating boundaries

Implement the smallest working slice using existing helpers. Add a meaningful
negative/regression test rather than duplicating implementation assertions.
Use the required repository checks and an isolated disposable test environment
when available. Read the actual failing CI step/log before assigning a cause.
Auth, money, migrations, concurrency authority and shared CI/entry/lockfile paths
need explicit scoped authorization, invariants and independent acceptance plans.
Never edit accepted migrations or weaken a test/CI gate to make red appear green.

Production/staging data mutations, deployments, credentials, settings, billing,
external email/payment operations and paid-agent/provider calls are out of scope.
Normal native CI caused by the assigned push/PR is allowed; no manual rerun loops,
empty commits, new workflows or escalation launches merely because CI is pending.

A scheduled task is not proof that a coding runtime is available. Verify actual
read/write/checkout/test capabilities on each run. Missing required tools or access
must be reported, not simulated. Code delivered via GitHub can await native CI,
but unavailable local tests must stay disclosed and strong assigned proof cannot
be waived by the writer. Proposed code or an instruction comment is not a commit.
No secret, private token, real customer data or credential is written to the repo.

## Delivery, not acceptance

Use `## Y1 DELIVERY` or `## Y2 DELIVERY` on the assigned PR, with assignment URL
and revision; state DELIVERED, AWAITING_CI, PARTIAL or BLOCKED; exact head/base and
branch; changed paths; tests actually executed and their outputs; native CI
run/job/attempt/tested-checkout identities where available; frozen-ID-to-fix proof;
unavailable/failed/skipped checks; and one next coordinator action.
Recheck live assignment, head and previous records before publishing. Do not repeat
an unchanged outcome or access failure every hour. On a write-access error stop;
do not switch accounts or fabricate success. Only an explicit own-row TASKS grant
allows the writer to record its real ownership/progress transition, never final
acceptance or another task's status. Maintainers remain separate.

Writers cannot approve, self-ready, merge, resolve reviewer threads, close
issues/PRs, provision labels/identities, assign other agents or impersonate
R0/R1/R2/R3/R4 receipts. Their own green tests do not establish independent review.
The coordinator consumes delivery, assigns only necessary review, handles role
labels and controls merge/post-main acceptance. No automatic label classifier,
new Dispatcher role or new mandatory acceptance gate is installed by these docs.
