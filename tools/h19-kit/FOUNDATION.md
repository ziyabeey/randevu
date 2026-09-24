# H19 Kit foundation contract

This file defines what the foundation is allowed to assume before any semantic model or domain adapter exists.

## 1. Core owns contracts, not analyzers

The core understands:
- semantic units;
- typed evidence;
- provenance;
- rule cards;
- routing actions;
- run manifests;
- experiment memory.

It does **not** hard-code Semgrep, Jev, a test framework, GitHub or a specific programming language.

## 2. Evidence producers are independent

Static analysis, test impact, history and semantic probes are separate producers. A producer may be absent.

Missing evidence is `unknown`, never implicitly safe.

## 3. Facts and semantic probes stay separated

Deterministically extractable facts are dispatcher evidence. They are not silently copied into model prompts.

A semantic adapter must explicitly declare its prompt/input contract and version.

## 4. Every output is reproducible

A scan is identified by:
- tool version;
- config digest;
- repository base/head;
- adapter IDs and versions;
- semantic-unit digests.

The resulting run manifest has a content-derived `runId`.

## 5. Domain knowledge is an adapter

Kepenk's D0–D5 dimensions are not part of the generic foundation.

If H19s passes, they may become the first official domain adapter. If H19s fails, the foundation remains valid.

## 6. Third-party tools are replaceable

No third-party project becomes an architectural authority. Integrations communicate through normalized evidence
or standard report formats.

## 7. Experiment memory is part of correctness

Previously failed prospective approaches are not "notes"; they are machine-readable constraints on future
experiment proposals.

## 8. Default action is conservative

When evidence required by a rule is unknown, a rule may abstain or escalate according to explicit policy.
The foundation never converts unknown to safe.
