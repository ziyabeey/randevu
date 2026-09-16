# MKT-01 transformation assets

Runtime paths are intentionally stable so motion production can be replaced without changing React code.

## Production renderer: WebP scroll sequence (product-owner decision, 2026-09-17)

The transformation stage ships as an Apple-style frame sequence: normalized scroll progress maps
directly to one of 121 WebP frames drawn on a single canvas (`src/marketing/transformation/frameSequence.ts`).
The MP4 scrub is kept only as an explicit A/B arm (`/marketing-preview.html?renderer=video`).

Required production files:

- `public/marketing/transformation/frames/desktop/frame-000.webp … frame-120.webp` (1928×1072 native, quality 0.80 — Retina-sharp)
- `public/marketing/transformation/frames/mobile/frame-000.webp … frame-120.webp` (960×534, quality 0.80, selected at `max-width: 680px`)
- `public/marketing/transformation/randevu-transformation-poster.webp` (frame at 0 s, 1928×1072)
- `public/marketing/transformation/randevu-transformation-final.webp` (product-owner supplied seated-model pricing scene, 2026-09-17; crops out the mockup text; fades in after the last frame and serves the reduced-motion / fallback panel)
- `public/marketing/hero/randevu-hero-model.webp` (frame at 0.08 s, hero photo)

Current handoff (extracted 2026-09-17 from the clean MOV source):

| sequence | frames | size | MKT-PERF-05 comparison target |
| --- | --- | --- | --- |
| desktop | 121 | 5.67 MB (avg 48 KB) | ≤ 6.25 MB |
| mobile | 121 | 2.31 MB (avg 20 KB) | ≤ 2.75 MB |

## Source master

The product-owner supplied Kling MOV is the visual source of truth:

- codec: H.264
- dimensions: `1928×1072`
- frame rate: `24 fps`
- duration: `5.041667 s` (121 frames)
- no visible generator watermark in the clean source
- audio is not required by the marketing experience
- clean source SHA-256: `a1fa4a2e40130a8093775926b1ee055c6b3bab39bd3692c003fdfb61ad881f39` (`kling_20260914_VIDEO_Use_the_up_4492_0.mov`, not committed)

## Regenerating the sequence (no ffmpeg needed)

Chrome decodes the source and exports each frame as WebP through a canvas; frame `i` is sampled at
`(i + 0.5) / 24` s so no sample lands on a frame boundary. Same timeline as `timeline.ts`.

```bash
node scripts/mkt-01-extract-frames.mjs --src /path/to/kling_20260914_VIDEO_Use_the_up_4492_0.mov
node scripts/verify-marketing-assets.mjs
```

The verifier checks the three stills by SHA-256, both sequences for 121 valid WebP frames and the
byte caps above, and only checks an MP4 when one is present.

## Video A/B arm (optional until a scrub-friendly encode is delivered)

The MP4 arm is not required by the production renderer. When an encode is produced it must be
scroll-seek friendly (needs ffmpeg; the clean source is 8.9 MB with audio and above the 5.0 MB cap):

- H.264 High profile, GOP / keyframe interval `6` frames (`0.25 s` at 24 fps), B-frames disabled,
  audio stripped, `+faststart`, approximate size `4.5 MB` (desktop) and `2.0 MB` at `1280×712` (mobile,
  selected by `<source media="(max-width: 680px)">`).

```bash
ffmpeg -i INPUT.mov -an -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.1 \
  -g 6 -keyint_min 6 -sc_threshold 0 -bf 0 -pix_fmt yuv420p -movflags +faststart \
  public/marketing/transformation/randevu-transformation-master.mp4
ffmpeg -i public/marketing/transformation/randevu-transformation-master.mp4 -an -vf "scale=1280:-2" \
  -c:v libx264 -preset slow -crf 21 -profile:v high -level 4.1 -g 6 -keyint_min 6 -sc_threshold 0 -bf 0 \
  -pix_fmt yuv420p -movflags +faststart public/marketing/transformation/randevu-transformation-mobile.mp4
```

## Expected SHA-256

```text
ed85b1dec55fa68bf6336c7715aa884bbadc422e97ab23e0c67a4d1472527210  randevu-transformation-poster.webp
2b69508fb7f14c6022328494d0d8c1e63859bd954067e7af7d7c6b55b32098d2  randevu-transformation-final.webp
f1da7dd3c8a6bd0dc34948d364432cc03dc69bccde3944e1acc60ff5a0201a3d  randevu-hero-model.webp
b82e9fe486e9dd9706c8294a4cd3c07efe526034d6feb7b543930455ba96fdef  randevu-transformation-master.mp4
f4984cc62143e744ee5bffd378a00eee0efdae909d6170d5a9210465b1873bc3  randevu-transformation-mobile.mp4
```

The MP4 hashes are the earlier scrub-friendly encode handoff; they only apply if those files are added.
If production intentionally re-extracts or re-encodes, update the hashes deliberately and re-run the
browser scrub acceptance.

## Runtime contract

`src/marketing/transformation/TransformationSection.tsx` resolves the renderer through
`rendererPolicy.ts` (production: frames; explicit `?renderer=video` selects the MP4 arm) and expects
the canonical paths above. `src/marketing/MarketingHero.tsx` expects the hero WebP path. Motion is
scroll-scrubbed only; pricing, copy and product UI remain React/DOM overlays and must not be baked
into the frames.

`marketing-preview.html` is a development-only Vite entry used before the production root cutover.
It is intentionally `noindex,nofollow`; production metadata and canonical behavior live in
`src/marketing/useMarketingDocumentMeta.ts` and become relevant when `/` is handed to `MarketingHome`.
