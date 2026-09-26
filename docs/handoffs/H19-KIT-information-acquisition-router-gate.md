# H19 Kit — Information Acquisition Router gate handoff

Date: 2026-09-26  
PR: #632  
Branch: `h19-kit-jev-utility-router-gate`  
Exact parent: #630 / `fb5ffbee59b52e4d0e5cfd4a1d0d42247fe2a78e`

## Why this gate changed

The original #632 draft framed the next control plane as a Jev utility router. A full H19
history review showed that framing was one level too narrow.

H19 v1's strongest epistemic primitive was prospective discrimination: freeze a hypothesis,
observe or intervene, retain the control and let reality resolve the uncertainty. M8–M10
later proved that Jev is useful when H19 first shapes a small provenance-bound semantic
question, but repeated Jev calls are not independent truth and provider confidence is not
calibration.

The corrected gate therefore asks:

> Which bounded information-acquisition action should H19 take next, and when should it stop
> with UNKNOWN?

## Frozen route surface

Zero/new-evidence checks:

`derive → exact-cache`

Active next-action choices:

`observe | experiment | jev-single | jev-fanout | escalate | abstain`

Only one next route is recommended per exact decision artifact. Any later escalation is a new
artifact.

## Important boundaries

- Jev is a sub-router/sensor, not the top-level controller.
- A bounded runtime/test observation may dominate a model call.
- A new prospective experiment may be the correct route when causal discrimination is needed.
- Same-model fan-out measures stability/disagreement, not independent evidence.
- Decision relevance is retained so easy low-value questions cannot inflate utility.
- No arbitrary weighted global utility score is frozen.
- No entropy reduction is called information gain without a proper prior/posterior contract.
- M11 real independent relation labels are still pending, so no learned Jev threshold is
  authorized.
- The current held-out M11 split is one repository component and supports feasibility only.
- No M12 authority, live provider, command execution, product mutation or adaptive routing.

## Ancestry repair

The earlier #632 head had diverged from #630 while both branches independently received
path-granular blind-spot test fixes. This revision is rebuilt directly on #630 exact-green
head `fb5ffbee59b52e4d0e5cfd4a1d0d42247fe2a78e`; router work is documentation/spec-only and does not carry duplicate
test commits.

## Next child after exact-head CI

Pure deterministic planner only:

- versioned uncertainty input;
- eight explicit route labels;
- reason codes + content hash;
- fail-closed budget/evaluation/authority validation;
- fake fixtures only;
- zero network/shell/live-provider behavior.

M11 label collection and a future forward shadow cohort remain separate measurement work.
