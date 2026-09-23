import { MARKETING_ASSETS } from "./assets.ts";

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
    sha256: "ed85b1dec55fa68bf6336c7715aa884bbadc422e97ab23e0c67a4d1472527210",
  },
  [MARKETING_ASSETS.transformationFinal]: {
    kind: "image",
    required: true,
    sha256: "2b69508fb7f14c6022328494d0d8c1e63859bd954067e7af7d7c6b55b32098d2",
  },
  [MARKETING_ASSETS.heroModel]: {
    kind: "image",
    required: true,
    sha256: "f1da7dd3c8a6bd0dc34948d364432cc03dc69bccde3944e1acc60ff5a0201a3d",
  },
} as const;

/** 121-frame WebP sequences; byte caps are the MKT-PERF-05 comparison targets. */
export const MARKETING_FRAME_SEQUENCE_CONTRACT = {
  count: 121,
  desktop: { root: "/marketing/transformation/frames/desktop", width: 1928, maxTotalBytes: 6_553_600 },
  mobile: { root: "/marketing/transformation/frames/mobile", width: 960, maxTotalBytes: 2_883_584 },
} as const;
