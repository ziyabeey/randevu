# Blind review primitive

The experiment engine keeps the reviewer packet and answer key as different artifacts.

`createBlindPacket()` recursively removes configured hidden fields such as:
- labels;
- semantic axes;
- layer/stratum;
- direction;
- rationale.

`createBlindKey()` stores case IDs and expected answers separately.

Both artifacts receive content-derived SHA-256 identities.

A domain experiment may hide additional fields. The generic toolkit never assumes that a field is safe to show
merely because it is descriptive.

## Recommended flow

1. freeze protocol;
2. freeze case set;
3. deterministically select sample;
4. generate blind packet and answer key;
5. commit blind packet;
6. reviewer answers and commits responses;
7. only then open the answer key;
8. disagreements drop or follow the domain protocol. Never silently relabel.
