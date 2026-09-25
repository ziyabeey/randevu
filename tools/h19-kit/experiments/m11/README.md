# M11 pilot input inventory

This directory contains preparation for the
[proposed M11 measurement contract](../../specs/RELATIONAL_MEASUREMENT_GATE-v0.1.md).
It contains **24 scenario anchors, zero materialized M8 cases and zero labels**.
The existing tests identify baseline behaviors to investigate. Their names and
assertions do not establish a new defect, a coverage gap or a relation label.

## Source and scope

- Repository: `ziyabeey/randevu`.
- Product source: `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`.
- H19 tool source: `6a37baebca749482465d3dd302f9bae56d3ff2e0` (M10 repair).
- [Inventory](COHORT-v0.1.json): M3 `freezeCases` schema v1, protocol `0.1-draft`.
- 23 distinct reference-suite/primary-target Git blob identities are embedded.
- Full dependency closure and actual change identity are pending materialization.

| Declared cluster | Anchors | Split | Current reference evidence |
| --- | ---: | --- | --- |
| pagination | 5 | development | Unit runtime assertions |
| calendar-refresh | 2 | evaluation | Unit runtime assertions |
| public-selection | 7 | development | Source-text contract assertions |
| catalog-price-projection | 4 | evaluation | Source-text contract assertions |
| runtime-notification | 6 | evaluation | Mocked runtime and mixed unit/source assertions |
| Total | 24 | 12 development / 12 evaluation | Not 24 independent samples |

These are all top-level named controls in the six declared test suites. The
three nested notification budget subtests are included through their parent
control, not counted again. Selection preceded any M11 model response or label.
This is a purposive feasibility sample; no representative sampling claim.

The selected suites are:

- `tests/s07-pagination.test.mjs`
- `tests/f13-calendar-refresh.test.mjs`
- `tests/f12-public-multi-selection.test.mjs`
- `tests/f12-service-price-range-client.test.mjs`
- `tests/s07-runtime-budgets.test.mjs`
- `tests/f12-notification-status.test.mjs`

Only paths and Git blob identities are copied into the inventory. Product code,
tests, migrations and browser behavior are not modified or executed by this PR.
The full pinned product checkout is required to run its existing suites later;
the primary-target inventory alone is not a dependency-complete test bundle.

## Reproduce inventory identity

From a checkout containing this proposal:

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { freezeCases } from '../../src/experiments/freeze.mjs';
const m = JSON.parse(await readFile('COHORT-v0.1.json', 'utf8'));
const rebuilt = freezeCases(m.cases, {
  experimentId: m.experiment_id,
  protocolVersion: m.protocol_version,
  metadata: m.metadata,
});
assert.deepEqual(rebuilt, m);
assert.equal(m.cases.length, 24);
assert.equal(new Set(m.cases.map(c => c.case_id)).size, 24);
for (const row of m.cases) {
  assert.equal(row.inputStatus, 'pending-materialization');
  for (const field of ['changeArtifactSha256', 'packetSha256',
    'relationalCaseSha256', 'relationLabel', 'independentOutcome']) {
    assert.equal(row[field], null);
  }
}
console.log(m.manifest_sha256);
JS
```

Run that snippet with the working directory `tools/h19-kit/experiments/m11`.
At the pinned full product checkout, compare each `metadata.sources[path]`
against `git rev-parse <sourceRevision>:<path>` and find each exact
`referenceTest` in its recorded suite. A missing name or blob mismatch invalidates
the input, not merely a documentation link. Git blob SHA-1 identifies source
objects; M3 SHA-256 identifies the canonical scenario inventory.

## What must exist before measurement

The next offline slice must produce actual packets/facts, validate M8/M9 bindings,
and write a separate manifest linked to this inventory. Expand lineage/dependency
clusters before labels; never let a sibling or shared lineage cross the splits.
If a new split is necessary, version and re-freeze it before any model output.

All current `null` fields are deliberate missing evidence. Preserve that state
until actual artifacts exist. No fallback to fake facts, zero-valued coverage,
implied negative labels or fabricated timestamps is allowed.

The independent relation-reference ledger and functional-outcome ledger remain
separate. Probability calibration is only meaningful against the same four-class
relation task. A frozen launch receipt is required for any later paid provider
run; this directory contains no credentials, live runner or executable command
that invokes a provider.
