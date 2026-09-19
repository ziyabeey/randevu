# Development telemetry review

**Canonical prompt, not registered automation.** Intended trigger: manual first,
optionally a coordinator-approved local schedule. See [setup](../README.md#setup).
Control `DE-TELEMETRY`, maturity `SHADOW`; depends_on exact evidence and overlaps
existing CI/review receipts. No autonomous optimization or gate changes.

## Prompt

Use the [telemetry Skill](../../../.github/skills/development-telemetry-review/SKILL.md).
Require a bounded observation window, comparable task/risk cohort and source
coverage. Use native GitHub/repo tools. Report raw sample counts before summaries.

| Metric | Evidence/definition |
| --- | --- |
| Cycle time | Canonical task-start to coordinator closure; unfinished tasks are censored, not closed |
| CI wall time and attempts | Actual job start/end, run/job/attempt and head; queue delay separate |
| Repair commits / review resets | Explicit linked repair/reset receipts; not guessed from messages |
| R1/R2 material and false findings | Coordinator/reviewer disposition with finding identity |
| Unique / duplicate control value | Evidence of distinct or repeated finding classes, not role stereotypes |
| Context / receipt size | Measured token data if available; otherwise labeled byte-size proxy or unknown |
| Escaped defects | Observable linked post-acceptance defects in the window; unobserved is not zero |
| Shadow useful-work ratio | Explicit measured useful/total microtask or time denominator; unknown without it |

For every control record trigger count, material/false findings, unique/duplicate
value, added wall time, context cost and evidence of prevented escaped defects
(unknown absent evidence; do not infer a counterfactual from finding a bug).
Use `reinforces / depends_on / overlaps / narrows / supersedes / conflicts_with`
to describe relationships, naming the existing control and preserved invariant.

Unknown values are null with a reason, not zero. Do not compute percentages with
missing/zero denominators or generalize from a tiny cohort. Invalid timestamps or
incomparable samples are explicit exclusions. CI causes require exact failed-job
artifacts/annotations; summary-derived diagnoses remain provisional and corrected
false findings stay in the ledger.

```text
Window / cohort / sample size / coverage:
Metric: definition / n / value or unknown / unit / evidence refs
Control: maturity / relations / triggers / material / false / unique / duplicate / costs
Limitations and provisional observations:
Recommendation / next coordinator action:
```

Output only a compact report/draft, posting a comment only if explicitly allowed.
Historical observations remain bound to their original head/run; refresh current
state before publishing. No code/settings/roadmap/ownership changes, APPROVE,
ready/merge, automatic control promotion/retirement or required-CI reduction.
Stop when provenance is inadequate; return partial/unknown measurements honestly.
