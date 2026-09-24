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
- small CLI and smoke tests.

No Jev call and no external AI call is performed by this package yet.

## Licensing state

This incubator is currently `UNLICENSED` while it lives inside the application repository. Before extraction
into a public repository, the owner can choose the public license (Apache-2.0 is the current design target).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The current code does not vendor third-party source code.
