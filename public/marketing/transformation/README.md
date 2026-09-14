# MKT-01 transformation assets

Runtime paths are intentionally stable so motion production can be replaced without changing React code.

Required production files:

- `public/marketing/transformation/randevu-transformation-master.mp4`
- `public/marketing/transformation/randevu-transformation-mobile.mp4`
- `public/marketing/transformation/randevu-transformation-poster.webp`
- `public/marketing/transformation/randevu-transformation-final.webp`
- `public/marketing/hero/randevu-hero-model.webp`

## Source master

The product-owner supplied Kling MOV is the visual source of truth:

- codec: H.264
- dimensions: `1928×1072`
- frame rate: `24 fps`
- duration: `5.041667 s`
- no visible generator watermark in the clean source
- audio is not required by the marketing experience

## Scrub-friendly desktop web encode

The desktop runtime MP4 is intentionally optimized for scroll seeking rather than minimum byte size:

- H.264 High profile
- GOP / keyframe interval: `6` frames (`0.25 s` at 24 fps)
- B-frames disabled
- audio stripped
- `+faststart`
- approximate size: `4.5 MB`

Reference command:

```bash
ffmpeg -i INPUT.mov \
  -an \
  -c:v libx264 \
  -preset slow \
  -crf 20 \
  -profile:v high \
  -level 4.1 \
  -g 6 \
  -keyint_min 6 \
  -sc_threshold 0 \
  -bf 0 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  public/marketing/transformation/randevu-transformation-master.mp4
```

## Mobile scrub encode

Small screens use a lighter source with the same duration, frame rate and GOP structure so scroll timing remains identical while network cost drops substantially.

Current mobile handoff:

- dimensions: `1280×712`
- frame rate: `24 fps`
- frames: `121`
- duration: `5.041667 s`
- approximate size: `2.0 MB`
- selected by `<source media="(max-width: 680px)">`

Reference command from the scrub-friendly desktop encode:

```bash
ffmpeg -i public/marketing/transformation/randevu-transformation-master.mp4 \
  -an \
  -vf "scale=1280:-2" \
  -c:v libx264 \
  -preset slow \
  -crf 21 \
  -profile:v high \
  -level 4.1 \
  -g 6 \
  -keyint_min 6 \
  -sc_threshold 0 \
  -bf 0 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  public/marketing/transformation/randevu-transformation-mobile.mp4
```

## Hero frame

The hero uses the same woman and salon world as the scroll master. Current handoff is a clean early frame from the source MOV encoded to WebP:

```bash
ffmpeg -ss 0.08 -i INPUT.mov \
  -frames:v 1 \
  -vf "scale=1928:-1" \
  -c:v libwebp \
  -quality 86 \
  public/marketing/hero/randevu-hero-model.webp
```

This keeps face, wardrobe, lighting and cobalt salon geometry continuous between the hero and the transformation section.

## Reduced-motion final still

The reduced-motion fallback uses a calm seated frame close to the end of the same master. The current frame is sampled at `4.75 s`, leaving negative space on the left for real DOM copy.

```bash
ffmpeg -ss 4.75 -i INPUT.mov \
  -frames:v 1 \
  -c:v libwebp \
  -quality 82 \
  public/marketing/transformation/randevu-transformation-final.webp
```

## Expected SHA-256

```text
b82e9fe486e9dd9706c8294a4cd3c07efe526034d6feb7b543930455ba96fdef  randevu-transformation-master.mp4
f4984cc62143e744ee5bffd378a00eee0efdae909d6170d5a9210465b1873bc3  randevu-transformation-mobile.mp4
39814c4ed94b1127de62e096cb2940c6138a27b365450a5e88af77d869e5bbb8  randevu-transformation-poster.webp
40dd0196638aaa73fea2bdbd82f8a283bf3c24357b960557580fd5565dda0a70  randevu-transformation-final.webp
cbcfb696ee7e9669052113f106ff988912bad315498f92101ee6288b0c90072a  randevu-hero-model.webp
```

After copying or unzipping the binary handoff into the repository root, verify every required file before browser QA:

```bash
node scripts/verify-marketing-assets.mjs
```

The verifier fails closed on a missing file or SHA-256 mismatch. If production intentionally re-encodes a source, update the hash contract deliberately and re-run browser scrub acceptance.

Optional later optimization:

- `randevu-transformation-master.webm` — equivalent WebM encode only after browser QA.

## Runtime contract

`src/marketing/transformation/TransformationSection.tsx` expects the canonical transformation paths above. `src/marketing/MarketingHero.tsx` expects the hero WebP path. Motion is muted, inline and scroll-scrubbed. Pricing, copy and product UI remain React/DOM overlays and must not be baked into the video.

`marketing-preview.html` is a development-only Vite entry used before the production root cutover. It is intentionally `noindex,nofollow`; production metadata and canonical behavior live in `src/marketing/useMarketingDocumentMeta.ts` and become relevant when `/` is handed to `MarketingHome`.
