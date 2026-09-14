# MKT-01 marketing homepage

This directory is the isolated Randevu marketing surface while shared app entry files are under feature-lane ownership.

## Preview

Run the branch locally and open:

```text
/marketing-preview.html
```

Preview helpers:

- `?clean=1` hides the diagnostics pill.
- `?reduced=1` forces the reduced-motion fallback.
- `?reduced=1&clean=1` combines both.

## Publish gates

`releaseGates.ts` is the single source for public marketing claims. A feature should not be advertised merely because UI copy exists. Flip a gate only after the corresponding product or commercial acceptance is on main.

## Assets

`assets.ts` is the runtime path manifest. Binary handoff and hashes are documented under `public/marketing/transformation/README.md`.

## Shared-entry boundary

Do not write `src/main.tsx` or `src/App.tsx` while another active feature lane owns those files. Production route integration is a separate latest-main commit after coordinator single-writer clearance.
