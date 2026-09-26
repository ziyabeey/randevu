# H19 Information Acquisition Router Gate v0.1

**Status:** frozen-design candidate; no live acquisition authority.  
**Task:** H19-KIT-INFORMATION-ACQUISITION-ROUTER-GATE.  
**Parent:** H19-KIT-RUNTIME-COVERAGE-BLIND-SPOTS / PR #630 exact head `fb5ffbee59b52e4d0e5cfd4a1d0d42247fe2a78e`.  
**Goal:** choose the cheapest bounded, independently evaluable action that can reduce a
decision-relevant engineering uncertainty without converting model confidence or missing
evidence into fact.

## 1. North star

H19 is an epistemic control layer, not a general-purpose coding agent and not a Jev wrapper.

Primary question:

> For one frozen engineering uncertainty, what evidence-acquisition action should H19 take,
> how much may it spend, and when should it stop with UNKNOWN?

Jev remains useful because it is cheap and fast, but it competes with deterministic
derivation, exact replay, direct observation and prospective experiments. H19 must prefer
the route that has a valid evaluation contract and the best bounded engineering value, not
the route that produces the most answers.

## 2. Mandatory zero/new-evidence checks

Before any active acquisition route:

1. **derive** — answer is already derivable from versioned deterministic H19 evidence;
2. **exact-cache** — an exact content-addressed result exists for the same question, input,
   provider/model/request contract where that result is still admissible.

If either route resolves the frozen uncertainty, no new provider call, observation or
experiment is authorized.

A replay is not new evidence. Operational staleness or changed input identity invalidates
the replay instead of being silently ignored.

## 3. Active acquisition routes

If the uncertainty remains unresolved, the planner may recommend exactly one next route.
A later escalation is a new content-addressed decision artifact.

### 3.1 observe

Read-only collection of already existing reality, for example:

- runtime coverage for a pinned path/test;
- a bounded existing test execution;
- deterministic repository/runtime metadata;
- a previously unavailable trace or measurement.

Observation is preferred over semantic inference when it directly discriminates the
uncertainty at acceptable cost.

### 3.2 experiment

A new prospective intervention or probe whose discrimination rule is frozen before outcome
inspection. This route inherits H19 v1 discipline:

- hypothesis frozen first;
- action/probe and expected discrimination frozen before the result;
- variation/control identities retained where applicable;
- infrastructure failures remain inconclusive;
- result is not rewritten after observation.

The router may propose an experiment. v0.1 does not execute it.

### 3.3 jev-single

One bounded Jev request over a frozen, evaluable question when semantic ambiguity remains
and deterministic/observational routes do not dominate it.

### 3.4 jev-fanout

Multiple isolated Jev requests only when a prospective disagreement/stability rule and
total budget justify them.

Fan-out is **not majority truth**. Repeated calls to the same model/question/input do not
become independent reference evidence. They measure stability, variance or disagreement.

### 3.5 escalate

Recommend an explicitly higher-cost evaluator, such as bounded human review or an approved
higher-capability reasoning system, when the decision is important enough and cheaper
routes cannot resolve it.

Escalation itself is not ground truth. Its output requires the evaluation contract declared
for that route. v0.1 performs no escalation.

### 3.6 abstain

Return UNKNOWN when:

- a meaningful bounded question cannot be formed;
- required provenance/evaluation is missing;
- all permitted acquisition routes exceed their budget or authority;
- disagreement remains unresolved;
- expected discrimination is too weak to justify the next action.

Abstention is a successful fail-closed control outcome, not a transport error.

## 4. Required uncertainty contract

Every candidate must bind:

- uncertainty id + version;
- exact source/input revision and digest;
- decision surface that could change if resolved;
- decision relevance class: `diagnostic | planning | execution-gating | safety-gating`;
- current known/unknown/conflicting evidence inventory;
- evidence-family and lineage state;
- admissible answer/outcome space;
- available exact-cache identity;
- allowed acquisition routes;
- per-route cost/budget ceiling;
- per-route side-effect/authority class;
- expected discrimination statement;
- independent evaluation method available after the result;
- escalation policy version;
- stop conditions.

Missing evaluation method blocks claims that a route was useful. Missing budget/authority
blocks any non-zero-cost or side-effecting execution.

## 5. Decision relevance

Raw question resolution is not enough.

The ledger separately records whether the uncertainty could change:

- only explanation/diagnostics;
- test or experiment planning;
- an execution recommendation;
- a safety/merge/release gate.

A router must not inflate utility by resolving many trivial questions while ignoring a
small number of decision-critical unknowns. v0.1 records relevance but does not assign
arbitrary numerical weights to it.

## 6. Utility accounting

Do not collapse the system into an unfrozen scalar score.

For every route retain raw dimensions:

- acquisition attempts;
- cache hits;
- input/output tokens when applicable;
- billed/estimated monetary cost and rate source;
- wall-clock latency;
- execution/transport errors;
- abstention;
- fan-out disagreement;
- pre-route uncertainty state;
- post-evaluation resolution state;
- decision relevance;
- whether the permitted downstream recommendation changed;
- whether later evidence confirmed, rejected or left the result unresolved;
- false-confidence cases.

### 6.1 Resolved uncertainty

A question counts as resolved only when its frozen evaluation contract can distinguish the
prior unknown/conflict from a later supported state. A Jev answer alone is not resolution.

### 6.2 Jev Utility per Token

Descriptive metric:

`resolved-evaluable-questions / total-provider-tokens`

Always report numerator, denominator and question-class mix.

### 6.3 Cost per Resolved Uncertainty

`total-acquisition-cost / independently-resolved-evaluable-questions`

Report route mix. Unknown cost is null, never zero.

### 6.4 Decision-impact utility

Report how many evaluated acquisitions changed a permitted downstream recommendation and
what later evaluation said about those changes. A changed recommendation is not
automatically a beneficial recommendation.

### 6.5 No premature information-gain claim

Entropy reduction is not automatically information gain.

Shannon-style information gain requires a separately preregistered prior, posterior update
rule, common outcome space and independent evaluation cohort. Until then use operational
states such as:

- unresolved → resolved;
- candidate-set reduction;
- disagreement reduction;
- blind-spot reduction.

## 7. Route comparison rules

v0.1 is deterministic and policy-based, not learned.

Mandatory precedence:

1. derive when exact deterministic resolution exists;
2. exact-cache when the exact admissible result already exists;
3. otherwise compare only routes explicitly allowed by the candidate contract.

For active routes, the planner uses frozen reason rules, not a learned expected-value model.
Examples:

- prefer observe when a bounded read-only measurement directly discriminates the outcome;
- prefer experiment when causal discrimination requires a prospective intervention;
- allow jev-single for bounded semantic ambiguity with independent later evaluation;
- allow jev-fanout only under a frozen stability/disagreement need;
- escalate only under an explicit higher-cost policy;
- abstain when none is justified.

Learning route thresholds from historical outcomes is deferred until an independent cohort
supports it.

## 8. Jev sub-router boundaries

Initial Jev-eligible classes remain narrow:

- relation judgment over a frozen M9 case;
- blind-spot triage over explicit unknown/unmatched candidates;
- bounded experiment-choice proposals over predeclared actions;
- candidate prioritization over a frozen candidate set;
- contradiction triage over explicit evidence families;
- human-facing evidence compression that cannot change authority.

Jev is unnecessary for exact graph traversal, hashes/provenance, coverage arithmetic,
deterministic rule evaluation or any question that cannot later be evaluated.

Provider confidence is metadata only. A probability vector may be scored only against a
separate reference label. No global "Jev accuracy" exists without a declared population
and denominator.

## 9. Observation and experiment provenance

An observation/experiment result must not be treated as independent merely because it was
produced by a different command.

Its receipt binds:

- producer and version;
- exact input/source identity;
- root evidence lineage;
- execution environment where relevant;
- observation/probe plan;
- raw result artifact;
- interpretation rule.

Shared-root observations are marked as related evidence and cannot be double-counted.

## 10. M11 and calibration boundary

The existing M11 blind independent-assessment freeze contains three development cases and
requires two separate assessments per case, but real relation labels remain pending.
Therefore v0.1 may design routing and logging contracts but may not learn Jev thresholds,
claim calibration, or infer a reliable fan-out stopping rule from those cases.

The repaired M11 split also has only one held-out repository component. It is a feasibility
boundary, not a population-level calibration set.

A future forward shadow cohort must be frozen separately before adaptive policies or
validated thresholds are introduced.

## 11. Authority boundary

The router may recommend:

- derive;
- exact-cache;
- observe;
- experiment;
- jev-single;
- jev-fanout;
- escalate;
- abstain.

In v0.1 it may not:

- execute shell/test/runtime observation commands;
- perform live provider calls;
- invoke higher-cost models automatically;
- mutate product/runtime state;
- merge code;
- silently write permanent tests;
- override deterministic safety gates;
- relabel UNKNOWN as safe;
- promote its own output to independent evidence;
- activate M12 test-selection authority;
- self-modify route thresholds.

## 12. Acceptance criteria

IA1. Every route decision is explicit, versioned and content-addressed.

IA2. Deterministically resolved cases authorize zero new acquisition.

IA3. Exact admissible cache replay authorizes zero new acquisition.

IA4. Active routes require explicit cost/budget, authority, discrimination and evaluation
contracts.

IA5. Observation and experiment are first-class alternatives to Jev.

IA6. Fan-out retains all individual answers/disagreement and never converts majority vote
into independent truth.

IA7. UNKNOWN/insufficient may terminate routing successfully.

IA8. Decision relevance is retained separately from resolution count.

IA9. Utility reports retain raw numerators/denominators, route mix, cost, latency,
exclusions and later outcomes.

IA10. No entropy/information-gain claim without a preregistered probabilistic update.

IA11. Blind-spot candidates cannot be erased by router recommendation alone.

IA12. M11 labels/outcomes, M8–M10 identities and existing H19 v1 evidence remain unchanged.

IA13. First implementation has no network, shell execution, product writes or live
credentials.

IA14. Exact-green parent ancestry is required before the gate is accepted.

## 13. First implementation slice after freeze

Implement one **pure deterministic information-acquisition planner** over synthetic/frozen
fixtures:

- input: one versioned uncertainty candidate plus evidence/cache/budget/authority metadata;
- output: one route recommendation with reason codes and content hash;
- support all eight route labels;
- no command execution;
- no network access;
- fake Jev/observation/experiment fixtures only;
- ledger schema defaults empirical claims to zero/null;
- tests prove deterministic replay, fail-closed missing evaluation/budget and fan-out
  non-independence.

The first measurement after plumbing exists should compare, on a frozen development cohort:

A. derive/cache only;  
B. derive/cache + observe/experiment proposals;  
C. B + bounded Jev routes.

Do not tune thresholds on the held-out evaluation component. Do not begin adaptive routing
until a separately frozen forward shadow cohort exists.
