# DEV-ENGINE-04 live acceptance smoke

Purpose: exercise the merged Development Review Automation against a real same-repository PR without changing product/runtime behavior.

Acceptance intent:
- canonical TASKS binding names this PR under DEV-ENGINE-04;
- current-head CI succeeds;
- R0/bootstrap review has no open blocker;
- Dispatcher requests only the required independent roles;
- R1 and R2 use separate Claude Routine endpoints;
- each launch is exact task/PR/head/base/CI bound and duplicate-spend fenced;
- final structured role receipts are machine-verifiable;
- this document carries no product acceptance authority.

This file exists only as a bounded post-main smoke candidate for DEV-ENGINE-04.
