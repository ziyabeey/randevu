# M11 cohort re-freeze v0.2 — source split amendment

Status: review candidate. This versions the source-split preparation under
[M11 measurement gate v0.1](RELATIONAL_MEASUREMENT_GATE-v0.1.md), sections 3–4.
The comparison arms, independent labels, outcome semantics, required CI,
materialization checks, paid budget and parent acceptance gates remain unchanged.
Serializing a new M3 inventory does not confer independent review or main acceptance.

## Reason and result

The [first collection](../experiments/m11/COLLECTION-001.md) proved the original
12/12 split shared source dependencies. The transitive traversal now places
pagination, public-selection, catalog-price-projection and runtime-notification
in one component. Calendar-refresh is the other component.

| Component | Prior clusters | New split | Anchors | Repository files |
| --- | --- | --- | ---: | ---: |
| `M11-COMP-a8c7b4f25226` | pagination, public-selection, catalog-price-projection, runtime-notification | development | 22 | 64 |
| `M11-COMP-9f7d7c75d819` | calendar-refresh | evaluation | 2 | 2 |

All 24 anchors, original source/tool pins, names, targets and null label/outcome
fields are retained. Every row records `originalCluster`. The v0.1 inventory and
prior observations remain immutable; their hashes are not relabeled as v0.2.

Assignment is fixed before relation labels/provider outputs: a whole component
containing any prior development anchor is development. Otherwise it stays
evaluation. No test result, coverage value or model answer enters that rule.
The ten moved anchors belong to the component already exposed to development.

There are **two repository components, one per split**, not 24 independent
samples. The two evaluation anchors share a single component. This permits a
descriptive feasibility exercise; it does not support validated calibration,
population accuracy, meaningful confidence intervals or a confirmatory efficacy
claim. A later confirmatory study needs a separately preregistered sample with
more independent components. If traversal leaves no evaluation component, the
tool records `blocked-no-evaluation-component` and emits no readiness run.

## Frozen dependency profile: `repository-file-inputs-v1`

The profile is explicitly about **repository files used by source/coverage
inputs**. It is not a claim that every possible runtime service/data dependency
or future observation has already been collected.

1. A complete 680-entry Git file index reconstructs tree
   `e85fd3faf26671b2a5137d99b1be7765f06bb13c` at product commit
   `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`. The separately trusted snapshot
   digest binds the index. A missing entry changes the Git tree identity; a
   partially downloaded workspace cannot make an absent dependency disappear.
2. Start at each anchor's reference suite and primary targets. Traverse local
   imports/re-exports (including type references), literal dynamic imports and
   require calls, triple-slash file references, literal file reads, and
   `new URL(literal, import.meta.url)` resources. Verify every visited file's
   Git blob before parsing. Cycles are traversed once, not treated as errors.
3. Use the frozen Bundler-resolution profile. Explicit files and unambiguous
   conventional TS/JS/index candidates resolve against the full Git index.
   Ambiguous/missing paths, symlinks/submodules, directory package resolution,
   unsupported aliases/configuration or opaque loaders cannot certify closure.
4. Files read as text/data are byte-bound leaves unless their file type is
   parsed for further repository references. The SQL migration read by the
   price-contract test is included as text evidence; it is not executed and
   this does not certify a database call graph or SQL runtime behavior.
5. Reachable CSS is checked for loads/escapes. This profile refuses CSS
   `@import`, `url()` or escape constructs rather than claiming a general CSS
   resolver. None occurs in the reachable frozen styles. Nonliteral module/file
   loads, unsupported filesystem APIs/aliases and code-loader indirection leave
   explicit unknowns and block re-freeze.
6. Record bare imports at explicit external boundaries: Node builtins and
   package versions/integrities from the pinned lockfile. Dependency package
   source is not copied or claimed independently analyzed. Unknown external
   modules block closure. Node runtime and parser/package versions are recorded.

`package.json`, `package-lock.json`, four `tsconfig` files, `vite.config.ts` and
`wrangler.jsonc` are pinned **common execution context**. They are measurement
configuration, not independent scenario facts. TypeScript resolution overrides,
unrecognized inheritance and unsupported Vite plugin/resolution forms fail.
Package and lockfile dependency declarations must agree.

Common context is not silently omitted: its eight blob identities are in the
closure artifact. If a scenario imports or reads any of these files as evidence,
that file also enters its per-scenario closure and joins components normally.
Shared source/evidence files are never reclassified as common context merely
to preserve a convenient split. Common infrastructure means that component
separation is conditional on the frozen environment, not universal statistical
independence of every possible runtime factor.

The actual traversal verified 66 repository files, 157 local reference edges
and 58 external import references, with zero unresolved inputs under this
profile. This replaces the old bounded 11-file witness scan for source grouping.

## Materializer boundary

The new inventory binds the complete source-closure artifact. A source-only
readiness run supplies the two component closures and **zero observation
receipts** to the unchanged materializer. Its `complete: true` declarations
refer only to those repository-file closures for the current empty receipt set.
It verifies 64 development files and reports 22 `missing-observations` skips,
zero packets, zero batches and zero cases. Evaluation bytes are read by the
closure analyzer for dependency metadata; the materializer still never reads
evaluation source content. Neither tool executes the evaluation suites.

`futureObservationLineageComplete: false` remains explicit. Any next M5, history,
coverage, dependency, change or relationship receipt must retain its original
root digests, account for any extra source/evidence paths, and revalidate the
entire split before it can be admitted. External service/database behavior is
not an independently verified functional outcome. Common environment bindings
cannot be used as independent evidence-family roots. If later evidence connects
the two components, this version is invalidated before labels/calls, as v0.1 was.

The earlier 12-control coverage receipt keeps its original inventory identity.
It may become a traceable parent of a new producer receipt; it cannot simply be
renamed, counted as a new run or used as an independent relation label.

## Implementation and evidence

- `src/experiments/m11-closure.mjs`: Git tree verification, bounded-profile
  dependency traversal, shared-file components and deterministic M3 re-freeze.
- `bin/h19-m11-refreeze.mjs`: read-only CLI; JSON contains closure, candidate
  inventory and source readiness. It runs no tests, provider, shell or network.
- `npm --prefix tools/h19-kit run test:m11-closure`: Git's own tree hash as an
  independent oracle, transitive/cyclic/file-read cases, unknown-loader and
  configuration blocks, component exposure, no-evaluation condition, CLI and
  frozen-receipt checks. Existing M11 checks and CI remain in force.
- [Artifacts, exact hashes and reproduction](../experiments/m11/REFREEZE-001.md).

Next bounded task: derive a real development M5 packet and M9-eligible fact
receipts from collected observations, preserving source/suite scope and root
lineage. Retain ineligible hypotheses. This amendment supplies no provider-run
budget, independent assessor receipt or new selection authority.
