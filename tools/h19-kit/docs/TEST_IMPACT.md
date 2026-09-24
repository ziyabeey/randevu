# Test impact data model

H19 Kit does not require one test framework.

The core relation is:

```text
semantic-unit digest -> tests that executed that unit
```

A provider records this relation into `.h19/test-impact.v1.json`.

## Supported foundation inputs

- Istanbul-compatible statement coverage JSON;
- coverage.py JSON with `executed_lines`;
- custom providers that normalize to a `Map<path, Set<line>>`.

Coverage is useful only when it is associated with a known test invocation. Aggregate whole-suite coverage can
prove that code was covered by *something*, but cannot select a test. Providers should therefore capture one
test or one stable test group per coverage snapshot when predictive selection is desired.

Unknown coverage remains unknown. An absent test-impact record is never interpreted as "no test covers this".
