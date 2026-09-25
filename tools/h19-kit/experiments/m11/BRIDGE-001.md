# M11 real development case 001

The saved observations now produce **one eligible M9 development case**, bound
to five pagination controls. This is successful input preparation, not evidence
of a product defect or a completed H19/Jev comparison. The parent stack and
independent assessment gates remain pending.

| Development result | Count |
| --- | ---: |
| Enrolled anchors retained | 22 |
| Anchors bound to the one eligible case | 5 |
| Source-text UI anchors with unknown coverage and no hypothesis | 7 |
| Anchors still missing observations | 10 |
| Unique M5 packets / M9 batches | 2 / 2 |
| Unique M9 cases | 1 |
| New empirical suite executions / provider calls | 0 / 0 |

One of the two packets is the retained empty UI packet. The five pagination
rows share one nonempty packet and one case. Both original suite invocations
remain historical measurements; no individual-control coverage is inferred.

## Actual facts in the case

| Fact | Value | Original measurement |
| --- | --- | --- |
| Uncalled named V8 entries in `worker/pagination.ts` | 4 of 9 | Saved `tests/s07-pagination.test.mjs` invocation |
| Direct production importer witnessed in the bounded scan | 1 | Saved pre-execution static audit |

The uncalled entries are `validDate`, `encodeBookingPageCursor`,
`decodeBookingPageCursor` and `bookingPageResult`. These counts describe that
suite only. The witnessed production importer is `worker/bookings.ts`. The
reference test's own import is excluded. This is a positive witness count, not
complete repository fan-in: the bounded audit retains 29 unresolved imports.
The later full map records six production importers but includes evaluation
inputs, so it is used only to check the split. Static import presence does not
mean every function is used.

Coverage keeps run root
`d9eb3eadd88976b959ab42a877d31240c60e5913ff8b8eda8ce357986b99a5c1`.
Dependency keeps bounded-audit root
`217919514180516470f6c2c121ce8b31c3f80ec46d15168aa7a0d002e3a5dc3e`.
These are separate measurement inputs, not proof of statistical independence.
No successful-test fact is counted as a second vote for its own coverage data.
No label, independent functional outcome, provider confidence or calibration
record has been created. Source/UI coverage remains unknown/null.

## Exact identities

| Artifact | SHA-256 |
| --- | --- |
| Inventory v0.2 | `79b802f95f6612a628ea23d8d7cb2cf6719465124a35743fa956eff4784ff662` |
| Original collection | `e089ce3645fcfd78488ecba02a0bcce4f515517a15fa2ac67c84cab7d2231890` |
| [Derived bridge result](DEVELOPMENT-BRIDGE-001.json) | `72b155638701612f1667c7aabd7cc79a5d38f2879f3f5e3d6388979be19806ae` |
| Contained observation bundle | `d171e7649dfc8e2cebd9b9fc62ad10343476b526d3e7455e6d73649ee0e86f0c` |
| Contained materialization | `0bc23e527f14a008046446d75eeca621392b7b63957e00a16f8ab452c6205719` |
| Nonempty M5 packet | `0097982773a46898385aa055450172087e33fc5312f967f2eff3b9da8988d168` |
| M9 case | `bf214c9fa35b06b906c149fb8415549040131aa33b91a1c1c9b582ad915c39ad` |

Product pin remains `07688ae08ef5c834bcadf5dc6a23c4e42e4621dd`; evidence-engine
pin remains `6a37baebca749482465d3dd302f9bae56d3ff2e0`. The adapter validates
64 development files plus eight common context files against the pinned Git
tree. It reads no evaluation source content. All current observation paths fit
the repaired development component; future inputs still need a fresh check.

## Reproduce

With a separate checkout of the pinned product commit as `SOURCE_ROOT`, run
from the tool repository root after installing the kit's pinned dependencies:

```bash
node tools/h19-kit/bin/h19-m11-bridge.mjs \
  tools/h19-kit/experiments/m11 \
  79b802f95f6612a628ea23d8d7cb2cf6719465124a35743fa956eff4784ff662 \
  e089ce3645fcfd78488ecba02a0bcce4f515517a15fa2ac67c84cab7d2231890 \
  SOURCE_ROOT
npm --prefix tools/h19-kit run test:m11-bridge
```

The CLI reproduces the saved JSON without executing product tests or changing
old artifacts. The [bridge contract](../../specs/M11_OBSERVATION_BRIDGE-v0.1.md)
states derivation rules, trust limits and lineage handling.

## Remaining gate

Next prepare a separate, case-bound M5 validation of the four uncalled entries,
with an independently sourced expected behavior and recorded execution. It must
not recycle the five reference controls as an independent outcome. Relation
labels and paid comparison runs remain separate gates. The evaluation split is
still two anchors in one component, supporting descriptive feasibility only.
