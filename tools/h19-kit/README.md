# H19 Kit

H19 Kit is the isolated incubator for the future free change-intelligence tool.

It is deliberately separate from the Kepenk application and from the frozen H19s experiment. Nothing in this
directory is part of the H19s candidate router or its eligible SQL-unit sample.

## Current goal

Combine useful ideas from several tool families without turning a large LLM into the center of the system:

```text
diff
  ↓
context packer
  ↓
┌──────────── evidence plane ────────────┐
│ static facts · test impact · git history│
└─────────────────────────────────────────┘
  ↓                         ↓
semantic probes        deterministic rules
  ↓                         ↓
        deterministic dispatcher
                 ↓
      pass · test · escalate
                 ↓
        optional System Two
```

## What is implemented in the incubator

- versioned rule-card contract;
- evidence-isolation contract;
- deterministic dispatcher primitives;
- external Semgrep bridge (no Semgrep code bundled);
- local git temporal-coupling extractor implemented from scratch;
- test-impact adapter contract;
- mutation registry;
- SARIF reporter;
- repository inventory for SQL/TS/JS/Python;
- persistent test-impact and git-history intelligence;
- H19-owned static transaction facts and declarative rule cards;
- small CLI and layered smoke tests.

No Jev call and no external AI call is performed by this package yet.

## Licensing state

This incubator is currently `UNLICENSED` while it lives inside the application repository. Before extraction
into a public repository, the owner can choose the public license (Apache-2.0 is the current design target).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The current code does not vendor third-party source code.

## Local commands

```bash
node tools/h19-kit/bin/h19-kit.mjs doctor
node tools/h19-kit/bin/h19-kit.mjs history .
node tools/h19-kit/bin/h19-kit.mjs scan tools/h19-kit/examples/scan-input.json
node tools/h19-kit/bin/h19-kit.mjs scan tools/h19-kit/examples/scan-input.json --sarif
npm run test:h19-kit
npm --prefix tools/h19-kit run test:m1
npm --prefix tools/h19-kit run test:m2
```

The `scan` command is intentionally model-free. It combines already-produced evidence through deterministic
rules. H19s decides whether the Kepenk semantic router is eligible to become a packaged adapter later.

See [ROADMAP.md](ROADMAP.md) and [integrations/catalog.v0.1.json](integrations/catalog.v0.1.json).

## Code intelligence adapters

Optional external tools can enrich the deterministic evidence graph without becoming hard dependencies:

```bash
# Inspect optional providers
node tools/h19-kit/bin/h19-kit.mjs doctor

# SCIP compiler-backed/reference graph impact
node tools/h19-kit/bin/h19-kit.mjs scip-index-ts . pnpm
node tools/h19-kit/bin/h19-kit.mjs scip-impact index.scip src/changed.ts

# Tree-sitter syntax-only fallback tags
node tools/h19-kit/bin/h19-kit.mjs syntax-tags src/example.rb

# Existing monorepo project/package graphs
node tools/h19-kit/bin/h19-kit.mjs affected nx main HEAD
node tools/h19-kit/bin/h19-kit.mjs affected turbo main HEAD test
```

SCIP/native compiler information outranks syntax-only Tree-sitter tags. Nx and Turborepo adapters report
workspace-level impact; they do not replace symbol-level analysis.

See [docs/CODE_INTELLIGENCE_GRAPH.md](docs/CODE_INTELLIGENCE_GRAPH.md).
