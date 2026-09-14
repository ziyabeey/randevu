import { MARKETING_ASSETS } from "./assets";

export const MARKETING_ASSET_CONTRACT = {
  [MARKETING_ASSETS.transformationVideo]: {
    kind: "video",
    required: true,
    sha256: "b82e9fe486e9dd9706c8294a4cd3c07efe526034d6feb7b543930455ba96fdef",
  },
  [MARKETING_ASSETS.transformationPoster]: {
    kind: "image",
    required: true,
    sha256: "39814c4ed94b1127de62e096cb2940c6138a27b365450a5e88af77d869e5bbb8",
  },
  [MARKETING_ASSETS.transformationFinal]: {
    kind: "image",
    required: true,
    sha256: "40dd0196638aaa73fea2bdbd82f8a283bf3c24357b960557580fd5565dda0a70",
  },
  [MARKETING_ASSETS.heroModel]: {
    kind: "image",
    required: true,
    sha256: "cbcfb696ee7e9669052113f106ff988912bad315498f92101ee6288b0c90072a",
  },
} as const;
