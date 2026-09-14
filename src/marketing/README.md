# MKT-01 marketing homepage

This directory is the isolated Randevu marketing surface while shared app entry files are under feature-lane ownership.

## Preview

Run the branch locally and open:

```text
/marketing-preview.html
```

Preview helpers:

- `?clean=1` hides the diagnostics pill.
- `?debug=1` shows the scroll-scrub progress rail in development.
- `?reduced=1` forces the reduced-motion fallback.
- `?reduced=1&clean=1` combines a clean static acceptance view.

The standalone preview is `noindex,nofollow`. Production title, description, Open Graph metadata and canonical behavior are owned by `useMarketingDocumentMeta.ts` and become relevant when the real `/` route is handed to `MarketingHome`.

## Publish gates

`releaseGates.ts` is the single source for public marketing claims. A feature should not be advertised merely because UI copy exists. Flip a gate only after the corresponding product or commercial acceptance is on main.

Current notable boundaries:

- customer memory is released after F10-05 / PR #74 merged,
- reminder proof stays closed until F16-02 acceptance; the transformation scene may only use explicit `Yakında` / concept language meanwhile,
- pricing stays unpublished until the commercial policy is explicitly approved,
- testimonial/outcome proof stays unpublished until a real pilot produces verifiable evidence,
- final contact CTA stays disabled until a real lead destination is configured.

## Assets

`assets.ts` is the runtime path manifest. Binary handoff and hashes are documented under `public/marketing/transformation/README.md`.

After unzipping the asset handoff into the repository root, run:

```bash
node scripts/verify-marketing-assets.mjs
```

## Shared-entry boundary

Do not write `src/main.tsx` or `src/App.tsx` while another active feature lane owns those files. Production route integration is a separate latest-main commit after coordinator single-writer clearance. Current coordination keeps that cutover behind PR #76's entry-writer work.
