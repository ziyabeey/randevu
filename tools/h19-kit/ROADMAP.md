# H19 Kit integration roadmap

This roadmap is deliberately independent from the frozen H19s experiment.

## M0 — foundation ✅

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

M0 CI: GitHub Actions run #2743 passed on commit `e0f35a423319a16a478babd7e3abf342b72624d2`.

## M1 — repository intelligence ✅

- [x] semantic-unit extractors: JS/TS, Python, SQL
- [x] persistent git-history cache
- [x] hotspot/churn evidence
- [x] companion-missing evidence
- [x] generic test-impact persistence format
- [x] adapters for coverage.py-compatible data and JS coverage maps

M1 dedicated CI retry passed after an unrelated PostgreSQL readiness flake; M1 smoke also passed transitively in later stacked CI.

## M2 — static evidence ✅

- [x] H19-owned Semgrep rules, kept separate from upstream community rules
- [x] normalize AST/static facts into typed evidence
- [x] evidence provenance + source hashes
- [x] unknown/stale evidence handling
- [x] rule-card JSON schema

M2 CI: GitHub Actions run #2757 passed.

## M3 — experiment engine ✅

- [x] case freezer + SHA manifest
- [x] mutation-history cache
- [x] naive-feature leakage checks
- [x] blind-reader packet generator
- [x] prospective gate runner
- [x] experiment ledger updater
- [x] anti-pattern proposal guard

M3 CI: GitHub Actions run #2762 passed.

## M3.5 — code intelligence graph

- [x] normalized code graph contract
- [x] SCIP index ingestion
- [x] typed SCIP range support
- [x] bounded transitive symbol-impact closure
- [x] optional scip-typescript index generation
- [x] Tree-sitter tags syntax-only fallback
- [x] Nx affected-project adapter
- [x] Turborepo affected package/task adapter
- [x] graph/workspace impact → typed evidence
- [x] CLI surface for SCIP / Tree-sitter / affected providers
- [ ] CI green on exact M3.5 head
- [ ] real external-tool fixtures before public release

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
