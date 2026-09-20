# R&D Lab automation contract

A1/A2/A3 are optional GitHub-native research roles. They explore opportunities
without changing product scope, TASKS, application code, CI, deployment or review
authority. Their hourly schedules are wake-up checks, not permission to invent
work. `main:TASKS.md` remains the sole durable project/task status authority.

## Roles

| Role | Stage label | Contribution | Never does |
| --- | --- | --- | --- |
| A1: R&D Radar | `rnd-stage:radar` | Finds one materially new, evidence-backed product/engineering opportunity and opens a bounded proposal issue. | Code, TASKS edits, feature commitment, PR/CI/model launch, duplicate idea spam. |
| A2: Idea Validator | `rnd-stage:validated` or `rnd-stage:rejected` | Stress-tests one radar proposal against current architecture, product scope, duplication, dependency/cost/risk and available evidence. | Rewriting the idea into a requirement, coding it, promising ROI, self-promoting to TASKS. |
| A3: Experiment Designer | `rnd-stage:experiment-ready` | For one validated proposal, designs the smallest reversible PoC/measurement plan and explicit success/failure criteria. | Production changes, live-data experiments, deployment, creating a writer assignment or merge gate. |

Only the coordinator may apply `rnd-stage:promoted` and turn an R&D proposal
into a real TASKS item or writer assignment. Promotion must use the normal task
scoping, ownership, validation-budget and acceptance process. Until then an R&D
issue is a proposal, not planned work.

## Proposal identity and issue format

A1 creates individual GitHub issues titled `[R&D] <short idea>`. Before creating
one, search open and closed R&D issues for semantic duplicates and recent variants.
The issue must carry exactly one R&D stage label and this compact body:

```text
## R&D PROPOSAL
Role: A1
Fingerprint: <stable hash or normalized key>
Observed problem/opportunity: <concrete current signal>
Proposal: <one bounded idea>
Why Kepenk.ai: <specific fit, not generic trend language>
Evidence: <current repo evidence and/or public source links>
Likely benefit: <measurable hypothesis, not a promise>
Cost/complexity: LOW | MEDIUM | HIGH + short reason
Risks/tradeoffs: <known risks and failure modes>
Duplicate search: <queries/issues checked>
Recommended validator question: <one falsifiable question for A2>
No product commitment: true
```

A1 may create at most one materially new proposal per run and must observe a
four-hour proposal cooldown across its own new issues unless the coordinator
explicitly requests a focused scan. No useful novelty means no issue/comment.

## Validation lifecycle

A2 processes at most one oldest open `rnd-stage:radar` issue per run. It must read
current main/TASKS, PRODUCT_SPEC, relevant architecture/decision docs and the
proposal evidence. It leaves one `## A2 VALIDATION` comment with:

- verdict `VALIDATED | REJECTED | INCOMPLETE`;
- duplicate/overlap findings;
- current architecture/product fit;
- evidence quality and what would falsify the idea;
- implementation/dependency/cost/risk notes;
- one coordinator next action.

A2 then changes only the R&D stage label: VALIDATED -> `rnd-stage:validated`,
REJECTED -> `rnd-stage:rejected`; INCOMPLETE remains radar and must not be
repeated without materially new evidence. It does not edit TASKS or code.

A3 processes at most one oldest open `rnd-stage:validated` issue per run. It
leaves one `## A3 EXPERIMENT` comment defining the smallest reversible experiment:

- hypothesis and counter-hypothesis;
- exact measurement and success/failure threshold;
- sandbox/test-only data boundary;
- smallest files/surfaces that a future writer would need, if any;
- rollback/stop condition;
- estimated effort and required evidence;
- what must NOT be changed or inferred.

A3 then moves only that issue to `rnd-stage:experiment-ready`. It does not create
a branch, PR, writer assignment, CI rerun, deployment or external provider action.
If a code PoC is warranted, the coordinator must promote/scoped-assign it normally.

## Safety, freshness and noise controls

- Use direct GitHub tools for repo facts; use current public web sources only where
  external freshness is material. Never use TinyFish.
- No secrets, customer data, private competitor data, credentials or live business
  actions. Never contact customers or vendors from R&D automation.
- A1/A2/A3 may not modify application code, tests, migrations, TASKS, AGENTS,
  workflow/CI, settings, secrets, review receipts, PR readiness or merge state.
- Existing tasks/PRs outrank R&D ideas. Do not reopen accepted scope or convert
  reviewer nits into proposals merely to create activity.
- R&D stage transitions are not acceptance, review or delivery evidence.
- Re-read issue labels/comments immediately before writing. If another automation
  already produced the same stage result, stop without duplicate output.
- Unknown access, incomplete pagination or stale evidence is not a negative result.
- No unchanged-status heartbeat comments. The repository should look alive because
  useful evidence appears, not because bots manufacture noise.

## Promotion boundary

A coordinator may promote an experiment-ready issue only after deciding it belongs
in the product/tooling roadmap. Promotion creates a normal scoped task through the
existing protocol, then optionally assigns Y1/Y2/Qwen or another implementer.
The original R&D issue stays as research provenance and must link to the promoted
TASKS/PR work; it never becomes a parallel status authority.
