# H19 blind interaction discovery — Payments D1 x D5

Status: preregistered before inspecting candidate implementation sites.

## Frozen interaction
- Domain: payments
- D1: atomicity / idempotency
- D5: concurrency / version

## Frozen hypothesis
Two logically identical payment commands that overlap in time must converge through the payment command identity and replay contract. Concurrency must not surface a raw uniqueness failure, duplicate durable payment event, duplicate balance movement, or divergent replay payload.

## Blind-selection rule
This candidate was selected from an uncovered domain/axis region before inspecting the payment ledger implementation for a favorable mutation site.

## Experimental protocol
1. Choose exactly one minimal, user-reachable variation that weakens the conjunction of payment idempotency and concurrency while leaving ordinary sequential behavior intact where possible.
2. Do not add or alter tests before the variation-only CI run.
3. If the unchanged canonical suite fails, record this interaction as already covered and stop. Do not search for another variation for this candidate.
4. If the unchanged suite passes, add exactly one D1xD5 prospective probe using overlapping sessions and the same logical payment command identity.
5. Run the identical probe on correct code.
6. Credit prospective incremental coverage only for:
   - variation / unchanged suite: PASS
   - variation + preregistered probe: FAIL at the intended invariant
   - correct code + identical probe: PASS

## Frozen intended invariant
For the same tenant, same payment command class, same idempotency key, and same request hash:
- exactly one durable command identity exists;
- at most one authoritative payment mutation is applied;
- the overlapping caller resolves through the documented idempotency contract, not a raw database uniqueness error;
- final ticket/payment balance and event history remain coherent.

Null results remain part of the H19 discovery-rate denominator.
