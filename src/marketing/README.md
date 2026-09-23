# MKT-01 marketing homepage

This directory is the isolated Randevu Kolay marketing surface while shared app entry files are under feature-lane ownership.

## Canonical domain contract

MKT-DOMAIN-01 separates the public brand surface from the private operator app:

- outward product brand: **Randevu Kolay**
- public marketing origin: `https://randevukolay.net`
- private operator app/login origin: `https://randevu.kepenk.ai`
- public tenant pattern: `https://{business-slug}.randevukolay.net`
- there is no second private app origin at `app.randevukolay.net`

`domainContract.ts` is the marketing-local source for these values. Production login CTAs target the private operator origin. The standalone preview and localhost deliberately keep `/app` as a self-contained test destination; that preview behavior is not the production URL contract.

Kepenk.ai is the parent/platform domain and may appear as secondary attribution when required, but it is not the outward Randevu Kolay product brand.

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
- `?renderer=video` selects the MP4 scrub A/B arm; `?renderer=frames` forces the sequence. Without the parameter the production policy applies: the WebP scroll sequence (`transformation/rendererPolicy.ts`, product-owner decision 2026-09-17).

The standalone preview is `noindex,nofollow`. Production title, description, Open Graph metadata and canonical behavior are owned by `useMarketingDocumentMeta.ts` and target `randevukolay.net`.

## Publish gates

`releaseGates.ts` is the single source for public marketing claims. A feature should not be advertised merely because UI copy exists. Flip a gate only after the corresponding product, proof and commercial acceptance explicitly authorize the marketing claim.

Current notable boundaries:

- customer-memory proof remains fail-closed in marketing until its explicit release/proof gate is reopened,
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

The real sequences are extracted from the clean Kling MOV with `node scripts/mkt-01-extract-frames.mjs --src <source>` (Chrome decode + canvas WebP, no ffmpeg). Synthetic CI frames still prove behavior, cache, concurrency and fallback; the committed sequences carry the real bytes (desktop 4.87 MB, mobile 2.42 MB, both under the MKT-PERF-05 comparison targets).

## Shared-entry boundary

Do not write `src/main.tsx`, `src/App.tsx`, shared router/session or DNS/deploy configuration in this isolated lane. Production domain routing is a separate latest-main integration after coordinator clearance. Current coordination keeps shared root/DNS cutover behind PR #76 and the final domain/MKT acceptance gate.

The previous same-origin plan that moved the private workspace from `/` to marketing-local `/app` is retired. Existing private-app root-return links remain private-app concerns on `randevu.kepenk.ai`; MKT-DOMAIN-01 does not rewrite them.
