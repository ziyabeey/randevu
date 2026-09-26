# H19 Kit Jev Utility Router gate

Task: **H19-KIT-JEV-UTILITY-ROUTER-GATE**. Owner: Codex + coordinator. Date: 2026-09-26.

## Decision

H19's core objective is not to make Jev authoritative or to maximize the number of Jev calls.

The control-plane objective is:

**shape smaller engineering questions, call Jev only when deterministic evidence/cache cannot resolve them, and measure the reliable uncertainty reduction produced per unit of cost.**

Jev is treated as a bounded semantic sensor.

## Key consequences

- deterministic evidence always precedes Jev;
- exact cache replay precedes live Jev;
- one live call precedes fan-out unless a prospective rule justifies fan-out;
- high disagreement may remain unresolved;
- repeated model votes are not independent truth;
- unknown/insufficient remains a valid terminal state;
- every live route requires budget + later evaluation contract;
- provider confidence is not ground truth;
- blind-spot candidates are inputs to triage, not evidence of hidden defects;
- "information gain" is reserved for properly preregistered probabilistic updates.

## First metrics

- resolved evaluable questions / provider tokens;
- provider cost / resolved evaluable questions;
- answered / insufficient / error / unresolved counts;
- disagreement rate for fan-out;
- downstream recommendation-change count;
- later confirmed / rejected / unresolved Jev decisions;
- false-confidence cases.

All metrics retain exact denominators.

## Boundary

This gate adds no live-provider authority and changes no M8–M11 scientific artifact.

The next child should implement only a pure deterministic route planner and fake-provider
test harness before any new live collection.
