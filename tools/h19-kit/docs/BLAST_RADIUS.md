# Reference Blast Radius

M3.5 combines compiler-backed code intelligence, existing test/coverage evidence and Git history without
turning any one source into a risk verdict.

## Sources

1. **SCIP reference graph**
   - definitions;
   - references;
   - implementation/reference relationships;
   - read/write/import/test occurrence roles when emitted by the indexer.
2. **Coverage/test-impact evidence**
   - explicitly covered paths;
   - explicitly uncovered paths;
   - unknown remains unknown.
3. **Temporal coupling**
   - historically co-changing files;
   - missing high-confidence companions.

## Important non-claims

- A SCIP reference is not automatically a function call.
- A symbol referenced from a test file is not automatically covered at runtime.
- D5 probability is not severity.
- Reference count is not itself risk.

The blast-radius layer emits facts. Rule cards and the deterministic dispatcher decide what those facts mean.

## Future composition

```text
semantic dimension signal
          +
reference blast radius
          +
coverage/test impact
          +
temporal coupling
          +
static facts
          ↓
deterministic rule cards
          ↓
observe | targeted-test | escalate
```

Any claim that this reduces tokens or improves accuracy must be measured prospectively. No fixed percentage is
part of the M3.5 contract.
