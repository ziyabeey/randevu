# DE-JEV-H19-R0 — H19 Axis Shadow Fact

**Maturity:** SHADOW  
**Authority:** advisory fact only; no merge, task, review or H19 selection authority  
**H19 mutation:** none; this experiment reads frozen evidence beside H19

## Question

Can a cheap System One classifier look at a production-code change and identify which of the six frozen H19 semantic axes the change touches before H19 chooses an interaction probe?

The six questions are versioned in `questions/h19-axis.v0.1.json`. Jev answers all six in one request as `{answer:boolean, confidence:number}` facts. The model never chooses a pair. `scripts/h19-axis-shadow-score.mjs` converts the six facts into deterministic yes-probabilities and ranks all 15 axis pairs using `P(A=yes) * P(B=yes)` with lexical tie-breaking.

This is deliberately narrower than "will this probe discover a new defect?" Axis classification and novelty are different facts. A D1×D5 change can be classified correctly even when the existing suite already catches the variation. Novel coverage value should be measured later as a separate fact using benchmark outcome/memory evidence.

## Frozen benchmark

`benchmarks/h19-axis.v0.1.json` mirrors the canonical H19 integrity manifest without modifying it. Current main contains 16 registered permanent H19 scenarios: 14 `prospective`, 2 `holdout`. Frozen antipodal holdouts are D0×D3, D1×D4 and D2×D5; only D0×D3 and D2×D5 currently have registered permanent scenarios, so D1×D4 remains an explicit benchmark gap rather than an invented negative.

Each case preserves the three-arm receipt tuple already frozen by H19: baseline/current-suite, prospective probe and clean control. The receipt is evidence provenance, not an instruction to rerun or relabel H19.

## Leakage control

The benchmark label is easy to leak because H19 test names, branch names and PR prose literally contain axis IDs. Jev evaluation must therefore never receive:

- H19 scenario filenames or SQL;
- `exp/h19-bench-*` branch names;
- PR titles/bodies containing D0-D5 labels;
- benchmark manifest labels.

The evaluation input is the production-code diff bound to the baseline/current-suite receipt, with H19/test/docs metadata removed before inference. Question version, model version and an input digest are stored with the resulting fact so repeated observations can be replayed from cache.

## Metrics

The scorer reports Top-1, Top-3, mean reciprocal rank and expected-pair score for all cases, plus separate `prospective` and `holdout` cohorts. It also reports how often a prospective case ranks one of the frozen holdout pairs first. Holdouts stay separate from geometry-selection HIT scoring; they are controls, not training victories.

No promotion threshold is frozen yet. R0 remains SHADOW until the input reconstruction is complete and enough leakage-free observations exist to measure stability across question/model versions.

## Current benchmark evidence

The newer coverage-first benchmark branches provide useful outcome labels but must not be conflated with axis labels. Examples observed on 24 September 2026 include clean three-arm HITs for customers D0×D5, products D0×D2, customers D1×D5, expenses D1×D2 and reporting D2×D4. Separate Phase-1 variations such as product-sales D1×D5 and reporting D0×D4 were already caught by the existing suite; those are candidates for a later novelty/coverage fact, not negatives for axis classification.

## Local scorer

The scorer has no provider dependency and makes no network calls:

```bash
node scripts/h19-axis-shadow-score.mjs axis-facts.json
node --test tests/h19-axis-shadow-score.test.mjs
```

An input record supplies `id`, `origin`, `expectedPair` and six versioned `axisFacts`. The scorer alone computes pair ordering, so a model/provider swap cannot silently change the ranking rule.
