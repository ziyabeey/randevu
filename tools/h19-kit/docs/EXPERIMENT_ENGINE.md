# Experiment engine

H19 Kit turns the research discipline used in H19 into reusable primitives.

## Freeze

```bash
node tools/h19-kit/bin/h19-kit.mjs experiment-freeze \
  tools/h19-kit/examples/experiment-cases.json DEMO 0.1 > frozen.json
```

The output records:
- experiment ID;
- protocol version;
- immutable case list;
- case-set SHA-256;
- manifest SHA-256.

## Blind sample

```bash
node tools/h19-kit/bin/h19-kit.mjs experiment-blind frozen.json 2
```

The frozen case hash is used as the deterministic seed.

## Leakage gate

`leakageGate()` tests whether a single naive feature already carries the target label. The caller chooses the
prospectively frozen AUC interval.

## Acceptance gates

`evaluateGates()` applies predeclared numeric comparisons. It does not discover thresholds.

## Mutation history

`MutationHistory` prevents expensive or semantically identical mutations from being rediscovered merely
because a new experiment run started.

The toolkit intentionally does not choose scientific thresholds on behalf of a domain adapter. Those belong to
the preregistered experiment protocol.
