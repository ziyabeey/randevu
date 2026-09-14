# MKT-01 transformation assets

Runtime paths are intentionally stable so motion production can be replaced without changing React code.

Required production files:

- `randevu-transformation-master.mp4` — clean Kling master, H.264, 1928×1072, 24 fps, ~5.04 s.
- `randevu-transformation-poster.webp` — first meaningful frame, optimized for fast paint.

Optional later optimization:

- `randevu-transformation-master.webm` — equivalent WebM encode after browser QA.

The original product-owner supplied MOV is the visual source of truth. Do not publish a generator-watermarked export. Pricing/UI/copy must remain DOM/React overlays and must not be baked into the video.
