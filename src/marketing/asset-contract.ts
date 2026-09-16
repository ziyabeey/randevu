import { MARKETING_ASSETS } from "./assets";

/**
 * Production renderer is the WebP scroll sequence (rendererPolicy.ts). The MP4
 * entries stay as the optional A/B arm: hashes from the earlier scrub-friendly
 * encode handoff, verified only when the files are present.
 */
export const MARKETING_ASSET_CONTRACT = {
  [MARKETING_ASSETS.transformationVideo]: {
    kind: "video",
    required: false,
    sha256: "b82e9fe486e9dd9706c8294a4cd3c07efe526034d6feb7b543930455ba96fdef",
  },
  [MARKETING_ASSETS.transformationMobileVideo]: {
    kind: "video",
    required: false,
    sha256: "f4984cc62143e744ee5bffd378a00eee0efdae909d6170d5a9210465b1873bc3",
  },
  [MARKETING_ASSETS.transformationPoster]: {
    kind: "image",
    required: true,
    sha256: "15e48377185dea9aeb98e0bc537108877f445bfcdee69cc2f7c3bdcb3f7e7dd8",
  },
  [MARKETING_ASSETS.transformationFinal]: {
    kind: "image",
    required: true,
    sha256: "de93cf2c66d715738c91cdec8a19f77aec92c1819a9061e9c6dd202a59f14faa",
  },
  [MARKETING_ASSETS.heroModel]: {
    kind: "image",
    required: true,
    sha256: "5ac084fef0f5d21f40ecc5d8a5fca87c4a0b179f7555e8be77ece6bf9fd8781e",
  },
} as const;

/** 121-frame WebP sequences; byte caps are the MKT-PERF-05 comparison targets. */
export const MARKETING_FRAME_SEQUENCE_CONTRACT = {
  count: 121,
  desktop: { root: "/marketing/transformation/frames/desktop", width: 1600, maxTotalBytes: 6_553_600 },
  mobile: { root: "/marketing/transformation/frames/mobile", width: 960, maxTotalBytes: 2_883_584 },
} as const;
