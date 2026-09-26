# JEV Utility Router Gate v0.1 — proposed H19 control plane

**Status:** frozen-design candidate; no new live provider authority.
**Task:** H19-KIT-JEV-UTILITY-ROUTER-GATE.
**Parent:** H19-KIT-RUNTIME-COVERAGE-BLIND-SPOTS.
**Goal:** maximize reliable engineering information extracted from Jev while minimizing unnecessary calls, cost, duplicated evidence and false confidence.

## 1. North star

H19 is not a general-purpose coding agent and Jev is not an oracle.

H19 shapes bounded engineering questions, decides whether Jev should be asked at all,
records what Jev was allowed to see, measures what uncertainty was actually resolved,
and retains abstention/unknown states when evidence is insufficient.

Primary optimization question:

> For a frozen engineering uncertainty, which route produces the most useful,
> independently checkable reduction in uncertainty per unit of provider cost?

The router must prefer deterministic evidence over model calls and must never convert
provider confidence into deterministic fact.

## 2. Routing order

Every candidate Jev question enters one deterministic routing plan.

1. **deterministic** — the requested answer is already derivable from versioned H19 evidence.
2. **cache** — an exact content-addressed answer exists for the same question/input/model identity.
3. **single-live** — one live Jev call is justified by unresolved semantic ambiguity.
4. **fanout-live** — multiple isolated calls are justified prospectively by a frozen disagreement/uncertainty rule and bounded budget.
5. **abstain** — available evidence cannot form a meaningful bounded question, or expected utility cannot justify a provider call.

Routes are mutually exclusive for one exact routing decision. A later escalation creates a new
versioned decision artifact; it does not silently mutate the previous route.

## 3. Jev-eligible question classes

Initial eligible classes are deliberately narrow:

- relation judgment over an already frozen M9 case;
- blind-spot triage over explicit H19 unknown/unmatched candidates;
- bounded experiment-choice proposals where allowed actions are predeclared;
- candidate prioritization where all candidates and comparison dimensions are frozen;
- contradiction triage over explicitly conflicting evidence families;
- human-facing evidence compression, when the summary cannot change engineering authority.

Jev is not required for:

- exact graph traversal;
- source/hash/provenance checks;
- cache identity;
- coverage arithmetic;
- deterministic test selection already resolved by contract;
- source parsing/indexing;
- known rule evaluation;
- any question that cannot be evaluated later.

## 4. Required routing inputs

A routing decision must bind:

- question id + version;
- exact input digest;
- evidence-family inventory;
- evidence completeness state;
- lineage overlap state;
- explicit unknown/conflict inventory;
- available exact cache identity;
- provider/model identity;
- maximum live-call count;
- maximum input/output token budget;
- monetary ceiling or explicit null when no live call is permitted;
- timeout;
- evaluation method available after the answer;
- escalation policy version.

Missing cost/budget identity blocks live execution. Missing evaluation method blocks
claims about Jev usefulness even if a live call is otherwise allowed.

## 5. Utility accounting

Do not optimize raw call count or token count in isolation.

For each routed question retain:

- provider requests attempted;
- cache hits;
- input/output tokens where available;
- billed/estimated cost with rate source and currency;
- wall-clock latency;
- answered / insufficient / transport-error state;
- disagreement state for fan-out;
- pre-call uncertainty state;
- post-evaluation resolution state;
- whether the result changed any downstream recommendation;
- whether later evidence confirmed, rejected or left the answer unresolved.

### 5.1 Resolved uncertainty

A question counts as **resolved** only when the frozen evaluation contract can distinguish
its prior uncertainty from a later supported state. A model answer alone is not resolution.

### 5.2 Jev Utility per Token

Descriptive metric:

`resolved-evaluable-questions / total-provider-tokens`

Always report numerator and denominator. Do not compare across question classes without
showing the class mix.

### 5.3 Cost per Resolved Uncertainty

`total-provider-cost / resolved-evaluable-questions`

Unknown cost remains null, never zero.

### 5.4 Decision-impact utility

Report the count of evaluated Jev answers that caused a permitted downstream recommendation
to differ from the deterministic/cache-only route. This is descriptive, not automatically beneficial.

### 5.5 Uncertainty reduction

Do not call a quantity "information gain" merely because entropy decreased.

A Shannon-style information-gain claim is allowed only when:
- a versioned prior probability distribution exists before the call;
- the posterior update rule is preregistered;
- both are over the same outcome space;
- the provider answer is not itself treated as ground truth;
- the evaluation cohort is independent of the update-rule tuning.

Until then use explicit operational labels such as:
- unresolved → resolved;
- candidate set reduction;
- disagreement reduction;
- unknown-class reduction.

## 6. Fan-out policy

Fan-out is not majority voting by default.

A fan-out plan must predeclare:
- number of isolated calls;
- same/different model policy;
- whether prompts are identical;
- exposure equality;
- disagreement metric;
- stopping rule;
- maximum total live questions;
- aggregation behavior.

High disagreement may produce `unresolved` or escalation. It must not be silently collapsed
to the modal answer.

Repeated calls to the same model/input do not create independent reference truth.

## 7. Blind-spot feedback

The router consumes the blind-spot ledger but may not erase candidates directly.

For each blind spot:
- deterministic capability repair is preferred when possible;
- Jev may classify/triage the explicit limitation;
- any proposed capability change remains a separate experiment;
- before/after blind-spot identity must be comparable before a reduction rate is emitted.

The router should eventually learn descriptive **question-class utility profiles**, but v0.1
does not permit online self-modification of routing thresholds.

## 8. Cache semantics

Cache identity includes at minimum:
- question version;
- exact input digest;
- provider/model;
- relevant decoding/request contract.

Cache hits consume zero live-call budget.

Invalid or identity-mismatched cache content fails closed. It must not fall through to a live
call unless a separately frozen policy explicitly authorizes replacement.

## 9. Evaluation and calibration

Jev quality is evaluated against evidence that is separate from the provider response.

Depending on question class this may be:
- blind independent relation assessments;
- later functional validation;
- controlled experiment outcome;
- bounded human review;
- deterministic ground truth for synthetic contract cases.

Track:
- agreement;
- abstention;
- transport/error rate;
- unresolved fraction;
- class-conditioned utility;
- Brier/log loss only when a valid probability vector and independent reference label exist;
- false-confidence cases where Jev was decisive but later evidence rejected the answer.

No global "Jev accuracy" number is valid without a declared population and denominator.

## 10. Authority boundary

Jev remains advisory in v0.1.

The router may recommend:
- no call;
- cache replay;
- single call;
- bounded fan-out;
- abstention;
- follow-up experiment.

It may not:
- merge code;
- mutate product/runtime state;
- silently write permanent tests;
- override deterministic safety gates;
- relabel unknown as safe;
- promote its own answer to independent evidence;
- activate M12 selection authority.

## 11. Initial acceptance criteria

JR1. Deterministic/cache/live/fanout/abstain routes are explicit and content-addressed.

JR2. Deterministic-resolvable cases produce zero provider calls.

JR3. Exact cache hits produce zero provider calls.

JR4. Live execution requires explicit count/token/cost/timeout ceilings.

JR5. Missing evaluation contract prevents utility claims.

JR6. Fan-out preserves every individual answer and disagreement; no automatic majority truth.

JR7. Unknown/insufficient remains first-class and can terminate routing without a live call.

JR8. Utility report retains raw numerators/denominators, tokens, cost, latency and exclusions.

JR9. No entropy/information-gain claim without a preregistered probabilistic update contract.

JR10. Blind-spot routing cannot erase or resolve a blind spot without independent follow-up evidence.

JR11. CI uses fake providers only.

JR12. Existing M8–M11 artifacts and identities remain unchanged.

## 12. First implementation slice after freeze

Implement a pure deterministic router over synthetic/frozen fixtures only:

- input: one versioned question candidate + evidence/budget/cache metadata;
- output: one route decision with reason codes and content hash;
- no network access;
- fake-provider execution harness for single/fanout paths;
- utility-ledger schema that records zero empirical claims by default.

The first experiment should compare:
A. deterministic-only;
B. deterministic + exact cache;
C. router + bounded Jev;

on a frozen development cohort with independent evaluation available.

Do not tune route thresholds on the evaluation split.
