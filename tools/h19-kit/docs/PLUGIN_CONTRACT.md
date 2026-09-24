# Plugin contract

A plugin is an evidence producer.

```js
{
  id: "my-analyzer",
  kind: "static",
  version: "1.2.0",
  produces: ["static.lock.present"],
  capabilities: ["sql"],
  async run(unit, ctx) {
    return [
      { id: "static.lock.present", state: "present", details: {...} }
    ]
  }
}
```

## Required behavior

- `run()` receives one semantic unit.
- it returns zero or more typed evidence rows;
- it does not directly decide the final route;
- it does not mutate the repository;
- deterministic producers should be pure for the same unit/config/version;
- external providers should attach source/input provenance where possible.

## Declared outputs

`produces` lists evidence IDs that the plugin owns.

If the plugin fails and the engine uses `failurePolicy=unknown`, every declared output is materialized as
`unknown`. A crash therefore cannot accidentally become "evidence absent".

With `failurePolicy=throw`, the engine stops instead.

## Kinds

Kinds are organizational, not authority levels:
- `static`
- `testImpact`
- `history`
- `semantic`
- custom adapter kinds

Rule cards consume evidence IDs, not plugin names.
