# H19 Kit integration roadmap

This roadmap is deliberately independent from the frozen H19s experiment.

## M0 — foundation (current)

- [x] evidence isolation contract
- [x] versioned rule-card primitive
- [x] deterministic dispatcher
- [x] external Semgrep JSON bridge
- [x] test-impact contract
- [x] local temporal-coupling extractor
- [x] mutation registry
- [x] experiment-memory reader
- [x] context packer
- [x] SARIF output
- [x] local evidence scan pipeline
- [x] license/integration catalog

## M1 — repository intelligence

- [ ] semantic-unit extractors: JS/TS, Python, SQL
- [ ] persistent git-history cache
- [ ] hotspot/churn evidence
- [ ] companion-missing evidence
- [ ] generic test-impact persistence format
- [ ] adapters for coverage.py/testmon-compatible data and JS coverage maps

## M2 — static evidence

- [ ] H19-owned Semgrep rules, kept separate from upstream community rules
- [ ] normalize AST/static facts into typed evidence
- [ ] evidence provenance + source hashes
- [ ] unknown/stale evidence handling
- [ ] rule-card JSON schema

## M3 — experiment engine

- [ ] case freezer + SHA manifest
- [ ] mutation-history cache
- [ ] naive-feature leakage checks
- [ ] blind-reader packet generator
- [ ] prospective gate runner
- [ ] experiment ledger updater
- [ ] anti-pattern proposal guard

## M4 — semantic probes

Only after H19s is complete:

- [ ] provider-neutral semantic-probe interface
- [ ] Kepenk D0–D5 adapter v1 if H19s passes
- [ ] keep adapter research-only if H19s fails
- [ ] optional remote semantic engine
- [ ] no deterministic facts injected into probe prompts by default

## M5 — developer surface

- [ ] `h19 init`
- [ ] `h19 scan`
- [ ] `h19 explain`
- [ ] `h19 experiment`
- [ ] GitHub Action
- [ ] SARIF upload
- [ ] reviewdog-compatible output
- [ ] local-only privacy mode
- [ ] remote-engine opt-in mode

## M6 — generalization

- [ ] second independent repository/domain
- [ ] discover candidate dimensions
- [ ] pilot mutation set
- [ ] freeze independent adapter
- [ ] compare adapter portability

## Non-goals

- becoming another general-purpose AI code reviewer;
- feeding all available context into a single LLM;
- making LLM output authoritative over deterministic evidence;
- copying third-party source merely because its license permits it.
