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

The M8/M10 library APIs support explicit opt-in advisory Jev calls. M9 composes
the cases deterministically; M10 sends one isolated request per selected case,
concurrently. The CLI `scan` path remains model-free and does not invoke them.
CI uses fake providers only. See [BUNDLE.md](BUNDLE.md) for the active sequence.

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

## M11 development preparation

The [saved-observation bridge](specs/M11_OBSERVATION_BRIDGE-v0.1.md) binds the
original TAP/V8 and static closure observations to the repaired inventory.
[Result 001](experiments/m11/BRIDGE-001.md) contains one eligible M9 case shared
by five reference controls, plus 17 retained skips. This is a draft preparation
result; relation labels, broader functional evaluation and paid comparisons are pending.

The [first targeted validation](experiments/m11/validation-001/REPORT.md) confirms
one suite-scoped coverage gap with seven passing scenarios and four newly called
entries. Its frozen M8 outcome is a coverage validation, not a defect or relation
label. Replay its saved receipt with `npm --prefix tools/h19-kit run test:m11-validation`.
